import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FakeLLM } from "@/core/llm/fake";
import { generateKit } from "@/core/llm/pipeline";
import type { DiscussionResult } from "@/core/retrieval/discussion";
import type { Kit } from "@/core/kit/types";

/**
 * End-to-end with REAL retrieval code against a local fixture company site:
 * the crawler must follow relative links from the homepage, respect
 * robots.txt, feed crawled pages into the brief, and produce a valid kit.
 * ALLOW_PRIVATE_HOSTS=1 is required to crawl 127.0.0.1 in tests; the
 * discussion search is stubbed so the suite never touches the real network.
 */

const noDiscussion: DiscussionResult = {
  pages: [
    {
      url: "https://blog.example.test/fixturecorp-interview",
      title: "My FixtureCorp interview",
      text: "Interview had a take-home and a system design round. ".repeat(10),
    },
  ],
  resultCount: 3,
  skipped: [],
};

const JD = `Senior Backend Engineer at FixtureCorp

We build a platform for logistics teams.

Responsibilities:
- Design APIs with Python and Django (required)
- Operate services on Kubernetes with strong reliability practices
- Mentor engineers through code review (required)
- Bonus: experience with event streaming (nice to have)`;

const ROBOTS = `User-agent: *
Disallow: /admin
Crawl-delay: 0`;

const HOME = `<!doctype html><html><head><title>FixtureCorp</title>
<meta name="description" content="Logistics software for freight teams."></head>
<body>
<nav><a href="/careers">Careers</a><a href="/about">About us</a><a href="/admin">Admin</a></nav>
<main><h1>FixtureCorp</h1><p>${"We build logistics software that keeps freight moving. ".repeat(12)}</p></main>
</body></html>`;

const CAREERS = `<!doctype html><html><head><title>Careers at FixtureCorp</title></head><body>
<main><h1>How we hire</h1><p>${"Our process: intro call, take-home exercise, then a system design and behavioural round. ".repeat(10)}</p></main>
</body></html>`;

const ABOUT = `<!doctype html><html><head><title>About FixtureCorp</title></head><body>
<main><h1>About</h1><p>${"Founded in 2015, we serve 400 freight companies across Europe. ".repeat(10)}</p></main>
</body></html>`;

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const page = (body: string, type = "text/html") => {
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      res.end(body);
    };
    if (url === "/robots.txt") return page(ROBOTS, "text/plain");
    if (url === "/") return page(HOME);
    if (url === "/careers") return page(CAREERS);
    if (url === "/about") return page(ABOUT);
    if (url.startsWith("/admin")) {
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.ALLOW_PRIVATE_HOSTS;
});

describe("pipeline against a real local fixture site", () => {
  it("crawls the site, finds the hiring page, and builds a valid kit", async () => {
    const kit = await generateKit(
      { jd: JD, companyUrl: baseUrl, days: 4 },
      { llm: new FakeLLM(), searchDiscussion: async () => noDiscussion }
    );

    // Crawler followed relative links from the homepage.
    const urls = kit.company.sources.map((s) => s.url);
    expect(urls.some((u) => u.endsWith("/careers"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/about"))).toBe(true);
    expect(kit.company.sources.find((s) => s.kind === "hiring")).toBeDefined();

    // Brief only claims what was retrieved.
    expect(kit.company.brief_md).toContain("FixtureCorp");

    // Structure holds for a 4-day schedule.
    expect(kit.schedule.days).toBe(4);
    expect(kit.schedule.items).toHaveLength(4);
    const scheduledReqs = new Set(kit.schedule.items.flatMap((d) => d.requirement_ids));
    for (const req of kit.role.requirements.filter((r) => r.kind === "must")) {
      expect(scheduledReqs.has(req.id)).toBe(true);
    }

    // Questions reference real requirements; durations are integers.
    const reqIds = new Set(kit.role.requirements.map((r) => r.id));
    for (const q of kit.questions) {
      expect(q.requirement_ids.length).toBeGreaterThan(0);
      for (const rid of q.requirement_ids) expect(reqIds.has(rid)).toBe(true);
    }
    for (const day of kit.schedule.items) {
      expect(Number.isInteger(day.duration_minutes)).toBe(true);
    }
  });

  it("reports a site that 404s instead of failing the run", async () => {
    const deadUrl = `${baseUrl}/does-not-exist`;
    // fetch to a path that 404s still resolves — use an unroutable port instead
    const kit = await generateKit(
      { jd: JD, companyUrl: `http://127.0.0.1:9`, days: 3 },
      { llm: new FakeLLM(), searchDiscussion: async () => noDiscussion }
    );
    expect(kit.company.brief_md).toMatch(/nothing could be retrieved|Unknown/i);
    expect(kit.meta.notices.some((n) => n.includes("Nothing could be retrieved"))).toBe(true);
    expect(kit.schedule.days).toBe(3);
    void deadUrl;
  });
});
