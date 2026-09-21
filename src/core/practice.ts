/**
 * Practice mode state: a light SM-2 derived scheduler.
 *
 * Confidence scale 0..3: 0 again, 1 hard, 2 good, 3 easy.
 * Chosen over full SM-2 because the product requirement is "next session is
 * ordered by least confidence" — a small, fully deterministic interval rule
 * gives us that plus long-term retention, with state simple enough to store
 * per (kit, card) row and to reason about in tests.
 */

export interface CardStat {
  card_id: string;
  repetitions: number;
  interval_days: number;
  ease: number;
  /** ISO date (yyyy-mm-dd) when the card should next be shown. */
  due_at: string;
  last_confidence: number | null;
  reviews: number;
}

export const CONFIDENCE_LABELS = ["Again", "Hard", "Good", "Easy"] as const;

export function newStat(cardId: string, today = new Date()): CardStat {
  return {
    card_id: cardId,
    repetitions: 0,
    interval_days: 0,
    ease: 2.3,
    due_at: isoDay(today),
    last_confidence: null,
    reviews: 0,
  };
}

export function applyReview(
  stat: CardStat,
  confidence: 0 | 1 | 2 | 3,
  today = new Date()
): CardStat {
  const next: CardStat = {
    ...stat,
    reviews: stat.reviews + 1,
    last_confidence: confidence,
  };

  if (confidence === 0) {
    next.repetitions = 0;
    next.interval_days = 0; // due immediately
    next.ease = clamp(next.ease - 0.15, 1.3, 2.8);
  } else if (confidence === 1) {
    next.repetitions = stat.repetitions + 1;
    next.interval_days = Math.max(1, Math.round(stat.interval_days * 1.2 * (stat.ease / 2.3)));
    next.ease = clamp(next.ease - 0.05, 1.3, 2.8);
  } else if (confidence === 2) {
    next.repetitions = stat.repetitions + 1;
    next.interval_days =
      stat.repetitions === 0 ? 1 : Math.max(1, Math.round(stat.interval_days * stat.ease));
  } else {
    next.repetitions = stat.repetitions + 1;
    next.interval_days =
      stat.repetitions === 0 ? 2 : Math.max(2, Math.round(stat.interval_days * stat.ease * 1.3));
    next.ease = clamp(next.ease + 0.05, 1.3, 2.8);
  }

  next.due_at = addDays(today, next.interval_days);
  return next;
}

/**
 * Session order: unseen cards first (they are by definition the least
 * confident), then cards by lowest last confidence, then earliest due.
 * Stable tiebreak on card id keeps sessions deterministic.
 */
export function orderSession(
  cardIds: string[],
  stats: Map<string, CardStat>,
  today = new Date()
): string[] {
  const todayIso = isoDay(today);
  return [...cardIds].sort((a, b) => {
    const sa = stats.get(a);
    const sb = stats.get(b);
    const seenA = sa && sa.reviews > 0 ? 1 : 0;
    const seenB = sb && sb.reviews > 0 ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB; // unseen first
    const confA = sa?.last_confidence ?? 0;
    const confB = sb?.last_confidence ?? 0;
    if (confA !== confB) return confA - confB;
    const dueA = sa?.due_at ?? todayIso;
    const dueB = sb?.due_at ?? todayIso;
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return a.localeCompare(b);
  });
}

export function coverageStats(cardIds: string[], stats: Map<string, CardStat>): {
  total: number;
  seen: number;
  confident: number;
} {
  let seen = 0;
  let confident = 0;
  for (const id of cardIds) {
    const stat = stats.get(id);
    if (stat && stat.reviews > 0) {
      seen += 1;
      if ((stat.last_confidence ?? 0) >= 2) confident += 1;
    }
  }
  return { total: cardIds.length, seen, confident };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): string {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return isoDay(copy);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
