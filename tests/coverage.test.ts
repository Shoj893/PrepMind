import { describe, expect, it } from "vitest";
import { checkCoverage, uncoveredMusts } from "@/core/kit/coverage";
import { makeQuestion, makeRequirement } from "./helpers";

describe("checkCoverage", () => {
  it("marks requirements covered when a question references them", () => {
    const req1 = makeRequirement({ id: "req_1" });
    const req2 = makeRequirement({ id: "req_2" });
    const coverage = checkCoverage([req1, req2], [
      makeQuestion({ requirement_ids: ["req_1"] }),
    ]);
    expect(coverage.covered_requirement_ids).toEqual(["req_1"]);
    expect(coverage.gaps.map((g) => g.requirement_id)).toEqual(["req_2"]);
  });

  it("puts must-have gaps before nice-to-have gaps", () => {
    const nice = makeRequirement({ id: "req_nice", kind: "nice" });
    const must = makeRequirement({ id: "req_must", kind: "must" });
    const coverage = checkCoverage([nice, must], []);
    expect(coverage.gaps.map((g) => g.requirement_id)).toEqual([
      "req_must",
      "req_nice",
    ]);
  });

  it("is deterministic for identical inputs", () => {
    const reqs = [
      makeRequirement({ id: "req_b" }),
      makeRequirement({ id: "req_a" }),
    ];
    const one = checkCoverage(reqs, []);
    const two = checkCoverage(reqs, []);
    expect(one).toEqual(two);
  });

  it("uncoveredMusts filters to must only", () => {
    const must = makeRequirement({ id: "req_m", kind: "must" });
    const nice = makeRequirement({ id: "req_n", kind: "nice" });
    const coverage = checkCoverage([must, nice], []);
    expect(uncoveredMusts(coverage, [must, nice])).toEqual([must]);
  });

  it("a question referencing several requirements covers all of them", () => {
    const reqs = [makeRequirement({ id: "r1" }), makeRequirement({ id: "r2" })];
    const coverage = checkCoverage(reqs, [
      makeQuestion({ requirement_ids: ["r1", "r2"] }),
    ]);
    expect(coverage.gaps).toEqual([]);
  });
});
