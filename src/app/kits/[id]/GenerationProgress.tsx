"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { Card, ErrorBanner, Spinner } from "@/components/ui";

export interface ProgressEvent {
  type: "progress" | "done";
  stage?: string;
  message?: string;
  percent?: number;
  status?: string;
  error?: string;
}

const STEP_LABELS: Record<string, string> = {
  requirements: "Reading the job description",
  crawl: "Crawling the company site",
  discussion: "Searching public interview discussion",
  brief: "Writing the company brief",
  questions: "Generating questions per requirement",
  coverage: "Checking requirement coverage",
  flashcards: "Building flashcards",
  schedule: "Allocating your study days",
  validating: "Validating the kit",
  done: "Ready",
  error: "Failed",
};

const STEP_ICONS: Record<string, string> = {
  requirements: "📄",
  crawl: "🕷️",
  discussion: "🔎",
  brief: "🏢",
  questions: "❓",
  coverage: "✅",
  flashcards: "🃏",
  schedule: "📅",
  validating: "🔍",
};

/**
 * Live generation progress over Server-Sent Events, with a polling fallback
 * if the stream cannot be established. Events are persisted server-side, so
 * refreshing the page or opening a second tab re-joins mid-run.
 */
export function GenerationProgress({
  kitId,
  initialStage,
  initialError,
  onReady,
}: {
  kitId: string;
  initialStage: string;
  initialError: string | null;
  onReady: () => void;
}) {
  const [events, setEvents] = useState<{ stage: string; message: string; percent: number }[]>([]);
  const [percent, setPercent] = useState(2);
  const [failed, setFailed] = useState<string | null>(initialError);
  const [pollOnly, setPollOnly] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const handle = (data: ProgressEvent) => {
      if (data.type === "progress" && data.message) {
        setEvents((list) =>
          list.some((e) => e.message === data.message && e.percent === data.percent)
            ? list
            : [...list, { stage: data.stage ?? "", message: data.message!, percent: data.percent ?? 0 }]
        );
        setPercent((prev) => Math.max(prev, data.percent ?? 0));
      }
      if (data.type === "done") {
        if (data.status === "failed") setFailed(data.error ?? "Generation failed.");
        else onReady();
        closed = true;
        source?.close();
        if (pollTimer) clearInterval(pollTimer);
      }
    };

    const poll = async () => {
      try {
        const data = await apiGet<{ kit: { status: string; error: string | null }; running: boolean }>(
          `/api/kits/${kitId}`
        );
        if (data.kit.status === "ready" && !data.running) {
          onReady();
          closed = true;
        } else if (data.kit.status === "failed" && !data.running) {
          setFailed(data.kit.error ?? "Generation failed.");
          closed = true;
        }
      } catch {
        // transient — keep polling
      }
    };

    try {
      source = new EventSource(`/api/kits/${kitId}/events`);
      source.onmessage = (e) => handle(JSON.parse(e.data) as ProgressEvent);
      source.onerror = () => {
        setTimeout(() => {
          if (!closed && !pollTimer) {
            setPollOnly(true);
            pollTimer = setInterval(poll, 2000);
          }
        }, 1500);
      };
    } catch {
      setPollOnly(true);
      pollTimer = setInterval(poll, 2000);
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  const currentStage = events[events.length - 1]?.stage ?? initialStage;
  const currentIcon = STEP_ICONS[currentStage] ?? "⚙️";

  return (
    <main className="min-h-screen">
      <div className="border-b border-slate-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <h1 className="text-xl font-bold tracking-tight">Building your kit</h1>
          <p className="text-sm text-slate-500">
            The research runs step by step — you can watch each stage land.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl backdrop-blur">
                {failed ? "⚠️" : currentIcon}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">
                  {failed ? "Generation failed" : STEP_LABELS[currentStage] ?? "Working"}
                </h2>
                <p className="text-sm text-indigo-100">{percent}% complete</p>
              </div>
              {!failed && <Spinner className="h-6 w-6 text-white/80" />}
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full bg-white transition-all duration-500 ${failed ? "opacity-40" : ""}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {events.length > 0 && (
            <ol className="max-h-72 space-y-0 overflow-y-auto p-5" aria-live="polite">
              {events.map((e, i) => {
                const isLast = i === events.length - 1;
                return (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    {!isLast && (
                      <span aria-hidden="true" className="absolute left-[9px] top-5 h-full w-px bg-slate-200" />
                    )}
                    <span
                      aria-hidden="true"
                      className={`relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isLast && !failed
                          ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isLast && !failed ? "●" : "✓"}
                    </span>
                    <span className={`text-sm leading-5 ${isLast ? "font-medium text-slate-900" : "text-slate-600"}`}>
                      {e.message}
                    </span>
                  </li>
                );
              })}
              <div ref={bottom} />
            </ol>
          )}
        </Card>

        {failed && (
          <div className="mt-4 space-y-3">
            <ErrorBanner message={failed} />
            <p className="text-sm text-slate-500">
              You can retry from the <Link href="/dashboard" className="font-medium text-indigo-600 underline">dashboard</Link>{" "}
              (resubmitting the same description retries this kit) or{" "}
              <Link href="/kits/new" className="font-medium text-indigo-600 underline">start a new kit</Link>.
            </p>
          </div>
        )}

        {pollOnly && !failed && (
          <p className="mt-3 text-xs text-slate-400">Live stream unavailable — polling for updates.</p>
        )}
      </div>
    </main>
  );
}
