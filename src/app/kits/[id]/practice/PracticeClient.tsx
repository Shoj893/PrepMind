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

  const reqText = (rid: string) =>
    kit.role.requirements.find((r) => r.id === rid)?.text.slice(0, 60) ?? rid;

  return (
    <main className="min-h-screen">
      <div className="border-b border-slate-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 px-4 py-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Practice — {kit.title}</h1>
            <p className="text-sm text-slate-500">
              {coverage.seen}/{coverage.total} seen · {coverage.confident} confident · weakest
              cards first
            </p>
          </div>
          <Link href={`/kits/${kit.id}`}>
            <Button variant="secondary">Back to kit</Button>
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

        {!data ? (
          <Card className="flex items-center justify-center p-10">
            <Spinner className="text-indigo-600" />
          </Card>
        ) : kit.flashcards.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">
            This kit has no flashcards yet.
          </Card>
        ) : !current ? (
          <Card className="p-10 text-center">
            <p className="text-4xl" aria-hidden="true">🎉</p>
            <p className="mt-3 font-semibold">All caught up</p>
            <p className="mt-1 text-sm text-slate-500">
              You reviewed {reviewed} card{reviewed === 1 ? "" : "s"} this session. Cards return as
              their intervals mature.
            </p>
            <Link href={`/kits/${kit.id}/interview`} className="mt-4 inline-block">
              <Button variant="secondary">Try a mock interview</Button>
            </Link>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {current.stat && current.stat.reviews > 0 && (
                    <Badge
                      tone={
                        current.stat.last_confidence !== null && current.stat.last_confidence >= 2
                          ? "green"
                          : "amber"
                      }
                    >
                      last:{" "}
                      {current.stat.last_confidence !== null
                        ? CONFIDENCE_LABELS[current.stat.last_confidence]
                        : "?"}
                    </Badge>
                  )}
                  {current.requirement_ids.length > 0 && (
                    <span className="truncate">covers: {current.requirement_ids.map(reqText).join(" · ")}</span>
                  )}
                </div>
              </div>
              <div className="p-8">
                <p className="text-center text-lg font-medium leading-relaxed">{current.front}</p>
                {revealed ? (
                  <div className="mt-6 rounded-xl bg-indigo-50/70 p-5 ring-1 ring-inset ring-indigo-100">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-400">
                      Answer
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {current.back}
                    </p>
                  </div>
                ) : (
                  <div className="mt-8 text-center">
                    <Button onClick={() => setRevealed(true)}>Reveal answer</Button>
                    <p className="mt-3 text-xs text-slate-400">
                      Try answering out loud first — then compare.
                    </p>
                  </div>
                )}
              </div>
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
      </div>
    </main>
  );
}
