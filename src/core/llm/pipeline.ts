import {
  checkCoverage,
  uncoveredAll,
} from "@/core/kit/coverage";
import { buildSchedule } from "@/core/kit/schedule";
import {
  CATEGORY_LABELS,
  type Kit,
  type Question,
  type Requirement,
  type RequirementCategory,
} from "@/core/kit/types";
import { validateKit } from "@/core/kit/validate";
import type { LLMClient } from "./client";
import { LLMError, parseJsonLoose } from "./client";
import {
  companyBriefPrompt,
  extractRequirementsPrompt,
  flashcardsPrompt,
  questionsPrompt,
  type BriefPageInput,
} from "./prompts";
import type { CrawlResult } from "@/core/retrieval/crawl";
import type { DiscussionResult } from "@/core/retrieval/discussion";

/**
 * The kit generation pipeline: deliberate steps, each responding to what the
 * previous step actually found.
 *
 *  1. extract requirements (LLM, one call)          — the JD needs no retrieval
 *  2. crawl the company site (code)                 — rank links, fetch pages
 *  3. search public discussion (code + fetch)       — DDG + top pages
 *  4. company brief (LLM)                           — only from retrieved pages
 *  5. questions (LLM, one call PER REQUIREMENT)     — category-specific prompts
 *  6. coverage check (deterministic code)           — set difference reqs vs questions
 *  7. gap-fill passes (LLM) + re-check              — MAX_COVERAGE_PASSES total
 *  8. flashcards (LLM) from the final questions
 *  9. schedule (deterministic arithmetic)           — exactly `days` days
 * 10. validation (zod + cross-references)           — hard failure on invalid kit
 *
 * Steps 2-3 feed step 4 and the company context in step 5: a hiring page that
 * describes a take-home changes what the brief says, and requirement category
 * changes the question prompt. Nothing is one big prompt.
 */

export const MAX_COVERAGE_PASSES = 3;
const QUESTIONS_PER_MUST = 3;
const QUESTIONS_PER_NICE = 2;
const QUESTION_CONCURRENCY = 3;

export interface GenerateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface Progress {
  stage: string;
  message: string;
  percent: number;
}

export interface PipelineDeps {
  llm: LLMClient;
  crawl?: (url: string, options?: { maxPages?: number }) => Promise<CrawlResult>;
  searchDiscussion?: (
    company: string
  ) => Promise<DiscussionResult>;
  onProgress?: (progress: Progress) => void;
  now?: () => Date;
  /** Test hook: maxPages for the crawler. */
  maxCrawlPages?: number;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly detail: string[] = []
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export async function generateKit(input: GenerateKitInput, deps: PipelineDeps): Promise<Kit> {
  const now = deps.now ?? (() => new Date());
  const progress = (stage: string, message: string, percent: number) =>
    deps.onProgress?.({ stage, message, percent });

  // ---- 1. requirements (no retrieval needed for pasted text) -----------------
  progress("requirements", "Reading the job description…", 4);
  const jd = input.jd.trim();
  if (jd.length < 30) {
    throw new PipelineError("The job description is too short to analyse.", [
      "Paste at least a couple of sentences.",
    ]);
  }
  const extraction = await completeJson<ExtractLlmResult>(
    deps.llm,
    extractRequirementsPrompt(jd)
  );
  const requirements = normaliseRequirements(extraction.requirements, jd);
  const roleTitle = (extraction.role_title ?? "").trim();
  const summaryMd = (extraction.summary_md ?? "").trim() || "No summary was extracted from the job description.";
  const notices: string[] = [];
  if (requirements.length <= 2) {
    notices.push(
      "The job description was thin — few requirements could be extracted, so the kit is deliberately small rather than padded."
    );
  }

  // ---- 2. crawl the company site --------------------------------------------
  progress("crawl", `Crawling ${input.companyUrl}…`, 12);
  const crawl = await (deps.crawl ?? defaultCrawl)(input.companyUrl, {
    maxPages: deps.maxCrawlPages ?? 6,
  });

  // ---- 3. public discussion --------------------------------------------------
  progress("discussion", "Looking for public discussion of the interview process…", 30);
  const companyName = companyFromUrl(input.companyUrl, roleTitle);
  const discussion = await (deps.searchDiscussion ?? defaultDiscussion)(companyName);

  const sources = collectSources(crawl, discussion);
  const sourcesSkipped = [
    ...crawl.skipped.map((s) => ({ url: s.url, reason: s.reason })),
    ...discussion.skipped,
  ];
  if (crawl.pages.length === 0) {
    notices.push(
      `Nothing could be retrieved from ${input.companyUrl} — the company brief states this honestly instead of inventing details.`
    );
  }
  if (discussion.pages.length === 0) {
    notices.push(
      "No public discussion of this company's interview process was found or retrievable."
    );
  }

  // ---- 4. company brief (only from retrieved pages) --------------------------
  progress("brief", "Writing the company brief…", 42);
  const briefPages: BriefPageInput[] = [...crawl.pages, ...discussion.pages].map((p) => ({
    url: p.url,
    title: p.title,
    kind: "kind" in p ? String(p.kind) : "discussion",
    text: p.text,
  }));
  const brief = await completeJson<{ company_name: string; brief_md: string }>(
    deps.llm,
    companyBriefPrompt(companyName, briefPages)
  );

  // ---- 5. questions, per requirement and category ----------------------------
  progress("questions", `Generating questions for ${requirements.length} requirement(s)…`, 52);
  const companyContext = brief.brief_md;
  let questions = await generateQuestionsForRequirements(
    requirements,
    companyContext,
    (r) => (r.kind === "must" ? QUESTIONS_PER_MUST : QUESTIONS_PER_NICE),
    deps,
    (done, total) =>
      progress("questions", `Generating questions… (${done}/${total})`, 52 + Math.round((done / Math.max(total, 1)) * 18))
  );

  // ---- 6+7. coverage check loop (deterministic) ------------------------------
  progress("coverage", "Checking requirement coverage…", 70);
  let coverage = checkCoverage(requirements, questions);
  let pass = 1;
  while (coverage.gaps.length > 0 && pass < MAX_COVERAGE_PASSES) {
    pass += 1;
    progress(
      "coverage",
      `Coverage check found ${coverage.gaps.length} gap(s) — filling them (pass ${pass}/${MAX_COVERAGE_PASSES})…`,
      72
    );
    const gapRequirements = uncoveredAll(coverage, requirements);
    const gapQuestions = await generateQuestionsForRequirements(
      gapRequirements,
      companyContext,
      () => 2,
      deps,
      undefined,
      { gapFill: true, idStart: questions.length + 1 }
    );
    questions = [...questions, ...gapQuestions];
    coverage = checkCoverage(requirements, questions);
  }
  coverage.passes = pass;
  if (coverage.gaps.length > 0) {
    notices.push(
      `After ${MAX_COVERAGE_PASSES} generation passes, ${coverage.gaps.length} requirement(s) still had no question against them — they are listed in Coverage instead of being papered over.`
    );
  }

  // ---- 8. flashcards ----------------------------------------------------------
  progress("flashcards", "Building flashcards…", 82);
  const flashcards = await generateFlashcards(deps.llm, questions, requirements);

  // ---- 9. schedule (deterministic arithmetic) ---------------------------------
  progress("schedule", "Allocating your study days…", 90);
  const { schedule, notices: scheduleNotices } = buildSchedule({
    days: input.days,
    requirements,
    questions,
  });
  notices.push(...scheduleNotices);

  // ---- 10. validation -----------------------------------------------------------
  const title = `${roleTitle || "Interview prep"} — ${brief.company_name || companyName}`;
  const kit: Kit = {
    id: `kit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: title.slice(0, 160),
    company: {
      name: brief.company_name || companyName,
      url: input.companyUrl,
      brief_md: brief.brief_md,
      sources,
      brief_edited: false,
    },
    role: {
      title: roleTitle || "the role",
      summary_md: summaryMd,
      requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage,
    meta: {
      days_requested: input.days,
      model: deps.llm.model,
      created_at: now().toISOString(),
      updated_at: now().toISOString(),
      notices,
      sources_skipped: sourcesSkipped,
    },
  };

  progress("validating", "Validating the kit…", 97);
  const validation = validateKit(kit);
  if (!validation.ok) {
    throw new PipelineError("The generated kit failed validation.", validation.errors.slice(0, 10));
  }
  progress("done", "Kit ready.", 100);
  return validation.kit!;
}

// ---- helpers -------------------------------------------------------------------

interface ExtractLlmResult {
  role_title?: string;
  summary_md?: string;
  requirements?: { text?: string; kind?: string; category?: string }[];
}

const CATEGORIES: RequirementCategory[] = [
  "technical",
  "behavioural",
  "system_design",
  "domain",
  "process",
];

export function normaliseRequirements(
  raw: ExtractLlmResult["requirements"] | undefined,
  jd: string
): Requirement[] {
  const out: Requirement[] = [];
  for (const item of raw ?? []) {
    const text = (item?.text ?? "").trim();
    if (text.length < 3 || out.length >= 30) continue;
    const category = CATEGORIES.includes(item?.category as RequirementCategory)
      ? (item?.category as RequirementCategory)
      : "technical";
    out.push({
      id: `req_${out.length + 1}`,
      text: text.slice(0, 800),
      kind: item?.kind === "nice" ? "nice" : "must",
      category,
    });
  }
  if (out.length === 0) {
    // Never invent: fall back to the JD's own first meaningful line as the
    // single requirement, so coverage/schedule still have something to work with.
    const firstLine = jd
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 15);
    if (firstLine) {
      out.push({ id: "req_1", text: firstLine.slice(0, 800), kind: "must", category: "technical" });
    }
  }
  return out;
}

export async function generateQuestionsForRequirements(
  requirements: Requirement[],
  companyContext: string,
  countFor: (r: Requirement) => number,
  deps: PipelineDeps,
  onEach?: (done: number, total: number) => void,
  options: { gapFill?: boolean; idStart?: number } = {}
): Promise<Question[]> {
  const out: Omit<Question, "id">[] = [];
  let done = 0;
  // Small concurrent batches pace the provider; the client itself retries 429s.
  for (let i = 0; i < requirements.length; i += QUESTION_CONCURRENCY) {
    const batch = requirements.slice(i, i + QUESTION_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (requirement) => {
        try {
          const response = await completeJson<{
            questions?: { prompt?: string; answer_outline_md?: string; difficulty?: number }[];
          }>(deps.llm, questionsPrompt(requirement, companyContext, countFor(requirement), options));
          return normaliseQuestions(response.questions, requirement);
        } catch (err) {
          // One requirement failing to generate is a coverage gap, not a dead run.
          onRequirementError(requirement, err);
          return [];
        }
      })
    );
    for (const list of results) out.push(...list);
    done += batch.length;
    onEach?.(done, requirements.length);
  }
  // Stable ids assigned after all questions exist; idStart lets callers
  // continue numbering so gap-fill additions never collide with existing ids.
  const idStart = options.idStart ?? 1;
  return out.map((q, idx) => ({ ...q, id: `q_${idStart + idx}` }));
}

function onRequirementError(requirement: Requirement, err: unknown): void {
  // Logged for observability; the coverage loop reports the consequence.
  console.error(
    `[pipeline] question generation failed for ${requirement.id}:`,
    err instanceof LLMError || err instanceof Error ? err.message : err
  );
}

function normaliseQuestions(
  raw: { prompt?: string; answer_outline_md?: string; difficulty?: number }[] | undefined,
  requirement: Requirement
): Omit<Question, "id">[] {
  const out: Omit<Question, "id">[] = [];
  for (const item of raw ?? []) {
    const prompt = (item?.prompt ?? "").trim();
    const outline = (item?.answer_outline_md ?? "").trim();
    if (prompt.length < 5 || outline.length < 5) continue;
    const difficultyRaw = Number(item?.difficulty);
    out.push({
      requirement_ids: [requirement.id],
      category: requirement.category,
      prompt: prompt.slice(0, 1000),
      answer_outline_md: outline.slice(0, 2000),
      difficulty: Number.isInteger(difficultyRaw)
        ? Math.min(5, Math.max(1, difficultyRaw))
        : 3,
      origin: "generated",
      pinned: false,
    });
  }
  return out;
}

export async function generateFlashcards(
  llm: LLMClient,
  questions: Question[],
  requirements: Requirement[]
): Promise<Kit["flashcards"]> {
  if (questions.length === 0) return [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  try {
    const response = await completeJson<{
      flashcards?: { question_id?: string; front?: string; back?: string }[];
    }>(llm, flashcardsPrompt(questions));
    const out: Kit["flashcards"] = [];
    for (const card of response.flashcards ?? []) {
      const front = (card?.front ?? "").trim();
      const back = (card?.back ?? "").trim();
      const question = card?.question_id ? byId.get(card.question_id) : undefined;
      if (front.length < 3 || back.length < 3) continue;
      const requirementIds = question
        ? question.requirement_ids
        : questions[Math.min(out.length, questions.length - 1)]?.requirement_ids ?? [];
      out.push({
        id: `fc_${out.length + 1}`,
        front: front.slice(0, 400),
        back: back.slice(0, 1200),
        requirement_ids: [...new Set(requirementIds)],
        origin: "generated",
        pinned: false,
      });
    }
    return out;
  } catch {
    // Flashcards are a convenience: fail soft, keep the kit.
    return [];
  }
}

function collectSources(
  crawl: CrawlResult,
  discussion: DiscussionResult
): Kit["company"]["sources"] {
  const sources: Kit["company"]["sources"] = [];
  for (const page of crawl.pages) {
    sources.push({ url: page.url, title: page.title, kind: page.kind, retrieved: true });
  }
  for (const page of discussion.pages) {
    sources.push({ url: page.url, title: page.title, kind: "discussion", retrieved: true });
  }
  return sources;
}

export function companyFromUrl(url: string, fallback: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".").slice(-2)[0] ?? host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return fallback || "the company";
  }
}

export async function completeJson<T>(llm: LLMClient, prompt: { system: string; user: string }): Promise<T> {
  const text = await llm.complete({ ...prompt, json: true });
  try {
    return parseJsonLoose<T>(text);
  } catch {
    throw new LLMError("Model returned invalid JSON", undefined, true);
  }
}

export async function defaultCrawl(url: string, options?: { maxPages?: number }): Promise<CrawlResult> {
  const { crawlCompanySite } = await import("@/core/retrieval/crawl");
  return crawlCompanySite(url, { maxPages: options?.maxPages });
}

async function defaultDiscussion(company: string): Promise<DiscussionResult> {
  const { searchDiscussion } = await import("@/core/retrieval/discussion");
  return searchDiscussion(company);
}
