import type { Flashcard, Question, Requirement } from "@/core/kit/types";

let counter = 0;

export function makeRequirement(
  overrides: Partial<Requirement> & { id?: string } = {}
): Requirement {
  counter += 1;
  return {
    id: overrides.id ?? `req_${counter}`,
    text: overrides.text ?? `Requirement ${counter}`,
    kind: overrides.kind ?? "must",
    category: overrides.category ?? "technical",
  };
}

export function makeQuestion(
  overrides: Partial<Question> & { id?: string; requirement_ids?: string[] } = {}
): Question {
  counter += 1;
  return {
    id: overrides.id ?? `q_${counter}`,
    requirement_ids: overrides.requirement_ids ?? ["req_1"],
    category: overrides.category ?? "technical",
    prompt: overrides.prompt ?? `Question ${counter}?`,
    answer_outline_md: overrides.answer_outline_md ?? "Outline.",
    difficulty: overrides.difficulty ?? 3,
    origin: overrides.origin ?? "generated",
    pinned: overrides.pinned ?? false,
  };
}

export function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  counter += 1;
  return {
    id: overrides.id ?? `fc_${counter}`,
    front: overrides.front ?? `Front ${counter}`,
    back: overrides.back ?? "Back.",
    requirement_ids: overrides.requirement_ids ?? ["req_1"],
    origin: overrides.origin ?? "generated",
    pinned: overrides.pinned ?? false,
  };
}

export function resetIds(): void {
  counter = 0;
}
