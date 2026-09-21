/**
 * LLM client interface. The pipeline only knows this interface; the OpenAI-
 * compatible implementation is the real provider, FakeLLM is deterministic
 * and used by tests and offline development.
 */

export interface CompletionRequest {
  system: string;
  user: string;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable?: boolean
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  LLM_PROVIDER?: string;
}

export function createLLMClientFromEnv(env: Env = process.env): LLMClient {
  const provider = (env.LLM_PROVIDER ?? (env.OPENAI_API_KEY ? "openai-compatible" : "")).trim();
  if (provider === "fake") {
    // Lazy import keeps the fake out of production bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FakeLLM } = require("./fake") as typeof import("./fake");
    return new FakeLLM();
  }
  if (provider === "openai-compatible" && env.OPENAI_API_KEY) {
    return new OpenAICompatibleClient({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  throw new LLMError(
    "No LLM configured. Set LLM_PROVIDER=openai-compatible with OPENAI_API_KEY (and optionally OPENAI_BASE_URL, OPENAI_MODEL), or LLM_PROVIDER=fake for offline runs. See .env.example."
  );
}

/**
 * OpenAI-compatible chat-completions client (works with OpenAI, Zhipu GLM,
 * OpenRouter, Ollama, vLLM, ...). Retries 429/5xx with exponential backoff
 * honouring Retry-After.
 */
export class OpenAICompatibleClient implements LLMClient {
  constructor(
    private readonly config: { apiKey: string; baseUrl: string; model: string }
  ) {}

  get model(): string {
    return this.config.model;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const maxAttempts = 4;
    let lastError: LLMError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.attempt(request);
      } catch (err) {
        lastError =
          err instanceof LLMError
            ? err
            : new LLMError((err as Error).message, undefined, true);
        if (!lastError.retryable || attempt === maxAttempts) throw lastError;
        const retryAfter = Number((lastError as LLMError & { retryAfter?: number }).retryAfter);
        const backoffMs = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 30_000)
          : Math.min(2 ** attempt * 1500, 20_000);
        await sleep(backoffMs);
      }
    }
    throw lastError ?? new LLMError("LLM request failed");
  }

  private async attempt(request: CompletionRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxTokens ?? 4000,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        const err = new LLMError(
          `LLM provider returned HTTP ${response.status}`,
          response.status,
          true
        );
        (err as LLMError & { retryAfter?: number }).retryAfter =
          Number(response.headers.get("retry-after")) || undefined;
        throw err;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new LLMError(
          `LLM provider returned HTTP ${response.status}: ${body.slice(0, 300)}`,
          response.status,
          false
        );
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new LLMError("LLM returned an empty response", undefined, true);
      }
      return content;
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new LLMError("LLM request timed out", undefined, true);
      }
      throw new LLMError(`LLM request failed: ${(err as Error).message}`, undefined, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract JSON from a model response: strips code fences, finds the first
 * balanced JSON object or array. Throws LLMError when nothing parseable is
 * present — the caller decides whether to retry with a repair prompt.
 */
export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const direct = tryParse<T>(cleaned);
  if (direct !== undefined) return direct;

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;
    const end = findBalancedEnd(cleaned, start, open, close);
    if (end === -1) continue;
    const candidate = cleaned.slice(start, end + 1);
    const repaired = tryParse<T>(repairJson(candidate));
    if (repaired !== undefined) return repaired;
  }
  throw new LLMError(`Could not parse JSON from model response: ${text.slice(0, 200)}`);
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function findBalancedEnd(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Common, safe repairs: trailing commas, smart quotes. */
function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}
