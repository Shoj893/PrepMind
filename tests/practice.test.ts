import { describe, expect, it } from "vitest";
import { applyReview, coverageStats, newStat, orderSession } from "@/core/practice";

const TODAY = new Date("2026-03-10T12:00:00Z");

describe("practice scheduling", () => {
  it("a lapse resets the interval and makes the card immediately due", () => {
    const stat = applyReview(newStat("c1", TODAY), 0, TODAY);
    expect(stat.repetitions).toBe(0);
    expect(stat.interval_days).toBe(0);
    expect(stat.due_at).toBe("2026-03-10");
    expect(stat.ease).toBeLessThan(2.3);
  });

  it("successful reviews grow the interval", () => {
    let stat = newStat("c1", TODAY);
    stat = applyReview(stat, 2, TODAY);
    expect(stat.interval_days).toBe(1);
    stat = applyReview(stat, 2, TODAY);
    expect(stat.interval_days).toBe(2);
    stat = applyReview(stat, 2, TODAY);
    expect(stat.interval_days).toBeGreaterThan(2);
  });

  it("easy reviews grow faster than good reviews", () => {
    const good = applyReview(applyReview(newStat("c1", TODAY), 2, TODAY), 2, TODAY);
    const easy = applyReview(applyReview(newStat("c2", TODAY), 3, TODAY), 3, TODAY);
    expect(easy.interval_days).toBeGreaterThan(good.interval_days);
  });

  it("orders the session unseen first, then by lowest confidence", () => {
    const stats = new Map();
    const c1 = newStat("seen_weak", TODAY);
    c1.last_confidence = 0;
    c1.reviews = 2;
    const c2 = newStat("seen_ok", TODAY);
    c2.last_confidence = 2;
    c2.reviews = 1;
    stats.set("seen_weak", c1);
    stats.set("seen_ok", c2);
    const order = orderSession(["seen_ok", "unseen_b", "seen_weak", "unseen_a"], stats, TODAY);
    expect(order[0]).toMatch(/^unseen_/);
    expect(order.slice(0, 2).sort()).toEqual(["unseen_a", "unseen_b"]);
    expect(order[2]).toBe("seen_weak");
    expect(order[3]).toBe("seen_ok");
  });

  it("reports coverage as seen vs confident", () => {
    const stats = new Map();
    const a = newStat("a", TODAY);
    a.reviews = 1;
    a.last_confidence = 3;
    const b = newStat("b", TODAY);
    b.reviews = 1;
    b.last_confidence = 0;
    stats.set("a", a);
    stats.set("b", b);
    const s = coverageStats(["a", "b", "c"], stats);
    expect(s).toEqual({ total: 3, seen: 2, confident: 1 });
  });
});
