import { fetchPage, type FetchOptions } from "./fetcher";
import { getRobotsPolicy } from "./robots";
import { extractPage, looksLikeHtml, type ExtractedPage } from "./html";
import { assertFetchableUrl, sameSite } from "./url";

/**
 * Company-site crawler.
 *
 * We never hard-code paths. The homepage is fetched, its links are ranked by
 * how strongly their URL path and anchor text signal "this explains who we
 * are and how we hire", and the top candidates are fetched in turn. If the
 * homepage nav yields too little, we fall back to the site's sitemap.xml and
 * rank URLs from there. Every fetch is robots-checked and rate-limited.
 */

export interface CrawledPage {
  url: string;
  title: string;
  kind: PageKind;
  text: string;
  description: string;
}

export type PageKind = "home" | "hiring" | "about" | "engineering" | "other";

export interface CrawlResult {
  pages: CrawledPage[];
  skipped: { url: string; reason: string }[];
  crawlDelayMs: number;
}

export interface CrawlOptions extends FetchOptions {
  maxPages?: number;
  fetchImpl?: typeof fetchPage;
}

const HIRING_PATTERNS = [
  "career", "careers", "job", "jobs", "hiring", "join", "we-are-hiring",
  "how-we-hire", "interview", "open-roles", "openings", "vacancies", "positions", "recruit",
];
const ABOUT_PATTERNS = ["about", "who-we-are", "company", "team", "our-story", "mission", "values", "culture", "life-at"];
const ENGINEERING_PATTERNS = ["engineering", "blog", "tech", "developer", "handbook", "code", "dev-blog", "build"];

export function classifyUrl(url: string, anchorText = ""): PageKind | undefined {
  const haystack = `${url.toLowerCase()} ${anchorText.toLowerCase()}`;
  if (HIRING_PATTERNS.some((p) => haystack.includes(p))) return "hiring";
  if (ABOUT_PATTERNS.some((p) => haystack.includes(p))) return "about";
  if (ENGINEERING_PATTERNS.some((p) => haystack.includes(p))) return "engineering";
  return undefined;
}

/** Rank candidate links: hiring signals strongest, then about, then engineering. */
export function rankLinks(
  links: { href: string; text: string }[],
  baseUrl: URL
): { href: string; text: string; score: number }[] {
  const scored = links
    .filter((link) => {
      try {
        const url = assertFetchableUrl(link.href, baseUrl.toString());
        return sameSite(url, baseUrl);
      } catch {
        return false;
      }
    })
    .map((link) => {
      const url = new URL(link.href, baseUrl);
      const path = url.pathname.toLowerCase();
      let score = 0;
      if (HIRING_PATTERNS.some((p) => path.includes(p) || link.text.toLowerCase().includes(p))) score += 5;
      if (/how-we-hire|interview|handbook/.test(path)) score += 2;
      if (ABOUT_PATTERNS.some((p) => path.includes(p) || link.text.toLowerCase().includes(p))) score += 3;
      if (ENGINEERING_PATTERNS.some((p) => path.includes(p) || link.text.toLowerCase().includes(p))) score += 2;
      // Mild penalty for very deep paths (tag pages, pagination) and for links
      // whose anchor text is empty.
      const depth = path.split("/").filter(Boolean).length;
      if (depth > 4) score -= 1;
      if (!link.text) score -= 0.5;
      // penalise obviously administrative pages
      if (/privacy|terms|cookie|contact|press|login|signup|status|docs\/api/.test(path)) score -= 4;
      return { href: new URL(link.href, baseUrl).toString(), text: link.text, score };
    })
    .filter((l) => l.score > 0);

  // stable deterministic ordering: score desc, then href asc
  return scored.sort((a, b) => b.score - a.score || a.href.localeCompare(b.href));
}

export async function crawlCompanySite(
  companyUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 6;
  const fetchImpl = options.fetchImpl ?? fetchPage;
  const skipped: { url: string; reason: string }[] = [];
  const pages: CrawledPage[] = [];

  let baseUrl: URL;
  try {
    baseUrl = assertFetchableUrl(companyUrl);
    if (!/\/$/.test(baseUrl.pathname)) {
      baseUrl = new URL(`${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, "")}/`);
    }
  } catch (err) {
    return {
      pages: [],
      skipped: [{ url: companyUrl, reason: (err as Error).message }],
      crawlDelayMs: 0,
    };
  }

  const policy = await getRobotsPolicy(baseUrl.toString(), fetchImpl);
  const minInterval = Math.max(options.minHostIntervalMs ?? 0, policy.crawlDelayMs);

  const home = await fetchImpl(baseUrl.toString(), { ...options, minHostIntervalMs: minInterval });
  if (!home.ok || !home.body) {
    skipped.push({ url: baseUrl.toString(), reason: home.error ?? `HTTP ${home.status}` });
    // Some sites 404 the bare path but serve the domain root; try it once.
    if (home.status === 404 && baseUrl.pathname !== "/") {
      const root = await fetchImpl(baseUrl.origin + "/", { ...options, minHostIntervalMs: minInterval });
      if (!root.ok || !root.body) {
        skipped.push({ url: baseUrl.origin + "/", reason: root.error ?? `HTTP ${root.status}` });
        return { pages, skipped, crawlDelayMs: policy.crawlDelayMs };
      }
      home.ok = true;
      home.body = root.body;
      home.finalUrl = root.finalUrl;
    } else {
      return { pages, skipped, crawlDelayMs: policy.crawlDelayMs };
    }
  }

  const homeHtml = looksLikeHtml(home.body) ? home.body : "";
  if (!homeHtml) {
    // A plain-text or JSON response: still usable as a brief source of text.
    pages.push({
      url: home.finalUrl,
      title: baseUrl.hostname,
      kind: "home",
      text: home.body.slice(0, 8000),
      description: "",
    });
    return { pages, skipped, crawlDelayMs: policy.crawlDelayMs };
  }

  const homeExtracted = extractPage(homeHtml, home.finalUrl);
  pages.push({
    url: home.finalUrl,
    title: homeExtracted.title || baseUrl.hostname,
    kind: "home",
    text: homeExtracted.text,
    description: homeExtracted.description,
  });

  // 1) rank homepage links
  let candidates = rankLinks(homeExtracted.links, baseUrl);

  // 2) not enough signal? fall back to sitemap.xml
  if (candidates.filter((c) => c.score >= 3).length < 2) {
    const sitemapPages = await fetchSitemapCandidates(baseUrl, fetchImpl, options, minInterval, skipped);
    if (sitemapPages.length > 0) {
      const seen = new Set(candidates.map((c) => c.href));
      for (const c of sitemapPages) {
        if (!seen.has(c.href)) candidates.push(c);
      }
      candidates = candidates.sort((a, b) => b.score - a.score || a.href.localeCompare(b.href));
    }
  }

  const fetchedUrls = new Set<string>([home.finalUrl, baseUrl.toString()]);
  for (const candidate of candidates) {
    if (pages.length >= maxPages) break;
    if (fetchedUrls.has(candidate.href)) continue;
    fetchedUrls.add(candidate.href);
    if (!policy.isAllowed(candidate.href)) {
      skipped.push({ url: candidate.href, reason: "disallowed by robots.txt" });
      continue;
    }
    const page = await fetchImpl(candidate.href, { ...options, minHostIntervalMs: minInterval });
    if (!page.ok || !page.body) {
      skipped.push({ url: candidate.href, reason: page.error ?? `HTTP ${page.status}` });
      continue;
    }
    const body = looksLikeHtml(page.body) ? page.body : "";
    if (!body) {
      skipped.push({ url: candidate.href, reason: "unsupported content (not HTML)" });
      continue;
    }
    const extracted = extractPage(body, page.finalUrl);
    if (extracted.text.replace(/\s+/g, " ").trim().length < 80) continue; // nav-only shells
    const kind = classifyUrl(page.finalUrl, candidate.text) ?? "other";
    pages.push({
      url: page.finalUrl,
      title: extracted.title || candidate.text || page.finalUrl,
      kind,
      text: extracted.text,
      description: extracted.description,
    });
  }

  return { pages, skipped, crawlDelayMs: policy.crawlDelayMs };
}

async function fetchSitemapCandidates(
  baseUrl: URL,
  fetchImpl: typeof fetchPage,
  options: FetchOptions,
  minInterval: number,
  skipped: { url: string; reason: string }[]
): Promise<{ href: string; text: string; score: number }[]> {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl.origin).toString();
  if (!/^https?:$/.test(new URL(sitemapUrl).protocol)) return [];
  const page = await fetchImpl(sitemapUrl, { ...options, minHostIntervalMs: minInterval });
  if (!page.ok || !page.body) {
    skipped.push({ url: sitemapUrl, reason: page.error ?? `HTTP ${page.status}` });
    return [];
  }
  const locs = [...page.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  return rankLinks(
    locs.slice(0, 300).map((href) => ({ href, text: "" })),
    baseUrl
  );
}

export type { ExtractedPage };
