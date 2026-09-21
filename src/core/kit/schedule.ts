import type { Question, Requirement, Schedule, ScheduleDay } from "./types";
import { CATEGORY_LABELS, type RequirementCategory } from "./types";

/**
 * Deterministic schedule allocation. This is arithmetic, not generation:
 * the same inputs always produce the same schedule.
 *
 * Guarantees:
 * - exactly `days` items, numbered 1..days
 * - every must-have requirement appears in at least one day
 * - harder / higher-priority questions land earlier
 * - integer minute durations throughout
 *
 * The queue is ordered by requirement priority (must before nice), then by
 * difficulty, so filling days front-to-back puts hard, must-have material at
 * the start of the window rather than the night before.
 */

export interface ScheduleInput {
  days: number;
  requirements: Requirement[];
  questions: Question[];
  minutesPerDay?: number;
}

export interface ScheduleResult {
  schedule: Schedule;
  notices: string[];
}

const DEFAULT_MINUTES_PER_DAY = 90;
const MAX_MINUTES_PER_DAY = 240;
const REVIEW_DAY_MINUTES = 45;
const REVIEW_CARD_COUNT = 4;

export function questionMinutes(difficulty: number): number {
  return 15 + difficulty * 5; // 20..45, integer
}

function requirementWeight(req: Requirement): number {
  return req.kind === "must" ? 100 : 40;
}

function bestWeight(q: Question, reqById: Map<string, Requirement>): number {
  const weights = q.requirement_ids
    .map((rid) => reqById.get(rid))
    .filter((r): r is Requirement => !!r)
    .map(requirementWeight);
  return weights.length > 0 ? Math.max(...weights) : 60; // orphans slot mid-priority
}

function coversMust(q: Question, reqById: Map<string, Requirement>): boolean {
  return q.requirement_ids.some((rid) => reqById.get(rid)?.kind === "must");
}

function reqIdsFor(q: Question, reqById: Map<string, Requirement>): string[] {
  return [...new Set(q.requirement_ids.filter((rid) => reqById.has(rid)))];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function dayFocus(
  dayNumber: number,
  dayQuestions: Question[],
  dayReqIds: string[],
  reqById: Map<string, Requirement>
): string {
  const counts = new Map<RequirementCategory, number>();
  for (const q of dayQuestions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const label = dominant ? CATEGORY_LABELS[dominant] : "Mixed practice";
  const mustReqs = dayReqIds
    .map((rid) => reqById.get(rid))
    .filter((r): r is Requirement => !!r && r.kind === "must");
  const prefix = dayNumber === 1 ? "Kick-off — " : "";
  const snippet = mustReqs[0]?.text;
  return snippet
    ? `${prefix}${label}: prioritise “${truncate(snippet, 60)}”`
    : `${prefix}${label}`;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const { days, requirements, questions } = input;
  const notices: string[] = [];
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const ranked = [...questions].sort((a, b) => {
    const wa = bestWeight(a, reqById);
    const wb = bestWeight(b, reqById);
    if (wa !== wb) return wb - wa;
    if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
    return a.id.localeCompare(b.id);
  });

  // Raise the daily budget only when must-have material cannot otherwise fit.
  let budget = Math.min(
    MAX_MINUTES_PER_DAY,
    Math.max(30, input.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY)
  );
  const mustMinutes = ranked
    .filter((q) => coversMust(q, reqById))
    .reduce((sum, q) => sum + questionMinutes(q.difficulty), 0);
  if (mustMinutes > days * budget) {
    budget = Math.min(MAX_MINUTES_PER_DAY, Math.ceil(mustMinutes / days));
    notices.push(
      `Daily study time raised to ${budget} minutes to fit every must-have requirement into ${days} day(s).`
    );
  }

  const items: ScheduleDay[] = [];
  let dayNumber = 1;
  let dayQuestions: Question[] = [];
  let dayMinutes = 0;

  const flush = () => {
    if (dayQuestions.length === 0) return;
    const reqIds = [...new Set(dayQuestions.flatMap((q) => reqIdsFor(q, reqById)))];
    items.push({
      day: dayNumber,
      focus: dayFocus(dayNumber, dayQuestions, reqIds, reqById),
      question_ids: dayQuestions.map((q) => q.id),
      requirement_ids: reqIds,
      duration_minutes: dayMinutes,
    });
    dayNumber += 1;
    dayQuestions = [];
    dayMinutes = 0;
  };

  for (const q of ranked) {
    const mins = questionMinutes(q.difficulty);
    if (dayMinutes > 0 && dayMinutes + mins > budget) flush();
    if (dayNumber > days) break;
    dayQuestions.push(q);
    dayMinutes += mins;
  }
  flush();

  // Overflow lands on the final day rather than vanishing; the day may exceed
  // the target budget and says so.
  const scheduledIds = new Set(items.flatMap((d) => d.question_ids));
  const overflow = ranked.filter((q) => !scheduledIds.has(q.id));  if (overflow.length > 0 && items.length > 0) {
    const last = items[items.length - 1];
    last.question_ids.push(...overflow.map((q) => q.id));
    last.requirement_ids = [
      ...new Set([...last.requirement_ids, ...overflow.flatMap((q) => reqIdsFor(q, reqById))]),
    ];
    last.duration_minutes += overflow.reduce((sum, q) => sum + questionMinutes(q.difficulty), 0);
    last.note =
      "Compressed: more material than fits comfortably — consider extending your window.";
    notices.push(
      `${overflow.length} question(s) did not fit the daily budget and were added to the final day.`
    );
  }

  // A must-have requirement with no question against it must still appear in
  // the schedule (it gets self-study time on day one), and the coverage panel
  // reports honestly that no generated question exists for it.
  const mustReqIds = requirements.filter((r) => r.kind === "must").map((r) => r.id);
  const scheduledReqIds = new Set(items.flatMap((d) => d.requirement_ids));
  const uncoveredInSchedule = mustReqIds.filter((rid) => !scheduledReqIds.has(rid));
  if (uncoveredInSchedule.length > 0 && items.length > 0) {
    items[0].requirement_ids = [...new Set([...items[0].requirement_ids, ...uncoveredInSchedule])];
    items[0].note = [
      items[0].note,
      "Includes self-study for requirement(s) with no generated question yet — see Coverage.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // More days than fresh material: fill the rest with rotating review days.
  const allScheduled = items.flatMap((d) => d.question_ids);
  while (items.length < days) {
    const nextDayNumber = items.length + 1;
    if (allScheduled.length > 0) {
      const start = ((nextDayNumber - 1) * REVIEW_CARD_COUNT) % allScheduled.length;
      const reviewIds = [
        ...new Set(
          Array.from({ length: Math.min(REVIEW_CARD_COUNT, allScheduled.length) }, (_, i) =>
            allScheduled[(start + i) % allScheduled.length]
          )
        ),
      ];
      const reviewQuestions = reviewIds
        .map((id) => ranked.find((q) => q.id === id))
        .filter((q): q is Question => !!q);
      const reqIds = [...new Set(reviewQuestions.flatMap((q) => reqIdsFor(q, reqById)))];
      items.push({
        day: nextDayNumber,
        focus: `Review & spaced practice: ${dayFocus(nextDayNumber, reviewQuestions, reqIds, reqById)}`,
        question_ids: reviewIds,
        requirement_ids: reqIds,
        duration_minutes: REVIEW_DAY_MINUTES,
        note: "Revisit these under time pressure; explain your answers out loud.",
      });
    } else {
      items.push({
        day: nextDayNumber,
        focus: "Light review & mock interview",
        question_ids: [],
        requirement_ids: requirements.filter((r) => r.kind === "must").map((r) => r.id),
        duration_minutes: REVIEW_DAY_MINUTES,
        note: "No new material left — run practice mode and the mock questions again.",
      });
    }
  }

  items.sort((a, b) => a.day - b.day);
  for (let i = 0; i < items.length; i++) items[i].day = i + 1;

  return { schedule: { days: items.length, items }, notices };
}
