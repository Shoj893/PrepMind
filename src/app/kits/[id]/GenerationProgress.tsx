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
        setPercent(Math.max(percent, data.percent ?? 0));
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
        // Stream dropped — fall back to polling after a moment.
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

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <Spinner />
        <div>
          <h2 className="font-semibold">
            Building your kit{failed ? "" : "…"}
          </h2>
          <p className="text-sm text-slate-500">
            {STEP_LABELS[currentStage] ?? "Working"} — {percent}%
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${failed ? "bg-red-500" : "bg-slate-900"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {events.length > 0 && (
        <ol className="mt-4 max-h-64 space-y-1.5 overflow-y-auto text-sm" aria-live="polite">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-slate-600">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
              <span>{e.message}</span>
            </li>
          ))}
          <div ref={bottom} />
        </ol>
      )}

      {failed && (
        <div className="mt-4 space-y-3">
          <ErrorBanner message={failed} />
          <p className="text-sm text-slate-500">
            You can retry from the <Link href="/dashboard" className="underline">dashboard</Link>{" "}
            (resubmitting the same description retries this kit) or{" "}
            <Link href="/kits/new" className="underline">start a new kit</Link>.
          </p>
        </div>
      )}

      {pollOnly && !failed && (
        <p className="mt-3 text-xs text-slate-400">Live stream unavailable — polling for updates.</p>
      )}
    </Card>
  );
}
