import { checkCoverage, uncoveredAll } from "@/core/kit/coverage";
import { buildSchedule } from "@/core/kit/schedule";
import type { Kit, RequirementCategory } from "@/core/kit/types";
import { validateKit } from "@/core/kit/validate";
import { companyBriefPrompt } from "./prompts";
import {
  completeJson,
  defaultCrawl,
  generateFlashcards,
  generateQuestionsForRequirements,
  type PipelineDeps,
} from "./pipeline";

/**
 * Section regeneration without collateral damage.
 *
 * State model (see README): every question and flashcard carries
 * `origin: "generated" | "edited" | "user"` plus a `pinned` lock.
 * - "generated" items are replaceable when their section is regenerated
 * - "edited" items (the user touched an AI item) and "user" items (hand-added)
 *   always survive
 * - pinned survives even when otherwise replaceable
 *
 * Regenerating a question category removes that category's replaceable
 * questions, recomputes coverage across ALL requirements, and fills whatever
 * no longer has a question against it. Question categories follow the
 * requirement's category, so replacements normally land in the same section;
 * if a must-have requirement was only covered by this category, refilling it
 * beats leaving it uncovered. Everything else is untouched.
 */

export type RegenerateSection = "brief" | "flashcards" | "schedule" | `questions:${string}`;

export function isReplaceable(item: { origin: string; pinned: boolean }): boolean {
  return item.origin === "generated" && !item.pinned;
}

export async function regenerateQuestionsForCategory(
  kit: Kit,
  category: RequirementCategory,
  deps: PipelineDeps
): Promise<Kit> {
  const removedIds = new Set(
    kit.questions
      .filter((q) => q.category === category && isReplaceable(q))
      .map((q) => q.id)
  );
  const kept = kit.questions.filter((q) => !removedIds.has(q.id));

  const coverage = checkCoverage(kit.role.requirements, kept);
  const gapRequirements = uncoveredAll(coverage, kit.role.requirements);

  let additions = [];
  if (gapRequirements.length > 0) {
    additions = await generateQuestionsForRequirements(
      gapRequirements,
      kit.company.brief_md,
      (r) => (r.kind === "must" ? 3 : 2),
      deps,
      undefined,
      { gapFill: true, idStart: kept.length + 1 }
    );
  }

  const all = appendWithFreshIds("q", kept, additions, removedIds);
  const questions = all;

  return withRecalculatedSchedule(
    {
      ...kit,
      questions,
      coverage: { ...checkCoverage(kit.role.requirements, questions), passes: kit.coverage.passes },
    },
    deps
  );
}

export async function regenerateBrief(kit: Kit, deps: PipelineDeps): Promise<Kit> {
  const crawl = await (deps.crawl ?? defaultCrawl)(kit.company.url, { maxPages: 6 });
  const brief = await completeJson<{ company_name: string; brief_md: string }>(
    deps.llm,
    companyBriefPrompt(
      kit.company.name,
      crawl.pages.map((p) => ({ url: p.url, title: p.title, kind: p.kind, text: p.text }))
    )
  );
  const now = (deps.now ?? (() => new Date()))().toISOString();

  return {
    ...kit,
    company: {
      ...kit.company,
      name: brief.company_name || kit.company.name,
      brief_md: brief.brief_md,
      brief_edited: false, // regenerated means model-produced again
      sources: [
        ...crawl.pages.map((p) => ({ url: p.url, title: p.title, kind: p.kind, retrieved: true })),
        ...kit.company.sources.filter((s) => s.kind === "discussion"),
      ],
    },
    meta: {
      ...kit.meta,
      updated_at: now,
      sources_skipped: [
        ...crawl.skipped.map((s) => ({ url: s.url, reason: s.reason })),
        ...kit.meta.sources_skipped.filter(
          (s) => !crawl.pages.some((p) => p.url === s.url) && !crawl.skipped.some((k) => k.url === s.url)
        ),
      ],
    },
  };
}

export async function regenerateFlashcards(kit: Kit, deps: PipelineDeps): Promise<Kit> {
  const kept = kit.flashcards.filter((f) => !isReplaceable(f));
  const generated = await generateFlashcards(deps.llm, kit.questions, kit.role.requirements);
  // Kept cards keep their ids so practice history survives; only additions
  // get fresh ids, and removed ids are never reused.
  const removedCardIds = new Set(
    kit.flashcards.filter((f) => isReplaceable(f)).map((f) => f.id)
  );
  const flashcards = appendWithFreshIds("fc", kept, generated, removedCardIds);
  return {
    ...kit,
    flashcards,
    meta: { ...kit.meta, updated_at: (deps.now ?? (() => new Date()))().toISOString() },
  };
}

export function regenerateSchedule(kit: Kit): Kit {
  const { schedule, notices } = buildSchedule({
    days: kit.meta.days_requested,
    requirements: kit.role.requirements,
    questions: kit.questions,
  });
  return {
    ...kit,
    schedule,
    meta: {
      ...kit.meta,
      updated_at: new Date().toISOString(),
      notices: [...new Set([...kit.meta.notices, ...notices])].slice(0, 20),
    },
  };
}

function withRecalculatedSchedule(kit: Kit, deps: PipelineDeps): Kit {
  // The question set changed: re-run the deterministic allocation so every
  // must-have requirement is still practised somewhere.
  const { schedule, notices } = buildSchedule({
    days: kit.meta.days_requested,
    requirements: kit.role.requirements,
    questions: kit.questions,
  });
  const validation = validateKit({ ...kit, schedule });
  if (!validation.ok) {
    throw new Error(`Regeneration produced an invalid kit: ${validation.errors.join("; ")}`);
  }
  return {
    ...validation.kit!,
    meta: {
      ...kit.meta,
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
      notices: [...new Set([...kit.meta.notices, ...notices])].slice(0, 20),
    },
  };
}

/**
 * Keep the ids of surviving items (stable ids are what practice history and
 * the schedule reference) and hand fresh, never-before-used ids to the
 * additions, continuing past the highest numeric suffix in use.
 */
function appendWithFreshIds<T extends { id: string }>(
  prefix: string,
  kept: T[],
  additions: T[],
  reserved: Set<string> = new Set()
): T[] {
  const used = new Set([...kept.map((item) => item.id), ...reserved]);
  let max = 0;
  for (const id of kept) {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const fresh = additions.map((item) => {
    let n = max + 1;
    while (used.has(`${prefix}_${n}`)) n += 1;
    const id = `${prefix}_${n}`;
    used.add(id);
    max = n;
    return { ...item, id };
  });
  return [...kept, ...fresh];
}
