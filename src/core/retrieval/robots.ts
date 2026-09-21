import { fetchPage } from "./fetcher";
import { assertFetchableUrl } from "./url";

/**
 * Minimal robots.txt support: we fetch it once per origin, cache it, and use
 * it to decide whether our crawler may fetch a path. We honour `Disallow`
 * rules for our UA and `*`, `Allow` rules, and raise our per-host interval to
 * the site's `Crawl-delay` (capped at 10s).
 */

export interface RobotsPolicy {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
  fetched: boolean;
}

const CACHE = new Map<string, { policy: RobotsPolicy; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CRAWL_DELAY_MS = 10_000;

interface Rule {
  allow: boolean;
  path: string;
  length: number;
}

export async function getRobotsPolicy(
  siteUrl: string,
  fetchImpl: typeof fetchPage = fetchPage
): Promise<RobotsPolicy> {
  const origin = new URL(siteUrl).origin;
  const cached = CACHE.get(origin);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.policy;

  const policy = await loadPolicy(origin, fetchImpl);
  CACHE.set(origin, { policy, cachedAt: Date.now() });
  return policy;
}

export function clearRobotsCache(): void {
  CACHE.clear();
}

async function loadPolicy(origin: string, fetchImpl: typeof fetchPage): Promise<RobotsPolicy> {
  let robotsUrl: URL;
  try {
    robotsUrl = assertFetchableUrl(`${origin}/robots.txt`);
  } catch {
    return allowAll();
  }
  const page = await fetchImpl(robotsUrl.toString());
  if (!page.ok || !page.body) {
    // 404 or unreachable robots.txt: convention is that crawling is permitted.
    return allowAll();
  }
  const { rules, delayMs } = parseRobots(page.body);
  return {
    isAllowed(url: string) {
      try {
        const parsed = assertFetchableUrl(url);
        if (parsed.origin !== origin) return true;
        return evaluate(parsed.pathname + (parsed.search || ""), rules);
      } catch {
        return false;
      }
    },
    crawlDelayMs: delayMs,
    fetched: true,
  };
}

function allowAll(): RobotsPolicy {
  return { isAllowed: () => true, crawlDelayMs: 0, fetched: false };
}

function evaluate(path: string, rules: Rule[]): boolean {
  // Longest match wins; Allow beats Disallow on ties (Google's interpretation).
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!matchPath(rule.path, path)) continue;
    if (
      !best ||
      rule.length > best.length ||
      (rule.length === best.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

function matchPath(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  const escaped = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}`).test(path);
}

export function parseRobots(body: string): { rules: Rule[]; delayMs: number } {
  const rules: Rule[] = [];
  let delayMs = 0;
  // Robots groups are runs of user-agent lines followed by rules; rules apply
  // to the most recently declared user-agent. We track whether that UA is us.
  let appliesToUs = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      appliesToUs = value === "*" || value.toLowerCase().includes("prepmind");
      continue;
    }
    if (field === "crawl-delay" && appliesToUs) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        delayMs = Math.max(delayMs, Math.min(seconds * 1000, MAX_CRAWL_DELAY_MS));
      }
      continue;
    }
    if ((field === "allow" || field === "disallow") && appliesToUs) {
      rules.push({ allow: field === "allow", path: value, length: value.length });
    }
  }
  return { rules, delayMs };
}
