"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Kit } from "@/core/kit/types";
import type { KitOp } from "@/server/kit-ops";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, Button, ErrorBanner } from "@/components/ui";
import { GenerationProgress } from "./GenerationProgress";
import { BriefPanel } from "./BriefPanel";
import { RolePanel } from "./RolePanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { FlashcardsPanel } from "./FlashcardsPanel";
import { SchedulePanel } from "./SchedulePanel";
import { CoveragePanel } from "./CoveragePanel";

type Tab = "brief" | "role" | "questions" | "flashcards" | "schedule" | "coverage";

const TABS: { id: Tab; label: string }[] = [
  { id: "brief", label: "Company brief" },
  { id: "role", label: "Role & requirements" },
  { id: "questions", label: "Question bank" },
  { id: "flashcards", label: "Flashcards" },
  { id: "schedule", label: "Schedule" },
  { id: "coverage", label: "Coverage" },
];

export interface PanelProps {
  kit: Kit;
  patch: (op: KitOp) => Promise<void>;
  regenerate: (section: string) => Promise<void>;
  busy: boolean;
}

export function KitWorkspace({
  kitId,
  initialStatus,
  initialStage,
  initialError,
  initialKit,
}: {
  kitId: string;
  initialStatus: string;
  initialStage: string;
  initialError: string | null;
  initialKit: Kit | null;
}) {
  const [kit, setKit] = useState<Kit | null>(initialKit);
  const [regenerating, setRegenerating] = useState<string | null>(
    initialStatus === "regenerating" ? initialStage : null
  );
  const [error, setError] = useState<{ message: string; detail?: string[] } | null>(null);
  const [tab, setTab] = useState<Tab>("brief");

  const refetch = useCallback(async () => {
    const data = await apiGet<{ kit: { status: string; error: string | null }; payload: Kit | null }>(
      `/api/kits/${kitId}`
    );
    setKit(data.payload);
    setRegenerating(data.kit.status === "regenerating" ? "regen" : null);
    if (data.kit.status === "failed" && data.kit.error) {
      setError({ message: data.kit.error });
    }
  }, [kitId]);

  const patch = useCallback(
    async (op: KitOp) => {
      setError(null);
      try {
        const response = await apiSend<{ kit: Kit }>(`/api/kits/${kitId}/patch`, "PATCH", op);
        setKit(response.kit);
      } catch (err) {
        setError({ message: (err as Error).message, detail: (err as { detail?: string[] }).detail });
        throw err;
      }
    },
    [kitId]
  );

  const regenerate = useCallback(
    async (section: string) => {
      setError(null);
      setRegenerating(section);
      try {
        await apiSend(`/api/kits/${kitId}/regenerate`, "POST", { section });
        // The SSE-driven progress is shown by GenerationProgress via the
        // regenerating state; poll until done (sections are quicker).
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const data = await apiGet<{ kit: { status: string } }>("/api/kits/" + kitId);
          if (data.kit.status !== "regenerating" || Date.now() - started > 300_000) break;
        }
        await refetch();
      } catch (err) {
        setError({ message: (err as Error).message });
      } finally {
        setRegenerating(null);
      }
    },
    [kitId, refetch]
  );

  if (!kit) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <GenerationProgress
          kitId={kitId}
          initialStage={initialStage}
          initialError={initialError}
          onReady={refetch}
        />
      </main>
    );
  }

  const panelProps: PanelProps = { kit, patch, regenerate, busy: regenerating !== null };
  const gaps = kit.coverage.gaps.length;

  return (
    <main className="min-h-screen">
      {/* header band */}
      <div className="border-b border-slate-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{kit.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {kit.role.title}
                </span>
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {kit.company.name}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  {kit.schedule.days} days
                </span>
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {kit.questions.length} questions
                </span>
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {kit.flashcards.length} cards
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {regenerating && <Badge tone="indigo">regenerating…</Badge>}
              <Link href={`/kits/${kitId}/practice`}>
                <Button>Practice</Button>
              </Link>
              <Link href={`/kits/${kitId}/interview`}>
                <Button variant="secondary">Mock interview</Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="ghost">All kits</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error.message} detail={error.detail} />
          </div>
        )}
        {gaps > 0 && (
          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            {gaps} requirement{gaps === 1 ? " has" : "s have"} no question yet — see Coverage.
          </div>
        )}

        <nav
          className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1"
          aria-label="Kit sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                tab === t.id
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              {t.id === "coverage" && gaps > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{gaps}</span>
              )}
            </button>
          ))}
        </nav>

        <section aria-label={tab}>
          {tab === "brief" && <BriefPanel {...panelProps} />}
          {tab === "role" && <RolePanel {...panelProps} />}
          {tab === "questions" && <QuestionsPanel {...panelProps} />}
          {tab === "flashcards" && <FlashcardsPanel {...panelProps} />}
          {tab === "schedule" && <SchedulePanel {...panelProps} />}
          {tab === "coverage" && <CoveragePanel {...panelProps} />}
        </section>
      </div>
    </main>
  );
}
