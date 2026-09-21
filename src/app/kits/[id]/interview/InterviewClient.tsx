"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, type Kit, type Question } from "@/core/kit/types";
import type { CardStat } from "@/core/practice";
import { apiGet } from "@/lib/api";
import { Badge, Button, Card, ErrorBanner } from "@/components/ui";

/**
 * Creativity feature — mock interview mode.
 *
 * A timed, one-question-at-a-time interview run over the kit's question bank.
 * Questions are ordered by where practice says you are weakest: each question
 * inherits a weakness score from the flashcards that share its requirements
 * (last confidence) and from its requirement priority (must before nice).
 * Questions you rate poorly resurface later in the same run. At the end you
 * get a weak-spots summary by category and requirement.
 */

const RATING_LABELS = ["Fumbled it", "Shaky", "Solid", "Nailed it"] as const;
const QUESTION_SECONDS = 180;

interface PracticeData {
  cards: (Kit["flashcards"][number] & { stat: CardStat | null })[];
  order: string[];
}

function weaknessOf(question: Question, cardWeakness: Map<string, number>, mustIds: Set<string>): number {
  // Higher = weaker = earlier. Flashcard-linked confidence dominates.
  const linked = question.requirement_ids.map((rid) => cardWeakness.get(rid) ?? 1);
  const avgConfidence = linked.length ? linked.reduce((a, b) => a + b, 0) / linked.length : 1;
  const mustBoost = question.requirement_ids.some((rid) => mustIds.has(rid)) ? 1 : 0;
  return (3 - avgConfidence) * 2 + mustBoost + (question.difficulty / 10);
}

export function InterviewClient({ kit }: { kit: Kit }) {
  const [cardStats, setCardStats] = useState<Map<string, CardStat> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [queue, setQueue] = useState<Question[]>([]);
  const [current, setCurrent] = useState<Question | null>(null);
  const [ratings, setRatings] = useState<{ question: Question; rating: number }[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_SECONDS);
  const [showOutline, setShowOutline] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mustIds = useMemo(
    () => new Set(kit.role.requirements.filter((r) => r.kind === "must").map((r) => r.id)),
    [kit.role.requirements]
  );

  useEffect(() => {
    apiGet<PracticeData>(`/api/kits/${kit.id}/practice`)
      .then((data) => {
        const map = new Map<string, CardStat>();
        for (const card of data.cards) {
          if (card.stat) map.set(card.id, card.stat);
        }
        setCardStats(map);
      })
      .catch((err) => setError(err.message));
  }, [kit.id]);

  // Map card stats to requirement-level weakness (avg last confidence).
  const cardWeakness = useMemo(() => {
    const perRequirement = new Map<string, number[]>();
    for (const card of kit.flashcards) {
      const stat = cardStats?.get(card.id);
      if (!stat || stat.last_confidence === null) continue;
      for (const rid of card.requirement_ids) {
        perRequirement.set(rid, [...(perRequirement.get(rid) ?? []), stat.last_confidence]);
      }
    }
    const map = new Map<string, number>();
    for (const [rid, values] of perRequirement) {
      map.set(rid, values.reduce((a, b) => a + b, 0) / values.length);
    }
    return map;
  }, [cardStats, kit.flashcards]);

  function begin() {
    const ordered = [...kit.questions].sort((a, b) => {
      const wa = weaknessOf(a, cardWeakness, mustIds);
      const wb = weaknessOf(b, cardWeakness, mustIds);
      if (wa !== wb) return wb - wa;
      return a.id.localeCompare(b.id);
    });
    if (ordered.length === 0) return;
    setQueue(ordered.slice(1));
    setCurrent(ordered[0]);
    setRatings([]);
    setSecondsLeft(QUESTION_SECONDS);
    setShowOutline(false);
    setStarted(true);
  }

  function next(rating: number | null) {
    if (!current) return;
    const recorded = rating !== null ? [...ratings, { question: current, rating }] : ratings;
    setRatings(recorded);

    // A fumbled or shaky answer goes back into the queue, two positions later.
    let remaining = [...queue];
    if (rating !== null && rating <= 1) {
      const requeue = { ...current };
      const insertAt = Math.min(2, remaining.length);
      remaining = [...remaining.slice(0, insertAt), requeue, ...remaining.slice(insertAt)];
    }

    if (remaining.length === 0) {
      setCurrent(null);
      setQueue([]);
      setRatings(recorded);
      return;
    }
    setCurrent(remaining[0]);
    setQueue(remaining.slice(1));
    setSecondsLeft(QUESTION_SECONDS);
    setShowOutline(false);
  }

  useEffect(() => {
    if (!started || !current) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [started, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- summary ----
  const summary = useMemo(() => {
    if (current) return null;
    const byCategory = new Map<string, { total: number; weak: number }>();
    const weakRequirements = new Map<string, number>();
    for (const { question, rating } of ratings) {
      const cat = byCategory.get(question.category) ?? { total: 0, weak: 0 };
      cat.total += 1;
      if (rating <= 1) cat.weak += 1;
      byCategory.set(question.category, cat);
      if (rating <= 1) {
        for (const rid of question.requirement_ids) {
          weakRequirements.set(rid, (weakRequirements.get(rid) ?? 0) + 1);
        }
      }
    }
    return { byCategory, weakRequirements, answered: ratings.length };
  }, [current, ratings]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  if (!started) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold">Mock interview — {kit.title}</h1>
          <Link href={`/kits/${kit.id}`}>
            <Button variant="secondary">Back to kit</Button>
          </Link>
        </header>
        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
        <Card className="p-6">
          <p className="text-sm text-slate-600">
            You&apos;ll be asked each question against a {QUESTION_SECONDS / 60}-minute clock, one at
            a time, hardest-for-you first (based on your practice confidence). Rate yourself honestly
            after each answer — shaky answers resurface later in the run, and you&apos;ll get a
            weak-spots summary at the end.
          </p>
          <Button className="mt-4" onClick={begin} disabled={kit.questions.length === 0 || cardStats === null}>
            Start {kit.questions.length}-question interview
          </Button>
          {kit.questions.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">This kit has no questions to practise.</p>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Mock interview</h1>
        <Link href={`/kits/${kit.id}`}>
          <Button variant="secondary">End run</Button>
        </Link>
      </header>

      {current ? (
        <>
          <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
            <span>
              Question {ratings.length + 1} · {queue.length + 1} in run
            </span>
            <span
              className={`font-mono tabular-nums ${secondsLeft <= 30 ? "text-red-600" : ""}`}
              role="timer"
              aria-label="Time remaining"
            >
              {minutes}:{seconds.toString().padStart(2, "0")}
            </span>
          </div>
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <Badge>{CATEGORY_LABELS[current.category]}</Badge>
              <Badge tone={current.difficulty >= 4 ? "red" : "slate"}>difficulty {current.difficulty}</Badge>
            </div>
            <p className="text-lg font-medium">{current.prompt}</p>
            {showOutline && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{current.answer_outline_md}</p>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={() => setShowOutline((v) => !v)}>
                {showOutline ? "Hide outline" : "Peek at outline"}
              </Button>
            </div>
          </Card>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="How did that go?">
            {([0, 1, 2, 3] as const).map((rating) => (
              <Button key={rating} variant={rating >= 2 ? "secondary" : "danger"} onClick={() => next(rating)}>
                {RATING_LABELS[rating]}
              </Button>
            ))}
          </div>
          <button
            onClick={() => next(null)}
            className="mt-3 text-xs text-slate-400 underline hover:text-slate-600"
          >
            Skip this question
          </button>
        </>
      ) : (
        summary && (
          <Card className="p-6">
            <h2 className="font-semibold">Run complete — {summary.answered} answers</h2>
            <h3 className="mt-4 text-sm font-semibold text-slate-700">Weak spots</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {[...summary.byCategory.entries()]
                .sort((a, b) => b[1].weak / b[1].total - a[1].weak / a[1].total)
                .map(([category, stat]) => (
                  <li key={category} className="flex items-center gap-2">
                    <Badge tone={stat.weak > 0 ? "amber" : "green"}>{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}</Badge>
                    <span className="text-slate-600">
                      {stat.weak} shaky of {stat.total}
                    </span>
                  </li>
                ))}
            </ul>
            {summary.weakRequirements.size > 0 && (
              <>
                <h3 className="mt-4 text-sm font-semibold text-slate-700">Requirements to revisit</h3>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {[...summary.weakRequirements.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([rid, count]) => (
                      <li key={rid}>
                        {kit.role.requirements.find((r) => r.id === rid)?.text ?? rid} ({count})
                      </li>
                    ))}
                </ul>
              </>
            )}
            <div className="mt-5 flex gap-2">
              <Button onClick={begin}>Run again</Button>
              <Link href={`/kits/${kit.id}/practice`}>
                <Button variant="secondary">Drill flashcards</Button>
              </Link>
            </div>
          </Card>
        )
      )}
    </main>
  );
}
