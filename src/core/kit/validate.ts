import {
  KitSchema,
  type Kit,
} from "./types";

export interface ValidationResult {
  ok: boolean;
  kit?: Kit;
  errors: string[];
}

/**
 * Validate a generated or edited kit: schema shape plus cross-references
 * that the schema alone cannot express (id references, schedule arity,
 * must-have coverage in the schedule).
 */
export function validateKit(input: unknown): ValidationResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      ),
    };
  }
  const kit = parsed.data;
  const errors: string[] = [];

  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));
  const flashcardIds = new Set(kit.flashcards.map((f) => f.id));

  if (requirementIds.size !== kit.role.requirements.length) {
    errors.push("duplicate requirement ids");
  }
  if (questionIds.size !== kit.questions.length) {
    errors.push("duplicate question ids");
  }
  if (flashcardIds.size !== kit.flashcards.length) {
    errors.push("duplicate flashcard ids");
  }

  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      if (!requirementIds.has(rid)) {
        errors.push(`question ${q.id} references unknown requirement ${rid}`);
      }
    }
  }
  for (const f of kit.flashcards) {
    for (const rid of f.requirement_ids) {
      if (!requirementIds.has(rid)) {
        errors.push(`flashcard ${f.id} references unknown requirement ${rid}`);
      }
    }
  }

  if (kit.schedule.items.length !== kit.schedule.days) {
    errors.push(
      `schedule has ${kit.schedule.items.length} days but declares ${kit.schedule.days}`
    );
  }
  const scheduledQuestionIds = new Set<string>();
  const scheduledRequirementIds = new Set<string>();
  for (const day of kit.schedule.items) {
    if (day.day < 1 || day.day > kit.schedule.days) {
      errors.push(`schedule day ${day.day} is outside 1..${kit.schedule.days}`);
    }
    for (const qid of day.question_ids) {
      if (!questionIds.has(qid)) {
        errors.push(`schedule day ${day.day} references unknown question ${qid}`);
      }
      scheduledQuestionIds.add(qid);
    }
    for (const rid of day.requirement_ids) {
      scheduledRequirementIds.add(rid);
    }
  }
  const daysSeen = new Set(kit.schedule.items.map((d) => d.day));
  if (daysSeen.size !== kit.schedule.items.length) {
    errors.push("schedule has duplicate day numbers");
  }

  // Every must-have requirement must be practised somewhere in the schedule.
  for (const req of kit.role.requirements) {
    if (req.kind === "must" && !scheduledRequirementIds.has(req.id)) {
      errors.push(`must-have requirement ${req.id} is not in the schedule`);
    }
  }

  // Coverage bookkeeping must agree with the actual question references.
  const coveredByQuestions = new Set<string>();
  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) coveredByQuestions.add(rid);
  }
  for (const rid of kit.coverage.covered_requirement_ids) {
    if (!requirementIds.has(rid)) {
      errors.push(`coverage lists unknown requirement ${rid}`);
    }
  }
  for (const gap of kit.coverage.gaps) {
    if (!requirementIds.has(gap.requirement_id)) {
      errors.push(`coverage gap references unknown requirement ${gap.requirement_id}`);
    }
  }

  return { ok: errors.length === 0, kit: errors.length === 0 ? kit : undefined, errors };
}
