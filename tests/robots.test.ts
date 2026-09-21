import { describe, expect, it } from "vitest";
import { parseRobots } from "@/core/retrieval/robots";

describe("robots.txt parsing", () => {
  it("honours disallow rules for *", () => {
    const { rules } = parseRobots(`
User-agent: *
Disallow: /private/
Disallow: /tmp
Allow: /tmp/public/
Crawl-delay: 2
`);
    expect(rules).toHaveLength(3);
  });

  it("ignores rules for other user agents", () => {
    const { rules } = parseRobots(`
User-agent: Googlebot
Disallow: /
`);
    expect(rules).toHaveLength(0);
  });

  it("captures crawl delay for us", () => {
    const { delayMs } = parseRobots(`
User-agent: *
Crawl-delay: 3
`);
    expect(delayMs).toBe(3000);
  });

  it("caps very large crawl delays", () => {
    const { delayMs } = parseRobots(`
User-agent: *
Crawl-delay: 3600
`);
    expect(delayMs).toBeLessThanOrEqual(10_000);
  });

  it("strips comments and handles empty disallow", () => {
    const { rules } = parseRobots(`
User-agent: *   # everyone
Disallow:       # empty = allow all
Disallow: /x # comment
`);
    // empty disallow should be present as a rule but must never match
    const empty = rules.find((r) => r.path === "");
    expect(empty).toBeDefined();
  });
});
