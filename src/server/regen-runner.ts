import type { Kit, RequirementCategory } from "@/core/kit/types";
import {
  regenerateBrief,
  regenerateFlashcards,
  regenerateQuestionsForCategory,
  regenerateSchedule,
} from "@/core/llm/regen";
import { REQUIREMENT_CATEGORIES } from "@/core/kit/types";
import type { LLMClient } from "@/core/llm/client";

/**
 * Bridge between the server's background job runner and the core
 * regeneration functions. Parses the `section` selector:
 * "brief" | "flashcards" | "schedule" | "questions:<category>".
 */

export type RegenSection =
  | "brief"
  | "flashcards"
  | "schedule"
  | `questions:${RequirementCategory}`;

export function parseRegenSection(section: string): RegenSection | null {
  if (section === "brief" || section === "flashcards" || section === "schedule") {
    return section;
  }
  if (section.startsWith("questions:")) {
    const category = section.slice("questions:".length);
    if (REQUIREMENT_CATEGORIES.includes(category as RequirementCategory)) {
      return `questions:${category as RequirementCategory}`;
    }
  }
  return null;
}

export interface RegenContext {
  llm: LLMClient;
  onProgress?: (p: { stage: string; message: string; percent: number }) => void;
}

export async function regenHandlers(
  kit: Kit,
  section: RegenSection,
  ctx: RegenContext
): Promise<Kit> {
  const deps = {
    llm: ctx.llm,
    onProgress: ctx.onProgress
      ? (p: { stage: string; message: string; percent: number }) => ctx.onProgress!(p)
      : undefined,
  };

  switch (section) {
    case "brief":
      ctx.onProgress?.({ stage: "regen", message: "Recrawling the company site and rewriting the brief…", percent: 10 });
      return regenerateBrief(kit, deps);
    case "flashcards":
      ctx.onProgress?.({ stage: "regen", message: "Rebuilding flashcards…", percent: 10 });
      return regenerateFlashcards(kit, deps);
    case "schedule":
      ctx.onProgress?.({ stage: "regen", message: "Reallocating your study days…", percent: 10 });
      return regenerateSchedule(kit);
    default: {
      const category = (section as string).slice("questions:".length) as RequirementCategory;
      ctx.onProgress?.({
        stage: "regen",
        message: `Regenerating ${category} questions (your edits and additions are kept)…`,
        percent: 10,
      });
      return regenerateQuestionsForCategory(kit, category, deps);
    }
  }
}
