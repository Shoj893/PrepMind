import {
  checkCoverage,
} from "@/core/kit/coverage";
import {
  nextId,
  type Flashcard,
  type Kit,
  type Question,
  type RequirementCategory,
} from "@/core/kit/types";
import { validateKit } from "@/core/kit/validate";
import { buildSchedule, questionMinutes } from "@/core/kit/schedule";
import { z } from "zod";

/**
 * User mutations on a kit. Every op validates its input with zod, applies the
 * change with the right origin/pinned semantics, revalidates the whole kit,
 * and keeps the schedule consistent with the question set:
 * - deleting a question removes it from its day and recomputes that day's
 *   minutes; if a must-have requirement loses all scheduled questions, the
 *   schedule is re-allocated (with a notice) so the guarantee holds
 * - edits/additions elsewhere never touch other sections
 */

export class OpError extends Error {}

const patchableQuestion = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  answer_outline_md: z.string().min(1).max(4000).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  category: z.string().optional(),
});

const patchableFlashcard = z.object({
  front: z.string().min(1).max(1000).optional(),
  back: z.string().min(1).max(2000).optional(),
});

export const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_question"),
    question_id: z.string(),
    patch: patchableQuestion,
  }),
  z.object({
    op: z.literal("add_question"),
    question: z.object({
      prompt: z.string().min(1).max(2000),
      answer_outline_md: z.string().min(1).max(4000),
      category: z.string(),
      difficulty: z.number().int().min(1).max(5).default(3),
      requirement_ids: z.array(z.string()).min(1),
    }),
  }),
  z.object({ op: z.literal("delete_question"), question_id: z.string() }),
  z.object({
    op: z.literal("move_question"),
    question_id: z.string(),
    category: z.string(),
  }),
  z.object({
    op: z.literal("reorder_questions"),
    category: z.string(),
    question_ids: z.array(z.string()),
  }),
  z.object({ op: z.literal("toggle_pin"), question_id: z.string() }),
  z.object({
    op: z.literal("update_flashcard"),
    card_id: z.string(),
    patch: patchableFlashcard,
  }),
  z.object({
    op: z.literal("add_flashcard"),
    front: z.string().min(1).max(1000),
    back: z.string().min(1).max(2000),
    requirement_ids: z.array(z.string()).default([]),
  }),
  z.object({ op: z.literal("delete_flashcard"), card_id: z.string() }),
  z.object({ op: z.literal("toggle_pin_flashcard"), card_id: z.string() }),
  z.object({ op: z.literal("update_brief"), brief_md: z.string().min(1).max(20000) }),
  z.object({ op: z.literal("update_role_summary"), summary_md: z.string().min(1).max(20000) }),
  z.object({
    op: z.literal("update_requirement"),
    requirement_id: z.string(),
    patch: z.object({
      text: z.string().min(1).max(1000).optional(),
      kind: z.enum(["must", "nice"]).optional(),
    }),
  }),
  z.object({
    op: z.literal("update_day"),
    day: z.number().int().min(1),
    patch: z.object({
      focus: z.string().min(1).max(300).optional(),
      duration_minutes: z.number().int().min(5).max(600).optional(),
      note: z.string().max(500).optional(),
    }),
  }),
]);

export type KitOp = z.infer<typeof opSchema>;

export function applyOp(kit: Kit, op: KitOp): Kit {
  const next: Kit = structuredClone(kit);
  const now = () => new Date().toISOString();

  switch (op.op) {
    case "update_question": {
      const q = findQuestion(next, op.question_id);
      Object.assign(q, op.patch);
      if (op.patch.category && !isValidCategory(op.patch.category)) {
        throw new OpError(`Unknown category ${op.patch.category}`);
      }
      markEdited(q);
      break;
    }
    case "add_question": {
      if (!isValidCategory(op.question.category)) {
        throw new OpError(`Unknown category ${op.question.category}`);
      }
      const known = new Set(next.role.requirements.map((r) => r.id));
      for (const rid of op.question.requirement_ids) {
        if (!known.has(rid)) throw new OpError(`Unknown requirement ${rid}`);
      }
      const question: Question = {
        id: nextId("q", [...next.questions.map((x) => x.id)]).replace(
          "q_",
          `q_u_${Date.now().toString(36)}_`
        ),
        requirement_ids: op.question.requirement_ids,
        category: op.question.category as RequirementCategory,
        prompt: op.question.prompt,
        answer_outline_md: op.question.answer_outline_md,
        difficulty: op.question.difficulty,
        origin: "user",
        pinned: true,
      };
      next.questions.push(question);
      break;
    }
    case "delete_question": {
      const before = next.questions.length;
      next.questions = next.questions.filter((q) => q.id !== op.question_id);
      if (next.questions.length === before) throw new OpError("Question not found");
      removeFromSchedule(next, op.question_id);
      ensureScheduleCoversMusts(next);
      break;
    }
    case "move_question": {
      if (!isValidCategory(op.category)) throw new OpError(`Unknown category ${op.category}`);
      const q = findQuestion(next, op.question_id);
      q.category = op.category as RequirementCategory;
      markEdited(q);
      break;
    }
    case "reorder_questions": {
      const categoryQuestions = next.questions.filter((q) => q.category === op.category);
      const categoryIds = new Set(categoryQuestions.map((q) => q.id));
      const valid =
        categoryQuestions.length === op.question_ids.length &&
        op.question_ids.every((id) => categoryIds.has(id)) &&
        categoryIds.size === categoryQuestions.length;
      if (!valid) {
        throw new OpError("reorder_questions requires exactly the ids of one category");
      }
      const byId = new Map(categoryQuestions.map((q) => [q.id, q]));
      const ordered = op.question_ids.map((id) => byId.get(id)!);
      const orderedIds = new Set(ordered.map((q) => q.id));
      const firstIdx = next.questions.findIndex((q) => q.category === op.category);
      const before = next.questions.slice(0, firstIdx);
      const after = next.questions.slice(firstIdx).filter((q) => !orderedIds.has(q.id));
      next.questions = [...before, ...ordered, ...after];
      break;
    }
    case "toggle_pin": {
      const q = findQuestion(next, op.question_id);
      q.pinned = !q.pinned;
      break;
    }
    case "update_flashcard": {
      const f = findFlashcard(next, op.card_id);
      Object.assign(f, op.patch);
      markEdited(f);
      break;
    }
    case "add_flashcard": {
      const known = new Set(next.role.requirements.map((r) => r.id));
      for (const rid of op.requirement_ids) {
        if (!known.has(rid)) throw new OpError(`Unknown requirement ${rid}`);
      }
      next.flashcards.push({
        id: `fc_u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        front: op.front,
        back: op.back,
        requirement_ids: op.requirement_ids,
        origin: "user",
        pinned: true,
      });
      break;
    }
    case "delete_flashcard": {
      const before = next.flashcards.length;
      next.flashcards = next.flashcards.filter((f) => f.id !== op.card_id);
      if (next.flashcards.length === before) throw new OpError("Flashcard not found");
      break;
    }
    case "toggle_pin_flashcard": {
      const f = findFlashcard(next, op.card_id);
      f.pinned = !f.pinned;
      break;
    }
    case "update_brief": {
      next.company.brief_md = op.brief_md;
      next.company.brief_edited = true;
      break;
    }
    case "update_role_summary": {
      next.role.summary_md = op.summary_md;
      break;
    }
    case "update_requirement": {
      const req = next.role.requirements.find((r) => r.id === op.requirement_id);
      if (!req) throw new OpError("Requirement not found");
      Object.assign(req, op.patch);
      if (op.patch.kind) {
        // Kind change can resurface coverage gaps — recompute.
        next.coverage = checkCoverage(next.role.requirements, next.questions);
      }
      break;
    }
    case "update_day": {
      const day = next.schedule.items.find((d) => d.day === op.day);
      if (!day) throw new OpError("Day not found");
      Object.assign(day, op.patch);
      break;
    }
  }

  next.meta.updated_at = now();
  const validation = validateKit(next);
  if (!validation.ok) {
    throw new OpError(`Change would produce an invalid kit: ${validation.errors.join("; ")}`);
  }
  return validation.kit!;
}

function findQuestion(kit: Kit, id: string): Question {
  const q = kit.questions.find((x) => x.id === id);
  if (!q) throw new OpError("Question not found");
  return q;
}

function findFlashcard(kit: Kit, id: string): Flashcard {
  const f = kit.flashcards.find((x) => x.id === id);
  if (!f) throw new OpError("Flashcard not found");
  return f;
}

function markEdited(item: { origin: string }): void {
  if (item.origin === "generated") item.origin = "edited";
}

function isValidCategory(value: string): boolean {
  return ["technical", "behavioural", "system_design", "domain", "process"].includes(value);
}

function removeFromSchedule(kit: Kit, questionId: string): void {
  const question = kit.questions.find((q) => q.id === questionId);
  for (const day of kit.schedule.items) {
    const idx = day.question_ids.indexOf(questionId);
    if (idx === -1) continue;
    day.question_ids.splice(idx, 1);
    if (question) {
      day.duration_minutes = Math.max(
        5,
        day.duration_minutes - questionMinutes(question.difficulty)
      );
    }
    // The day's requirement list becomes exactly what its remaining questions cover.
    day.requirement_ids = [
      ...new Set(
        day.question_ids.flatMap(
          (qid) => kit.questions.find((q) => q.id === qid)?.requirement_ids ?? []
        )
      ),
    ];
  }
}

function ensureScheduleCoversMusts(kit: Kit): void {
  const scheduled = new Set(kit.schedule.items.flatMap((d) => d.requirement_ids));
  const missing = kit.role.requirements.filter(
    (r) => r.kind === "must" && !scheduled.has(r.id)
  );
  if (missing.length === 0) return;
  // Re-allocate from scratch: the deterministic scheduler restores the
  // must-have guarantee. Manual day edits are replaced; a notice says so.
  const result = buildSchedule({
    days: kit.meta.days_requested,
    requirements: kit.role.requirements,
    questions: kit.questions,
  });
  kit.schedule = result.schedule;
  kit.meta.notices = [
    ...new Set([
      ...kit.meta.notices,
      "The schedule was re-allocated because a change removed must-have material from the plan.",
    ]),
  ].slice(0, 20);
}
