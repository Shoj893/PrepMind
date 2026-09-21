import * as cheerio from "cheerio";
import { fetchPage } from "./fetcher";
import { assertFetchableUrl } from "./url";
import { extractPage, looksLikeHtml, normaliseText } from "./html";

/**
 * Public discussion of a company's interview process.
 *
 * We search DuckDuckGo's HTML endpoint (no API key required) for discussion
 * of the company's process, take the top results, and fetch a couple of the
 * most promising pages with the same guarded fetcher used everywhere else.
 * If the search engine is unreachable or returns nothing, this is reported
 * as a skipped source — it never fails the run.
 */

export interface DiscussionResult {
  pages: { url: string; title: string; text: string }[];
  resultCount: number;
  skipped: { url: string; reason: string }[];
}

export async function searchDiscussion(
  companyName: string,
  options: { fetchImpl?: typeof fetchPage; maxFetches?: number } = {}
): Promise<DiscussionResult> {
  const fetchImpl = options.fetchImpl ?? fetchPage;
  const maxFetches = options.maxFetches ?? 2;
  const skipped: { url: string; reason: string }[] = [];

  const query = `${companyName} interview process experience`;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  let searchUrlValidated: URL;
  try {
    searchUrlValidated = assertFetchableUrl(searchUrl);
  } catch (err) {
    return { pages: [], resultCount: 0, skipped: [{ url: searchUrl, reason: (err as Error).message }] };
  }

  const results = await fetchImpl(searchUrlValidated.toString(), {
    accept: "text/html",
  });
  if (!results.ok || !results.body) {
    skipped.push({
      url: searchUrl,
      reason: results.error ?? `HTTP ${results.status}`,
    });
    return { pages: [], resultCount: 0, skipped };
  }

  const hits = parseDdgResults(results.body);
  if (hits.length === 0) {
    return { pages: [], resultCount: 0, skipped };
  }

  // Prefer personal/blog/forum discussions; the big boards usually block
  // automated access, and a blocked fetch is reported, not fatal.
  const BLOCK_LIST = ["glassdoor.", "linkedin.com", "indeed.", "google.", "duckduckgo.com"];
  const candidates = hits
    .filter((h) => !BLOCK_LIST.some((b) => h.url.includes(b)))
    .slice(0, maxFetches + 2);

  const pages: DiscussionResult["pages"] = [];
  for (const hit of candidates) {
    if (pages.length >= maxFetches) break;
    let url: URL;
    try {
      url = assertFetchableUrl(hit.url);
    } catch {
      skipped.push({ url: hit.url, reason: "invalid or unsafe result URL" });
      continue;
    }
    const page = await fetchImpl(url.toString());
    if (!page.ok || !page.body) {
      skipped.push({ url: hit.url, reason: page.error ?? `HTTP ${page.status}` });
      continue;
    }
    const text = looksLikeHtml(page.body)
      ? extractPage(page.body, page.finalUrl).text
      : normaliseText(page.body);
    if (text.replace(/\s+/g, " ").trim().length < 100) {
      skipped.push({ url: hit.url, reason: "page had no extractable content" });
      continue;
    }
    pages.push({ url: page.finalUrl, title: hit.title, text: text.slice(0, 8000) });
  }

  return { pages, resultCount: hits.length, skipped };
}

export function parseDdgResults(html: string): { title: string; url: string; snippet: string }[] {
  const $ = cheerio.load(html);
  const out: { title: string; url: string; snippet: string }[] = [];
  $("a.result__a, a.result-link").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const title = ($(el).text() || "").replace(/\s+/g, " ").trim();
    const url = unwrapDdgRedirect(href);
    if (!title || !url) return;
    out.push({ title, url, snippet: "" });
  });
  // snippets live in sibling elements keyed off the result anchor
  $("div.result").each((_, el) => {
    const anchor = $(el).find("a.result__a").first();
    const href = anchor.attr("href") ?? "";
    const url = unwrapDdgRedirect(href);
    const snippet = ($(el).find(".result__snippet").text() || "").replace(/\s+/g, " ").trim();
    const existing = out.find((r) => r.url === url);
    if (existing) existing.snippet = snippet;
  });
  return out.slice(0, 12);
}

/** DDG html results point at /l/?uddg=<encoded> redirects; unwrap them. */
function unwrapDdgRedirect(href: string): string {
  if (!href) return "";
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return uddg;
    return url.toString();
  } catch {
    return "";
  }
}
