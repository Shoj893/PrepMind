#!/usr/bin/env node
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { createLLMClientFromEnv, LLMError } from "../src/core/llm/client";
import { generateKit, type Progress } from "../src/core/llm/pipeline";
import { validateKit } from "../src/core/kit/validate";
import { BatchCaseSchema, type BatchCase, type Kit } from "../src/core/kit/types";
import { isPrivateIp } from "../src/core/retrieval/url";
import { isIP } from "node:net";

/**
 * Batch entry point (mandatory):
 *
 *   npm run evaluate -- --input cases.json --output kits.json
 *
 * Input: an array of { id, jd, company_url, days } (or {"cases": [...]}).
 * Output: a single JSON file with one result per case — the full kit on
 * success, a recorded failure otherwise. One case failing never aborts the
 * run. This is the SAME pipeline the web app uses (generateKit), not a
 * parallel implementation.
 *
 * Local fixture sites: case URLs that point at loopback/private addresses
 * (typical for evaluation fixtures) are detected and the SSRF guard is
 * relaxed for the run, with a warning. Public hostnames keep full guarding.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Args {
  input: string;
  output: string;
  concurrency: number;
  caseTimeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: "", output: "", concurrency: 2, caseTimeoutMs: 150_000 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) args.input = next;
    else if (arg === "--output" && next) args.output = next;
    else if (arg === "--concurrency" && next) args.concurrency = Math.max(1, Number(next) || 1);
    else if (arg === "--case-timeout" && next) args.caseTimeoutMs = Math.max(10_000, Number(next) || 150_000);
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (!args.input || !args.output) {
    printUsage();
    process.exit(1);
  }
  return args;
}

function printUsage(): void {
  console.error(`Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [options]

Options:
  --input <path>         JSON file: array of { id, jd, company_url, days } or { "cases": [...] }
  --output <path>        Where to write the results JSON
  --concurrency <n>      Cases processed in parallel (default 2)
  --case-timeout <ms>    Per-case wall-clock budget (default 150000)

Credentials are read from the environment (see .env.example):
  LLM_PROVIDER, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
  ALLOW_PRIVATE_HOSTS=1 to crawl local fixture sites (auto-enabled per case
  when a case URL is a loopback/private address).`);
}

interface ResultOk {
  case_id: string;
  status: "ok";
  kit: Kit;
}
interface ResultFailed {
  case_id: string;
  status: "failed";
  error: string;
  detail?: string[];
}
type Result = ResultOk | ResultFailed;

function looksLocal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host)) return isPrivateIp(host);
  return false;
}

async function runCase(
  case_: BatchCase,
  caseTimeoutMs: number
): Promise<Result> {
  const startedAt = Date.now();
  const llm = createLLMClientFromEnv();

  if (looksLocal(new URL(case_.company_url).hostname) && process.env.ALLOW_PRIVATE_HOSTS !== "1") {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    console.warn(`[evaluate] case ${case_.id}: local fixture URL detected — SSRF guard relaxed for this run.`);
  }

  const kit = await withTimeout(
    (async () => {
      const result = await generateKit(
        { jd: case_.jd, companyUrl: case_.company_url, days: case_.days },
        {
          llm,
          onProgress: (p: Progress) => {
            console.error(`[evaluate] ${case_.id}: ${p.percent}% ${p.message}`);
          },
        }
      );
      const validation = validateKit(result);
      if (!validation.ok) {
        throw new Error(`kit failed validation: ${validation.errors.join("; ")}`);
      }
      return validation.kit!;
    })(),
    caseTimeoutMs,
    `case ${case_.id} exceeded ${caseTimeoutMs}ms`
  );

  console.error(`[evaluate] ${case_.id}: done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return { case_id: case_.id, status: "ok", kit };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Credentials check: fail fast with an actionable message.
  try {
    createLLMClientFromEnv();
  } catch (err) {
    console.error(`[evaluate] ${(err as Error).message}`);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf-8"));
  } catch (err) {
    console.error(`[evaluate] could not read input file: ${(err as Error).message}`);
    process.exit(1);
  }

  const casesRaw = Array.isArray(raw) ? raw : (raw as { cases?: unknown })?.cases;
  if (!Array.isArray(casesRaw)) {
    console.error("[evaluate] input must be an array of cases or {\"cases\": [...] }");
    process.exit(1);
  }
  const cases: BatchCase[] = [];
  const inputFailures: Result[] = [];
  casesRaw.forEach((entry, index) => {
    const parsed = BatchCaseSchema.safeParse(entry);
    if (parsed.success) cases.push(parsed.data);
    else {
      const id = (entry as { id?: string })?.id ?? `case_${index + 1}`;
      inputFailures.push({
        case_id: id,
        status: "failed",
        error: "invalid case",
        detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  });

  console.error(`[evaluate] running ${cases.length} case(s) with concurrency ${args.concurrency}`);

  const results: Result[] = [...inputFailures];
  let cursor = 0;
  async function worker() {
    while (cursor < cases.length) {
      const case_ = cases[cursor++]!;
      try {
        results.push(await runCase(case_, args.caseTimeoutMs));
      } catch (err) {
        const message = err instanceof LLMError ? `LLM: ${err.message}` : (err as Error).message;
        console.error(`[evaluate] ${case_.id}: FAILED — ${message}`);
        results.push({ case_id: case_.id, status: "failed", error: message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, cases.length) }, worker));

  const ok = results.filter((r) => r.status === "ok").length;
  const output = {
    generated_at: new Date().toISOString(),
    model: createLLMClientFromEnv().model,
    case_count: cases.length + inputFailures.length,
    succeeded: ok,
    failed: results.length - ok,
    results,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(path.resolve(args.output), JSON.stringify(output, null, 2));
  console.error(
    `[evaluate] wrote ${path.resolve(args.output)} — ${ok}/${results.length} case(s) succeeded`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[evaluate] fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
