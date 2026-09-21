import * as cheerio from "cheerio";

/**
 * Untrusted-HTML handling: every page we fetch is parsed with cheerio,
 * scripts/styles are stripped, and we keep only text and links. The text we
 * hand to the model is content to be processed, never instructions — the
 * prompt layer additionally wraps it in delimiters with that instruction.
 */

const MAX_TEXT_CHARS = 12_000;

const STRIP_SELECTORS =
  "script, style, noscript, svg, iframe, template, link, form, button, nav .menu-toggle";

export interface ExtractedLink {
  href: string;
  text: string;
}

export interface ExtractedPage {
  title: string;
  description: string;
  text: string;
  links: ExtractedLink[];
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS).remove();

  const title = ($("title").first().text() || "").trim().slice(0, 300);
  const description = (
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  )
    .trim()
    .slice(0, 500);

  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    const trimmed = raw.trim();
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return;
    try {
      const resolved = new URL(trimmed, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
      // drop the fragment for dedup purposes
      resolved.hash = "";
      const key = resolved.toString();
      if (seen.has(key)) return;
      seen.add(key);
      const text = ($(el).text() || "").replace(/\s+/g, " ").trim().slice(0, 120);
      links.push({ href: key, text });
    } catch {
      // unresolvable href — skip
    }
  });

  const text = normaliseText(extractMainText($));

  return { title, description, text, links };
}

/** Prefer main/article content when present, else the whole body. */
function extractMainText($: cheerio.CheerioAPI): string {
  const candidates = ["main", "article", '[role="main"]'];
  for (const selector of candidates) {
    const $el = $(selector).first();
    if ($el.length > 0) {
      const text = $el.text();
      if (text && text.replace(/\s+/g, " ").trim().length > 200) return text;
    }
  }
  // Fall back to body, but drop obvious chrome to reduce noise.
  const $body = $("body").length > 0 ? $("body") : $.root();
  const $clone = cheerio.load($.html());
  $clone("script, style, noscript, svg, iframe, template, nav, footer, header").remove();
  return $clone("body").text() || $clone.root().text();
}

export function normaliseText(text: string): string {
  const collapsed = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return collapsed.length > MAX_TEXT_CHARS
    ? `${collapsed.slice(0, MAX_TEXT_CHARS)}\n[content truncated]`
    : collapsed;
}

/** Quick sniff when a server omits the content-type header. */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 1000).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html") || head.includes("<head");
}
