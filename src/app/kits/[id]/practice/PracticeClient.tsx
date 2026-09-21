"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Kit } from "@/core/kit/types";
import { CONFIDENCE_LABELS, type CardStat } from "@/core/practice";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, Button, Card, ErrorBanner, Spinner } from "@/components/ui";

interface PracticeData {
  cards: (Kit["flashcards"][number] & { stat: CardStat | null })[];
  order: string[];
  coverage: { total: number; seen: number; confident: number };
}

/**
 * Practice mode: one card at a time, reveal, then rate confidence 0-3.
 * Session order comes from the server (unseen first, then least confident,
 * then earliest due — see core/practice.ts).
 */
export function PracticeClient({ kit }: { kit: Kit }) {
  const [data, setData] = useState<PracticeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [recording, setRecording] = useState(false);

  const cardById = useMemo(
    () => new Map((data?.cards ?? kit.flashcards.map((f) => ({ ...f, stat: null }))).map((c) => [c.id, c])),
    [data, kit.flashcards]
  );

  async function load() {
    setError(null);
    try {
      const d = await apiGet<PracticeData>(`/api/kits/${kit.id}/practice`);
      setData(d);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id]);

  const queue = data?.order ?? [];
  const currentId = queue[0];
  const current = currentId ? cardById.get(currentId) : undefined;
  const coverage = data?.coverage ?? { total: kit.flashcards.length, seen: 0, confident: 0 };

  async function record(confidence: 0 | 1 | 2 | 3) {
    if (!current) return;
    setRecording(true);
    setError(null);
    try {
      await apiSend(`/api/kits/${kit.id}/practice`, "POST", {
        card_id: current.id,
        confidence,
      });
      setReviewed((n) => n + 1);
      setRevealed(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecording(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Practice — {kit.title}</h1>
          <p className="text-sm text-slate-500">
            {coverage.seen}/{coverage.total} seen · {coverage.confident} confident · weakest cards
            first
          </p>
        </div>
        <Link href={`/kits/${kit.id}`}>
          <Button variant="secondary">Back to kit</Button>
        </Link>
      </header>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {!data ? (
        <Card className="flex items-center justify-center p-10">
          <Spinner />
        </Card>
      ) : kit.flashcards.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          This kit has no flashcards yet.
        </Card>
      ) : !current ? (
        <Card className="p-8 text-center">
          <p className="font-medium">All caught up 🎉</p>
          <p className="mt-1 text-sm text-slate-500">
            You reviewed {reviewed} card{reviewed === 1 ? "" : "s"} this session. Cards return as
            their intervals mature.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              {current.stat && current.stat.reviews > 0 && (
                <Badge tone={current.stat.last_confidence !== null && current.stat.last_confidence >= 2 ? "green" : "amber"}>
                  last: {current.stat.last_confidence !== null ? CONFIDENCE_LABELS[current.stat.last_confidence] : "?"}
                </Badge>
              )}
              {current.requirement_ids.length > 0 && <span>covers: {current.requirement_ids.join(", ")}</span>}
            </div>
            <p className="text-lg font-medium">{current.front}</p>
            {revealed ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{current.back}</p>
              </div>
            ) : (
              <div className="mt-4">
                <Button variant="secondary" onClick={() => setRevealed(true)}>
                  Reveal answer
                </Button>
              </div>
            )}
          </Card>

          {revealed && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="How confident did you feel?">
              {([0, 1, 2, 3] as const).map((confidence) => (
                <Button
                  key={confidence}
                  variant={confidence >= 2 ? "secondary" : "danger"}
                  loading={recording}
                  disabled={recording}
                  onClick={() => record(confidence)}
                >
                  {CONFIDENCE_LABELS[confidence]}
                </Button>
              ))}
            </div>
          )}

          <p className="mt-4 text-center text-xs text-slate-400">
            Cards rated “Again” come back immediately; intervals grow with confidence.
          </p>
        </>
      )}
    </main>
  );
}
