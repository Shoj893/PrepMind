import type { CompletionRequest, LLMClient } from "./client";
import { parseJsonLoose } from "./client";

/**
 * Deterministic fake LLM used by tests and offline runs (LLM_PROVIDER=fake).
 *
 * It reads the structured <task> and <payload> markers our prompt builders
 * emit and produces valid, deterministic JSON responses — including a
 * deliberate blind spot: requirements whose text mentions "obscure legacy
 * COBOL" get no questions on the first pass, which is how the pipeline's
 * coverage-gap second pass is exercised in tests.
 */

interface RequirementPayload {
  id: string;
  text: string;
  category: string;
  kind: string;
}

const COBOL_MARKER = /obscure legacy COBOL/i;
/** Requirements matching this never get questions from the fake, any pass. */
const UNFILLABLE_MARKER = /unfillable arcane system/i;

export class FakeLLM implements LLMClient {
  readonly model = "fake-llm";
  private counters = { questions: 0, flashcards: 0 };

  async complete(request: CompletionRequest): Promise<string> {
    const task = /<task>([\w_]+)<\/task>/.exec(request.user)?.[1];
    const payloadJson = /<payload>([\s\S]*?)<\/payload>/.exec(request.user)?.[1];
    const payload = payloadJson ? parseJsonLoose<Record<string, unknown>>(payloadJson) : {};

    switch (task) {
      case "extract_requirements":
        return JSON.stringify(fakeRequirements(String(payload.jd ?? "")));
      case "company_brief":
        return JSON.stringify(fakeBrief(payload));
      case "questions":
        return JSON.stringify(fakeQuestions(payload, this.counters));
      case "flashcards":
        return JSON.stringify(fakeFlashcards(payload, this.counters));
      default:
        return JSON.stringify({ error: "fake llm: unknown task" });
    }
  }
}

const TECH_WORDS = /react|typescript|javascript|python|java|sql|api|backend|frontend|testing|kubernetes|aws|css|node/i;
const BEHAVIOUR_WORDS = /mentor|communication|stakeholder|lead|collaborat|conflict|feedback|junior/i;
const SYSTEM_WORDS = /architect|scale|system design|infrastructure|design a|reliability/i;
const PROCESS_WORDS = /agile|process|sprint|ci\/cd|code review|devops/i;

function classify(text: string): string {
  if (BEHAVIOUR_WORDS.test(text)) return "behavioural";
  if (SYSTEM_WORDS.test(text)) return "system_design";
  if (PROCESS_WORDS.test(text)) return "process";
  if (TECH_WORDS.test(text)) return "technical";
  return "domain";
}

function fakeRequirements(jd: string): {
  role_title: string;
  summary_md: string;
  requirements: { id: string; text: string; kind: string; category: string }[];
} {
  const lines = jd
    .split(/\n|(?<=\.)\s+/)
    .map((l) => l.replace(/^[\s\-*•\d.]+/, "").trim())
    .filter((l) => l.length > 15 && l.length < 400);

  const requirementLines = lines.filter((l) =>
    /(required|must|experience|years|responsib|proficien|strong|familiar|bonus|nice|plus|preferred|minimum|degree)/i.test(
      l
    )
  );
  const chosen = (requirementLines.length > 0 ? requirementLines : lines).slice(0, 8);

  const requirements = chosen.map((line, i) => ({
    id: `req_${i + 1}`,
    text: line.slice(0, 300),
    kind: /(bonus|nice|plus|preferred)/i.test(line) ? "nice" : "must",
    category: classify(line),
  }));

  const firstLine = jd.split("\n").map((l) => l.trim()).find((l) => l.length > 3);
  return {
    role_title: firstLine ? firstLine.slice(0, 80) : "the role",
    summary_md: `Summary of the pasted job description (${requirements.length} requirement(s) identified).`,
    requirements,
  };
}

function fakeBrief(payload: Record<string, unknown>): { company_name: string; brief_md: string } {
  const name = String(payload.company_name ?? "the company");
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (pages.length === 0) {
    return {
      company_name: name,
      brief_md: `**What they do:** Nothing could be retrieved for ${name}; this brief is honest about that rather than invented.\n\n**How they hire:** Unknown — no hiring page was retrievable.`,
    };
  }
  const kinds = pages.map((p) => (p as { kind?: string }).kind).join(", ");
  return {
    company_name: name,
    brief_md: [
      `**What they do:** ${name} builds software products (retrieved from ${pages.length} page(s): ${kinds}).`,
      `**Product & tech:** Details summarised from the retrieved pages; treat as approximate.`,
      `**How they hire:** ${
        kinds.includes("hiring")
          ? "The careers section was retrieved; expect a standard multi-stage process."
          : "No hiring page was retrievable, so this section is unknown."
      }`,
    ].join("\n\n"),
  };
}

function fakeQuestions(
  payload: Record<string, unknown>,
  counters: { questions: number }
): { questions: { prompt: string; answer_outline_md: string; difficulty: number }[] } {
  // The real pipeline sends one requirement per call; support both shapes.
  const single = payload.requirement as RequirementPayload | undefined;
  const requirements = single
    ? [single]
    : ((payload.requirements as RequirementPayload[] | undefined) ?? []);
  const perRequirement = Number(payload.count ?? payload.count_per_requirement ?? 2);
  const out: { prompt: string; answer_outline_md: string; difficulty: number }[] = [];

  for (const req of requirements) {
    if (UNFILLABLE_MARKER.test(req.text)) continue; // never filled, any pass
    // Deliberate blind spot: on the FIRST pass the fake produces nothing for
    // COBOL requirements; once the pipeline asks again with gap_fill=true it
    // fills them. This exercises the coverage loop end to end.
    if (COBOL_MARKER.test(req.text) && payload.gap_fill !== true) continue;
    for (let i = 0; i < perRequirement; i++) {
      counters.questions += 1;
      out.push({
        prompt: `[${req.category}] ${req.kind === "must" ? "Core" : "Follow-up"}: describe your approach to “${req.text.slice(0, 120)}” (variant ${i + 1})?`,
        answer_outline_md: `A strong answer names concrete experience with “${req.text.slice(0, 100)}”, gives one example, and states trade-offs.`,
        difficulty: ((counters.questions % 5) + 1),
      });
    }
  }
  return { questions: out };
}

function fakeFlashcards(
  payload: Record<string, unknown>,
  counters: { flashcards: number }
): { flashcards: { question_index: number; front: string; back: string }[] } {
  const questions =
    (payload.questions as { prompt: string; answer_outline_md: string }[] | undefined) ?? [];
  return {
    flashcards: questions.slice(0, 12).map((q, i) => {
      counters.flashcards += 1;
      return {
        question_index: i,
        front: q.prompt.slice(0, 180),
        back: q.answer_outline_md.slice(0, 300),
      };
    }),
  };
}
