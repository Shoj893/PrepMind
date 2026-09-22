import dnsCallback from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { assertFetchableUrl, assertPublicHost, isPrivateIp, guardEnabled } from "./url";

/**
 * The single point through which every outbound page fetch flows.
 *
 * - SSRF: URL validated, then DNS checked pre-flight AND again at connect
 *   time via a custom DNS lookup passed to the dispatcher (closes the
 *   rebinding window).
 * - Politeness: max 2 requests in flight per host, at least one second
 *   between requests to the same host (raised to the site's crawl-delay).
 * - Resilience: up to 3 attempts on 429/5xx/network errors with exponential
 *   backoff and Retry-After support; redirects followed manually so every
 *   hop is re-validated.
 * - Limits: 10s per request, 2MB body cap, content-type allowlist.
 */

export const USER_AGENT =
  process.env.FETCH_USER_AGENT ??
  "PrepMindBot/1.0 (interview-prep kit generator; contact: prepmind@example.com)";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 4;
const MIN_HOST_INTERVAL_MS = 1000;
const MAX_CONCURRENT_PER_HOST = 2;

export const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
];

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export interface FetchedPage {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  body?: string;
  error?: string;
}

export interface FetchOptions {
  /** Extra politeness for aggressive sites (e.g. from robots.txt crawl-delay). */
  minHostIntervalMs?: number;
  accept?: string;
}

/** A page-level fetcher: what robots/crawl/discussion accept for injection. */
export type PageFetcher = (url: string, options?: FetchOptions) => Promise<FetchedPage>;

/** Raw fetch signature tests can stub to exercise retry logic directly. */
export type RawFetch = typeof undiciFetch;

/** Custom DNS lookup that re-checks every resolved address at connect time. */
const guardedLookup = (
  hostname: string,
  options: dnsCallback.LookupOneOptions,
  callback: (err: NodeJS.ErrnoException | null, address?: string | dnsCallback.LookupAddress, family?: number) => void
): void => {
  dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses as dnsCallback.LookupAddress];
    if (list.length === 0) {
      // Some resolvers report success with an empty list; treat as ENOTFOUND
      // so the fetch retries/fails normally instead of crashing net internals.
      const notFound = new Error(`lookup ${hostname} returned no addresses`) as NodeJS.ErrnoException;
      notFound.code = "ENOTFOUND";
      return callback(notFound);
    }
    if (guardEnabled()) {
      for (const entry of list) {
        if (isPrivateIp(entry.address)) {
          const blockErr = new FetchBlockedError(
            `${hostname} resolves to a private address (${entry.address})`
          ) as NodeJS.ErrnoException;
          blockErr.code = "EPREPMBLOCKED";
          return callback(blockErr);
        }
      }
    }
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
};

// The connect options type does not surface `lookup` in undici 7's typings;
// the runtime accepts it (it is forwarded to net.connect).
const guardedAgent = new Agent({
  connect: { lookup: guardedLookup, timeout: REQUEST_TIMEOUT_MS },
  headersTimeout: REQUEST_TIMEOUT_MS,
  bodyTimeout: REQUEST_TIMEOUT_MS,
} as ConstructorParameters<typeof Agent>[0]);

// --- per-host politeness state -------------------------------------------------

const lastRequestAt = new Map<string, number>();
const inFlight = new Map<string, number>();

async function acquireSlot(host: string, minIntervalMs: number): Promise<void> {
  for (;;) {
    const now = Date.now();
    const last = lastRequestAt.get(host) ?? 0;
    const current = inFlight.get(host) ?? 0;
    if (current < MAX_CONCURRENT_PER_HOST && now - last >= minIntervalMs) {
      inFlight.set(host, current + 1);
      lastRequestAt.set(host, now);
      return;
    }
    const waitMs = Math.max(minIntervalMs - (now - last), 0);
    await sleep(Math.max(waitMs, 50));
  }
}

function releaseSlot(host: string): void {
  const current = inFlight.get(host) ?? 1;
  inFlight.set(host, Math.max(0, current - 1));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- fetch --------------------------------------------------------------------

export async function fetchPage(rawUrl: string, options: FetchOptions & { rawFetch?: RawFetch } = {}): Promise<FetchedPage> {
  let url: URL;
  try {
    url = assertFetchableUrl(rawUrl);
  } catch (err) {
    return skipped(rawUrl, rawUrl, `rejected: ${(err as Error).message}`);
  }
  try {
    await assertPublicHost(url.hostname);
  } catch (err) {
    return skipped(rawUrl, rawUrl, `rejected: ${(err as Error).message}`);
  }

  const doFetch = options.rawFetch ?? undiciFetch;
  const minInterval = options.minHostIntervalMs ?? MIN_HOST_INTERVAL_MS;

  let currentUrl = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const attempt = await fetchWithRetries(doFetch, currentUrl, options, minInterval);
    if (!attempt.response) return attempt.page;

    const response = attempt.response;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return skipped(rawUrl, currentUrl.toString(), "redirect without location", response.status);
      }
      let next: URL;
      try {
        next = assertFetchableUrl(location, currentUrl.toString());
        await assertPublicHost(next.hostname);
      } catch (err) {
        return skipped(
          rawUrl,
          currentUrl.toString(),
          `rejected redirect target: ${(err as Error).message}`,
          response.status
        );
      }
      currentUrl = next;
      continue;
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    if (response.status !== 200) {
      return skipped(rawUrl, currentUrl.toString(), `HTTP ${response.status}`, response.status, contentType);
    }
    if (!isAllowedContentType(contentType)) {
      return skipped(
        rawUrl,
        currentUrl.toString(),
        `unsupported content type: ${contentType ?? "none"}`,
        response.status,
        contentType
      );
    }

    const bodyResult = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
    return {
      ok: true, // truncated content is still usable; error carries the notice
      url: rawUrl,
      finalUrl: currentUrl.toString(),
      status: response.status,
      contentType,
      body: bodyResult.text,
      error: bodyResult.truncated ? `body truncated at ${MAX_RESPONSE_BYTES} bytes` : undefined,
    };
  }

  return skipped(rawUrl, currentUrl.toString(), "too many redirects");
}

function skipped(
  url: string,
  finalUrl: string,
  error: string,
  status = 0,
  contentType?: string
): FetchedPage {
  return { ok: false, url, finalUrl, status, contentType, error };
}

async function fetchWithRetries(
  doFetch: RawFetch,
  url: URL,
  options: FetchOptions,
  minInterval: number
): Promise<{ page: FetchedPage; response?: Awaited<ReturnType<RawFetch>> }> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot(url.hostname, minInterval);
    try {
      const response = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "accept-language": "en",
        },
        dispatcher: guardedAgent,
      });
      // The slot is held only until the response headers arrive — politeness
      // between requests is enforced by lastRequestAt at acquire time.
      releaseSlot(url.hostname);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : Math.min(2 ** attempt * 1000, 15_000) + Math.floor(Math.random() * 500);
          await sleep(backoffMs);
          continue;
        }
        return {
          page: skipped(
            url.toString(),
            url.toString(),
            `HTTP ${response.status} after ${MAX_ATTEMPTS} attempts`,
            response.status
          ),
        };
      }
      return { page: { ok: true, url: url.toString(), finalUrl: url.toString(), status: response.status }, response };
    } catch (err) {
      releaseSlot(url.hostname);
      lastError = (err as Error).message;
      const blocked = (err as NodeJS.ErrnoException)?.code === "EPREPMBLOCKED";
      if (blocked) {
        return { page: skipped(url.toString(), url.toString(), `blocked: ${lastError}`) };
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(Math.min(2 ** attempt * 1000, 15_000));
        continue;
      }
    }
  }
  return {
    page: skipped(
      url.toString(),
      url.toString(),
      `network error after ${MAX_ATTEMPTS} attempts: ${lastError}`
    ),
  };
}

export function isAllowedContentType(contentType: string | undefined | null): boolean {
  if (!contentType) return true; // some servers omit it; body sniffing happens later
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(mime);
}

async function readBodyWithLimit(
  response: Awaited<ReturnType<RawFetch>>,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  let received = 0;
  let truncated = false;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      chunks.push(value.slice(0, maxBytes - (received - value.byteLength)));
      truncated = true;
      void reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decoder.decode(buffer), truncated };
}
