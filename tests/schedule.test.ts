import { describe, expect, it } from "vitest";
import { buildSchedule, questionMinutes } from "@/core/kit/schedule";
import { makeQuestion, makeRequirement } from "./helpers";

function scenario(nMust = 4, nNice = 3) {
  const reqs = [
    ...Array.from({ length: nMust }, (_, i) =>
      makeRequirement({ id: `req_m${i}`, kind: "must" as const, category: "technical" as const })
    ),
    ...Array.from({ length: nNice }, (_, i) =>
      makeRequirement({ id: `req_n${i}`, kind: "nice" as const, category: "behavioural" as const })
    ),
  ];
  const questions = reqs.map((r, i) =>
    makeQuestion({
      id: `q_${i + 1}`,
      requirement_ids: [r.id],
      difficulty: (i % 5) + 1,
      category: r.category,
    })
  );
  return { reqs, questions };
}

describe("buildSchedule", () => {
  it("produces exactly the requested number of days", () => {
    const { reqs, questions } = scenario();
    for (const days of [1, 3, 7, 60]) {
      const { schedule } = buildSchedule({ days, requirements: reqs, questions });
      expect(schedule.days).toBe(days);
      expect(schedule.items).toHaveLength(days);
      expect(schedule.items.map((d) => d.day)).toEqual(
        Array.from({ length: days }, (_, i) => i + 1)
      );
    }
  });

  it("schedules every must-have requirement", () => {
    const { reqs, questions } = scenario(6, 4);
    const { schedule } = buildSchedule({ days: 4, requirements: reqs, questions });
    const scheduled = new Set(schedule.items.flatMap((d) => d.requirement_ids));
    for (const req of reqs.filter((r) => r.kind === "must")) {
      expect(scheduled.has(req.id)).toBe(true);
    }
  });

  it("puts harder, must-have material earlier", () => {
    const reqs = [
      makeRequirement({ id: "r_must_hard", kind: "must" }),
      makeRequirement({ id: "r_nice_easy", kind: "nice" }),
    ];
    const questions = [
      makeQuestion({ id: "q_hard", requirement_ids: ["r_must_hard"], difficulty: 5 }),
      makeQuestion({ id: "q_easy", requirement_ids: ["r_nice_easy"], difficulty: 1 }),
    ];
    const { schedule } = buildSchedule({
      days: 2,
      requirements: reqs,
      questions,
      minutesPerDay: 50, // hard question alone eats most of a day
    });
    expect(schedule.items[0].question_ids).toContain("q_hard");
    expect(schedule.items[0].question_ids).not.toContain("q_easy");
    expect(schedule.items[1].question_ids).toContain("q_easy");
  });

  it("keeps durations as integer minutes within the daily budget", () => {
    const { reqs, questions } = scenario(5, 5);
    const { schedule } = buildSchedule({ days: 3, requirements: reqs, questions, minutesPerDay: 90 });
    for (const day of schedule.items) {
      expect(Number.isInteger(day.duration_minutes)).toBe(true);
      const fromQuestions = day.question_ids.reduce((sum, id) => {
        const q = questions.find((x) => x.id === id)!;
        return sum + questionMinutes(q.difficulty);
      }, 0);
      if (!day.note?.includes("Compressed")) {
        expect(day.duration_minutes).toBe(fromQuestions);
        expect(day.duration_minutes).toBeLessThanOrEqual(90);
      }
    }
  });

  it("handles the 1-day case by putting everything on day one", () => {
    const { reqs, questions } = scenario(3, 2);
    const { schedule } = buildSchedule({ days: 1, requirements: reqs, questions });
    expect(schedule.items).toHaveLength(1);
    const allIds = questions.map((q) => q.id).sort();
    expect([...schedule.items[0].question_ids].sort()).toEqual(allIds);
  });

  it("handles the 60-day case with review days after material runs out", () => {
    const { reqs, questions } = scenario(3, 2);
    const { schedule } = buildSchedule({ days: 60, requirements: reqs, questions });
    expect(schedule.days).toBe(60);
    const freshDays = schedule.items.filter((d) => d.duration_minutes > 45 || d.focus.startsWith("Kick-off"));
    expect(freshDays.length).toBeGreaterThanOrEqual(1);
    const reviewDays = schedule.items.filter((d) => d.focus.startsWith("Review"));
    expect(reviewDays.length).toBeGreaterThan(0);
    for (const day of reviewDays) {
      for (const qid of day.question_ids) {
        expect(questions.some((q) => q.id === qid)).toBe(true);
      }
    }
  });

  it("raises the daily budget when must material cannot fit otherwise", () => {
    const reqs = Array.from({ length: 5 }, (_, i) =>
      makeRequirement({ id: `r${i}`, kind: "must" })
    );
    const questions = reqs.map((r, i) =>
      makeQuestion({ id: `q${i}`, requirement_ids: [r.id], difficulty: 5 })
    );
    // 5 musts x 40min = 200min; 1 day at 90min cannot fit them
    const { schedule, notices } = buildSchedule({ days: 1, requirements: reqs, questions });
    expect(schedule.items[0].question_ids).toHaveLength(5);
    expect(schedule.items[0].duration_minutes).toBe(200);
    expect(notices.some((n) => n.includes("raised"))).toBe(true);
  });

  it("is deterministic", () => {
    const { reqs, questions } = scenario();
    const a = buildSchedule({ days: 5, requirements: reqs, questions });
    const b = buildSchedule({ days: 5, requirements: reqs, questions });
    expect(a).toEqual(b);
  });

  it("does not schedule user-added orphan questions before must material", () => {
    const must = makeRequirement({ id: "r_must", kind: "must" });
    const orphan = makeQuestion({ id: "q_orphan", requirement_ids: ["req_unknown"], difficulty: 5 });
    const mustQ = makeQuestion({ id: "q_must", requirement_ids: [must.id], difficulty: 1 });
    const { schedule } = buildSchedule({
      days: 2,
      requirements: [must],
      questions: [orphan, mustQ],
    });
    expect(schedule.items[0].question_ids).toContain("q_must");
  });
});
