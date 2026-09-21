import { z } from "zod";

/**
 * The kit document (Appendix A shape).
 *
 * Rules enforced here and in validate.ts:
 * - every requirement has a stable id; every question references requirement ids
 * - every requirement is marked must | nice
 * - all durations are integer minutes
 *
 * Field meanings:
 * - origin: "generated" (model-produced, replaceable) | "edited" (user touched it,
 *   survives regeneration) | "user" (user-created, never removed by regeneration)
 * - pinned: explicit user lock; pinned generated content also survives regeneration
 */

export const REQUIREMENT_CATEGORIES = [
  "technical",
  "behavioural",
  "system_design",
  "domain",
  "process",
] as const;

export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  system_design: "System design",
  domain: "Domain",
  process: "Process",
};

export const QuestionCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export type QuestionCategory = RequirementCategory;

export const RequirementKindSchema = z.enum(["must", "nice"]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const OriginSchema = z.enum(["generated", "edited", "user"]);
export type Origin = z.infer<typeof OriginSchema>;

export const SourceKindSchema = z.enum([
  "company_site",
  "home",
  "hiring",
  "about",
  "engineering",
  "discussion",
  "other",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000),
  kind: RequirementKindSchema,
  category: QuestionCategorySchema,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)).min(1),
  category: QuestionCategorySchema,
  prompt: z.string().min(1).max(4000),
  answer_outline_md: z.string().min(1).max(8000),
  difficulty: z.number().int().min(1).max(5),
  origin: OriginSchema,
  pinned: z.boolean(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1).max(2000),
  back: z.string().min(1).max(4000),
  requirement_ids: z.array(z.string().min(1)),
  origin: OriginSchema,
  pinned: z.boolean(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1).max(500),
  question_ids: z.array(z.string().min(1)),
  requirement_ids: z.array(z.string().min(1)),
  duration_minutes: z.number().int().min(5).max(600),
  note: z.string().max(1000).optional(),
});
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;

export const ScheduleSchema = z.object({
  days: z.number().int().min(1).max(365),
  items: z.array(ScheduleDaySchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const CoverageSchema = z.object({
  covered_requirement_ids: z.array(z.string().min(1)),
  gaps: z.array(
    z.object({
      requirement_id: z.string().min(1),
      reason: z.string().min(1),
    })
  ),
  passes: z.number().int().min(0),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const KitSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  kind: SourceKindSchema,
  retrieved: z.boolean(),
  note: z.string().optional(),
});
export type KitSource = z.infer<typeof KitSourceSchema>;

export const CompanySchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  brief_md: z.string(),
  sources: z.array(KitSourceSchema),
  brief_edited: z.boolean(),
});
export type Company = z.infer<typeof CompanySchema>;

export const RoleSchema = z.object({
  title: z.string().min(1),
  summary_md: z.string(),
  requirements: z.array(RequirementSchema),
});
export type Role = z.infer<typeof RoleSchema>;

export const SkippedSourceSchema = z.object({
  url: z.string(),
  reason: z.string(),
});
export type SkippedSource = z.infer<typeof SkippedSourceSchema>;

export const KitMetaSchema = z.object({
  days_requested: z.number().int().min(1).max(365),
  model: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  notices: z.array(z.string()),
  sources_skipped: z.array(SkippedSourceSchema),
});
export type KitMeta = z.infer<typeof KitMetaSchema>;

export const KitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  company: CompanySchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  meta: KitMetaSchema,
});
export type Kit = z.infer<typeof KitSchema>;

/** Shape of a single batch case (also the `npm run evaluate` input record). */
export const BatchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string().min(1),
  company_url: z.string().min(1),
  days: z.number().int().min(1).max(365),
});
export type BatchCase = z.infer<typeof BatchCaseSchema>;

/** Stable ids handed to the model are assigned by us, never trusted from it. */
export function nextId(prefix: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}_${max + 1}`;
}
