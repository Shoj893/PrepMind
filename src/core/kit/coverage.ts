import type { Coverage, Question, Requirement } from "./types";

/**
 * Deterministic coverage check: a requirement is covered when at least one
 * question references its id. Uncovered must-have requirements are the gaps
 * that drive the second pass. This is our code's decision, never the model's.
 */
export function checkCoverage(
  requirements: Requirement[],
  questions: Question[]
): Coverage {
  const covered = new Set<string>();
  for (const q of questions) {
    for (const rid of q.requirement_ids) covered.add(rid);
  }

  const gaps = requirements
    .filter((r) => !covered.has(r.id))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "must" ? -1 : 1;
      return a.id.localeCompare(b.id);
    })
    .map((r) => ({
      requirement_id: r.id,
      reason:
        r.kind === "must"
          ? "Must-have requirement with no question against it."
          : "Nice-to-have requirement with no question against it.",
    }));

  return {
    covered_requirement_ids: requirements
      .filter((r) => covered.has(r.id))
      .map((r) => r.id),
    gaps,
    passes: 0,
  };
}

export function uncoveredMusts(
  coverage: Coverage,
  requirements: Requirement[]
): Requirement[] {
  const gapIds = new Set(coverage.gaps.map((g) => g.requirement_id));
  return requirements.filter((r) => gapIds.has(r.id) && r.kind === "must");
}

export function uncoveredAll(
  coverage: Coverage,
  requirements: Requirement[]
): Requirement[] {
  const gapIds = new Set(coverage.gaps.map((g) => g.requirement_id));
  return requirements.filter((r) => gapIds.has(r.id));
}
