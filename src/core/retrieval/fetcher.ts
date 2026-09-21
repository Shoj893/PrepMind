import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import dnsCallback from "node:dns";
import { assertFetchableUrl, assertPublicHost, isPrivateIp, guardEnabled } from "./url";

/**
 * The single point through which every outbound page fetch flows.
 *
 * - SSRF: URL validated, then DNS checked pre-flight AND again at connect
 *   time via a custom undici lookup (closes the rebinding window).
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

/** Custom DNS lookup that re-checks every resolved address at connect time. */
function guardedLookup(): NonNullable<Dispatcher.ConnectOptions["lookup"]> {
  return (
    hostname: string,
    options: dnsCallback.LookupAllOptions,
    callback: (err: NodeJS.ErrnoException | null, addresses?: dnsCallback.LookupAddress[]) => void
  ) => {
    dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [addresses as dnsCallback.LookupAddress];
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
      callback(null, list);
    });
  };
}

const guardedAgent = new Agent({
  connect: { lookup: guardedLookup(), timeout: REQUEST_TIMEOUT_MS },
  headersTimeout: REQUEST_TIMEOUT_MS,
  bodyTimeout: REQUEST_TIMEOUT_MS,
  maxRedirections: 0,
});

// --- per-host politeness state -------------------------------------------------

const lastRequestAt = new Map<string, number>();
const inFlight = new Map<string, number>();

async function acquireSlot(host: string, minIntervalMs: number): Promise<void> {
  // Serialise on a simple chain per host to keep interval + concurrency rules.
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

export interface FetchOptions {
  /** Extra politeness for aggressive sites (e.g. from robots.txt crawl-delay). */
  minHostIntervalMs?: number;
  accept?: string;
  method?: "GET" | "HEAD";
  /** Tests inject a fetch implementation. */
  fetchImpl?: typeof undiciFetch;
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  let url: URL;
  try {
    url = assertFetchableUrl(rawUrl);
  } catch (err) {
    return {
      ok: false,
      url: rawUrl,
      finalUrl: rawUrl,
      status: 0,
      error: `rejected: ${(err as Error).message}`,
    };
  }

  try {
    await assertPublicHost(url.hostname);
  } catch (err) {
    return {
      ok: false,
      url: rawUrl,
      finalUrl: rawUrl,
      status: 0,
      error: `rejected: ${(err as Error).message}`,
    };
  }

  const doFetch = options.fetchImpl ?? undiciFetch;
  const minInterval = options.minHostIntervalMs ?? MIN_HOST_INTERVAL_MS;

  let currentUrl = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const attemptResult = await fetchWithRetries(doFetch, currentUrl, options, minInterval);
    if (!attemptResult.response) return attemptResult.page;

    const { response } = attemptResult;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, url: rawUrl, finalUrl: currentUrl.toString(), status: response.status, error: "redirect without location" };
      }
      let next: URL;
      try {
        next = assertFetchableUrl(location, currentUrl.toString());
        await assertPublicHost(next.hostname);
      } catch (err) {
        return {
          ok: false,
          url: rawUrl,
          finalUrl: currentUrl.toString(),
          status: response.status,
          error: `rejected redirect target: ${(err as Error).message}`,
        };
      }
      currentUrl = next;
      continue;
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    if (response.status !== 200) {
      return {
        ok: false,
        url: rawUrl,
        finalUrl: currentUrl.toString(),
        status: response.status,
        contentType,
        error: `HTTP ${response.status}`,
      };
    }
    if (!isAllowedContentType(contentType)) {
      return {
        ok: false,
        url: rawUrl,
        finalUrl: currentUrl.toString(),
        status: response.status,
        contentType,
        error: `unsupported content type: ${contentType ?? "none"}`,
      };
    }

    const bodyResult = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
    return {
      ok: true, // truncated content is still usable, error carries the notice
      url: rawUrl,
      finalUrl: currentUrl.toString(),
      status: response.status,
      contentType,
      body: bodyResult.text,
      error: bodyResult.truncated ? `body truncated at ${MAX_RESPONSE_BYTES} bytes` : undefined,
    };
  }

  return { ok: false, url: rawUrl, finalUrl: currentUrl.toString(), status: 0, error: "too many redirects" };
}

async function fetchWithRetries(
  doFetch: typeof undiciFetch,
  url: URL,
  options: FetchOptions,
  minInterval: number
): Promise<{ page: FetchedPage; response?: Dispatcher.ResponseData }> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot(url.hostname, minInterval);
    try {
      const response = await doFetch(url, {
        dispatcher: guardedAgent,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "user-agent": USER_AGENT,
          accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "accept-language": "en",
        },
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : Math.min(2 ** attempt * 1000, 15_000) + Math.floor(Math.random() * 500);
        releaseSlot(url.hostname);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoffMs);
          continue;
        }
        return {
          page: {
            ok: false,
            url: url.toString(),
            finalUrl: url.toString(),
            status: response.status,
            error: `HTTP ${response.status} after ${MAX_ATTEMPTS} attempts`,
          },
        };
      }
      return { page: { ok: true, url: url.toString(), finalUrl: url.toString(), status: response.status }, response };
    } catch (err) {
      releaseSlot(url.hostname);
      lastError = (err as Error).message;
      const blocked = (err as NodeJS.ErrnoException)?.code === "EPREPMBLOCKED";
      if (blocked) {
        return {
          page: { ok: false, url: url.toString(), finalUrl: url.toString(), status: 0, error: `blocked: ${lastError}` },
        };
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(Math.min(2 ** attempt * 1000, 15_000));
        continue;
      }
    }
  }
  return {
    page: {
      ok: false,
      url: url.toString(),
      finalUrl: url.toString(),
      status: 0,
      error: `network error after ${MAX_ATTEMPTS} attempts: ${lastError}`,
    },
  };
}

export function isAllowedContentType(contentType: string | undefined | null): boolean {
  if (!contentType) return true; // some servers omit it; body sniffing happens later
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(mime);
}

async function readBodyWithLimit(
  response: Dispatcher.ResponseData,
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
