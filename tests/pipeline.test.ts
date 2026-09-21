import { describe, expect, it } from "vitest";
import { FakeLLM } from "@/core/llm/fake";
import {
  MAX_COVERAGE_PASSES,
  companyFromUrl,
  generateKit,
  normaliseRequirements,
  PipelineError,
  type Progress,
} from "@/core/llm/pipeline";
import {
  regenerateFlashcards,
  regenerateQuestionsForCategory,
  regenerateSchedule,
} from "@/core/llm/regen";
import type { CrawlResult } from "@/core/retrieval/crawl";
import type { DiscussionResult } from "@/core/retrieval/discussion";

const JD = `Senior Frontend Engineer

We are looking for a senior frontend engineer.

Responsibilities:
- Build user interfaces with React and TypeScript
- Mentor junior engineers and lead design discussions
- Design reliable systems that scale to millions of users

Requirements:
- 5+ years of experience with React and TypeScript (required)
- Experience mentoring junior engineers
- Bonus: experience with Kubernetes (nice to have)`;

const crawlResult: CrawlResult = {
  pages: [
    {
      url: "https://acme.example/",
      title: "Acme — Home",
      kind: "home",
      description: "",
      text: "Acme builds developer tools for platform teams. ".repeat(10),
    },
    {
      url: "https://acme.example/careers",
      title: "Careers at Acme",
      kind: "hiring",
      description: "",
      text: "Our hiring process: intro call, take-home, then a system design round and a behavioural interview. ".repeat(8),
    },
  ],
  skipped: [{ url: "https://acme.example/sitemap.xml", reason: "HTTP 404" }],
  crawlDelayMs: 0,
};

const discussionResult: DiscussionResult = {
  pages: [
    {
      url: "https://blog.someone.example/acme-interview",
      title: "My Acme interview experience",
      text: "The take-home was fair and the system design round was practical. ".repeat(8),
    },
  ],
  resultCount: 5,
  skipped: [],
};

function makeDeps(overrides = {}) {
  return {
    llm: new FakeLLM(),
    crawl: async () => crawlResult,
    searchDiscussion: async () => discussionResult,
    now: () => new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  };
}

describe("generateKit (fake LLM, fake retrieval)", () => {
  it("runs the full pipeline and produces a valid kit", async () => {
    const kit = await generateKit(
      { jd: JD, companyUrl: "https://acme.example", days: 5 },
      makeDeps()
    );
    expect(kit.role.requirements.length).toBeGreaterThanOrEqual(3);
    expect(kit.questions.length).toBeGreaterThanOrEqual(kit.role.requirements.length);
    expect(kit.schedule.days).toBe(5);
    expect(kit.schedule.items).toHaveLength(5);
    expect(kit.company.brief_md).toContain("Acme");
    expect(kit.company.sources.some((s) => s.kind === "hiring")).toBe(true);
    expect(kit.company.sources.some((s) => s.kind === "discussion")).toBe(true);
    expect(kit.flashcards.length).toBeGreaterThan(0);
    expect(kit.coverage.gaps).toEqual([]);
    // every question references a real requirement
    const reqIds = new Set(kit.role.requirements.map((r) => r.id));
    for (const q of kit.questions) {
      for (const rid of q.requirement_ids) expect(reqIds.has(rid)).toBe(true);
    }
  });

  it("assigns question categories that follow the requirement category", async () => {
    const kit = await generateKit(
      { jd: JD, companyUrl: "https://acme.example", days: 4 },
      makeDeps()
    );
    const byId = new Map(kit.role.requirements.map((r) => [r.id, r]));
    for (const q of kit.questions) {
      const req = byId.get(q.requirement_ids[0]!)!;
      expect(q.category).toBe(req.category);
    }
  });

  it("reports skipped sources instead of failing", async () => {
    const kit = await generateKit(
      { jd: JD, companyUrl: "https://acme.example", days: 3 },
      makeDeps({
        crawl: async () => ({ ...crawlResult, skipped: [{ url: "https://acme.example/careers", reason: "HTTP 500" }] }),
        searchDiscussion: async () => ({
          pages: [],
          resultCount: 0,
          skipped: [{ url: "https://html.duckduckgo.com/html/?q=x", reason: "HTTP 403" }],
        }),
      })
    );
    expect(kit.meta.sources_skipped.length).toBeGreaterThanOrEqual(2);
    expect(kit.meta.notices.some((n) => n.includes("No public discussion"))).toBe(true);
  });

  it("handles a crawl that finds nothing: honest brief, not fabricated", async () => {
    const kit = await generateKit(
      { jd: JD, companyUrl: "https://acme.example", days: 2 },
      makeDeps({
        crawl: async () => ({ pages: [], skipped: [{ url: "https://acme.example/", reason: "HTTP 404" }], crawlDelayMs: 0 }),
        searchDiscussion: async () => ({ pages: [], resultCount: 0, skipped: [] }),
      })
    );
    expect(kit.company.brief_md).toMatch(/nothing could be retrieved|Unknown/i);
    expect(kit.meta.notices.some((n) => n.includes("Nothing could be retrieved"))).toBe(true);
  });

  it("fills coverage gaps in a second pass (COBOL requirement blind spot)", async () => {
    const jd = `${JD}\n- Must know obscure legacy COBOL systems`;
    const kit = await generateKit({ jd, companyUrl: "https://acme.example", days: 6 }, makeDeps());
    const cobol = kit.role.requirements.find((r) => /COBOL/i.test(r.text));
    expect(cobol).toBeDefined();
    expect(kit.questions.some((q) => q.requirement_ids.includes(cobol!.id))).toBe(true);
    expect(kit.coverage.gaps).toEqual([]);
    expect(kit.coverage.passes).toBe(2);
  });

  it("reports gaps honestly after MAX_COVERAGE_PASSES", async () => {
    // A requirement the fake never fills, even on gap-fill passes.
    const kitDeps = makeDeps({
      crawl: async () => ({ pages: [], skipped: [], crawlDelayMs: 0 }),
      searchDiscussion: async () => ({ pages: [], resultCount: 0, skipped: [] }),
    });
    const kit = await generateKit(
      { jd: "Only requirement: unfillable arcane system administration (required)", companyUrl: "https://acme.example", days: 3 },
      kitDeps
    );
    expect(kit.coverage.gaps.length).toBeGreaterThan(0);
    expect(kit.coverage.passes).toBe(MAX_COVERAGE_PASSES);
    expect(kit.meta.notices.some((n) => n.includes("still had no question"))).toBe(true);
    // the must-have gap still gets self-study time in the schedule
    const scheduledReqs = new Set(kit.schedule.items.flatMap((d) => d.requirement_ids));
    const unfillable = kit.role.requirements.find((r) => /unfillable/i.test(r.text))!;
    expect(scheduledReqs.has(unfillable.id)).toBe(true);
  });

  it("rejects a job description that is too short", async () => {
    await expect(
      generateKit({ jd: "too short", companyUrl: "https://acme.example", days: 3 }, makeDeps())
    ).rejects.toBeInstanceOf(PipelineError);
  });

  it("records progress events through the whole run", async () => {
    const stages: string[] = [];
    await generateKit(
      { jd: JD, companyUrl: "https://acme.example", days: 3 },
      makeDeps({ onProgress: (p: Progress) => stages.push(p.stage) })
    );
    expect(stages[0]).toBe("requirements");
    expect(stages).toContain("crawl");
    expect(stages).toContain("coverage");
    expect(stages[stages.length - 1]).toBe("done");
  });
});

describe("normaliseRequirements", () => {
  it("clamps invalid kinds and categories, reassigns ids", () => {
    const reqs = normaliseRequirements(
      [
        { text: "React experience required", kind: "super-must", category: "alien" },
        { text: "Bonus: Rust", kind: "nice", category: "technical" },
      ],
      "jd"
    );
    expect(reqs.map((r) => r.id)).toEqual(["req_1", "req_2"]);
    expect(reqs[0].kind).toBe("must"); // invalid kind defaults to must
    expect(reqs[0].category).toBe("technical"); // invalid category defaults
    expect(reqs[1].kind).toBe("nice");
  });

  it("falls back to the first JD line rather than inventing requirements", () => {
    const reqs = normaliseRequirements([], "Baker of sourdough breads and pastries");
    expect(reqs).toHaveLength(1);
    expect(reqs[0].text).toContain("sourdough");
  });
});

describe("companyFromUrl", () => {
  it("derives a display name from the hostname", () => {
    expect(companyFromUrl("https://www.gitlab.com", "x")).toBe("Gitlab");
    expect(companyFromUrl("https://about.posthog.com", "x")).toBe("Posthog");
    expect(companyFromUrl("not a url", "Fallback")).toBe("Fallback");
  });
});

describe("regeneration preserves user work", () => {
  async function makeKit(days = 5) {
    return generateKit({ jd: JD, companyUrl: "https://acme.example", days }, makeDeps());
  }

  it("regenerating a category keeps edited and user questions, refills coverage", async () => {
    const kit = await makeKit();
    const technical = kit.questions.filter((q) => q.category === "technical");
    expect(technical.length).toBeGreaterThan(0);

    // Simulate user state on two questions: one edited, one hand-added.
    const edited = { ...technical[0], origin: "edited" as const };
    const userAdded = {
      ...technical[0],
      id: "q_user_1",
      prompt: "My own question about React reconciliation?",
      origin: "user" as const,
      pinned: true,
    };
    const withUserState = {
      ...kit,
      questions: [
        ...kit.questions.map((q) => (q.id === edited.id ? edited : q)),
        userAdded,
      ],
    };

    const regen = await regenerateQuestionsForCategory(withUserState, "technical", makeDeps());
    // edited + user questions survive
    expect(regen.questions.some((q) => q.id === edited.id && q.origin === "edited")).toBe(true);
    expect(regen.questions.some((q) => q.id === "q_user_1" && q.origin === "user")).toBe(true);
    // the removed generated questions were replaced with fresh generated ones
    const removedIds = new Set(
      withUserState.questions
        .filter((q) => q.category === "technical" && q.origin === "generated" && !q.pinned)
        .map((q) => q.id)
    );
    const fresh = regen.questions.filter(
      (q) => q.category === "technical" && q.origin === "generated" && !removedIds.has(q.id)
    );
    expect(fresh.length).toBeGreaterThan(0);
    // still valid: schedule rebuilt, coverage recomputed
    expect(regen.coverage.gaps).toEqual([]);
    const scheduledQids = new Set(regen.schedule.items.flatMap((d) => d.question_ids));
    for (const q of regen.questions) {
      if (q.requirement_ids.some((rid) => kit.role.requirements.find((r) => r.id === rid)?.kind === "must")) {
        expect(scheduledQids.has(q.id)).toBe(true);
      }
    }
  });

  it("regenerating the schedule keeps every must-have and the day count", async () => {
    const kit = await makeKit(4);
    const regen = regenerateSchedule(kit);
    expect(regen.schedule.days).toBe(4);
    const scheduledReqs = new Set(regen.schedule.items.flatMap((d) => d.requirement_ids));
    for (const req of kit.role.requirements.filter((r) => r.kind === "must")) {
      expect(scheduledReqs.has(req.id)).toBe(true);
    }
    // other sections untouched
    expect(regen.questions).toEqual(kit.questions);
    expect(regen.company.brief_md).toBe(kit.company.brief_md);
  });

  it("regenerating flashcards keeps user cards", async () => {
    const kit = await makeKit(3);
    const userCard = {
      id: "fc_user_1",
      front: "What is my own card?",
      back: "My answer.",
      requirement_ids: [kit.role.requirements[0].id],
      origin: "user" as const,
      pinned: false,
    };
    const regen = await regenerateFlashcards(
      { ...kit, flashcards: [...kit.flashcards, userCard] },
      makeDeps()
    );
    expect(regen.flashcards.some((f) => f.id === "fc_user_1")).toBe(true);
  });
});
