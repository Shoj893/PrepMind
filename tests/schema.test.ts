import { describe, expect, it } from "vitest";
import { validateKit } from "@/core/kit/validate";
import type { Kit } from "@/core/kit/types";
import { makeFlashcard, makeQuestion, makeRequirement } from "./helpers";

function baseKit(overrides: Partial<Kit> = {}): Kit {
  const reqs = [
    makeRequirement({ id: "req_1", kind: "must" }),
    makeRequirement({ id: "req_2", kind: "nice" }),
  ];
  const questions = [
    makeQuestion({ id: "q_1", requirement_ids: ["req_1"], difficulty: 3 }),
    makeQuestion({ id: "q_2", requirement_ids: ["req_2"], difficulty: 2 }),
  ];
  return {
    id: "kit_1",
    title: "Senior Engineer at ExampleCo",
    company: {
      name: "ExampleCo",
      url: "https://example.com",
      brief_md: "# ExampleCo\nThey build things.",
      sources: [],
      brief_edited: false,
    },
    role: {
      title: "Senior Engineer",
      summary_md: "Build things.",
      requirements: reqs,
    },
    questions,
    flashcards: [makeFlashcard({ id: "fc_1", requirement_ids: ["req_1"] })],
    schedule: {
      days: 2,
      items: [
        {
          day: 1,
          focus: "Technical",
          question_ids: ["q_1"],
          requirement_ids: ["req_1"],
          duration_minutes: 30,
        },
        {
          day: 2,
          focus: "Behavioural",
          question_ids: ["q_2"],
          requirement_ids: ["req_2"],
          duration_minutes: 25,
        },
      ],
    },
    coverage: {
      covered_requirement_ids: ["req_1", "req_2"],
      gaps: [],
      passes: 2,
    },
    meta: {
      days_requested: 2,
      model: "test-model",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      notices: [],
      sources_skipped: [],
    },
    ...overrides,
  };
}

describe("validateKit", () => {
  it("accepts a well-formed kit", () => {
    const result = validateKit(baseKit());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a duration that is not an integer number of minutes", () => {
    const kit = baseKit();
    kit.schedule.items[0].duration_minutes = 30.5;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/expected int/i);
  });

  it("rejects a question referencing an unknown requirement", () => {
    const kit = baseKit();
    kit.questions[0].requirement_ids = ["req_999"];
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/unknown requirement/);
  });

  it("rejects when the day count does not match the requested days", () => {
    const kit = baseKit();
    kit.schedule.days = 5;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/days/);
  });

  it("rejects a schedule missing a must-have requirement", () => {
    const kit = baseKit();
    kit.schedule.items[0].requirement_ids = [];
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must-have requirement req_1 is not in the schedule/);
  });

  it("rejects a question without requirement references", () => {
    const kit = baseKit();
    kit.questions[0].requirement_ids = [];
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
  });

  it("rejects difficulty outside 1..5 and duplicate ids", () => {
    const kit = baseKit();
    kit.questions[0].difficulty = 9;
    expect(validateKit(kit).ok).toBe(false);
    const dup = baseKit();
    dup.questions.push({ ...dup.questions[1], id: "q_1" });
    expect(validateKit(dup).errors.join(" ")).toMatch(/duplicate question ids/);
  });
});
