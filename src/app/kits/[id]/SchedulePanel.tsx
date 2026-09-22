"use client";

import { CategoryBadge } from "@/components/CategoryBadge";
import { Button, Card, Input } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

export function SchedulePanel({ kit, patch, regenerate, busy }: PanelProps) {
  const byId = new Map(kit.questions.map((q) => [q.id, q]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{kit.schedule.days}</span> day
          {kit.schedule.days === 1 ? "" : "s"} · every must-have requirement is scheduled · harder
          material comes first.
        </p>
        <Button variant="secondary" loading={busy} disabled={busy} onClick={() => regenerate("schedule")}>
          Re-allocate schedule
        </Button>
      </div>

      <ol className="relative space-y-4">
        {kit.schedule.items.map((day) => (
          <li key={day.day} className="relative pl-12">
            {/* timeline spine */}
            <span
              aria-hidden="true"
              className="absolute left-[15px] top-10 h-[calc(100%-1.5rem)] w-0.5 bg-gradient-to-b from-indigo-200 to-violet-100"
            />
            <span
              aria-hidden="true"
              className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white shadow-md shadow-indigo-200"
            >
              {day.day}
            </span>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input
                    value={day.focus}
                    onChange={(e) =>
                      patch({ op: "update_day", day: day.day, patch: { focus: e.target.value } })
                    }
                    aria-label={`Day ${day.day} focus`}
                    className="border-transparent bg-transparent px-2 py-1 font-semibold shadow-none hover:border-slate-200 focus:border-indigo-500"
                  />
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={day.duration_minutes}
                    onChange={(e) =>
                      patch({
                        op: "update_day",
                        day: day.day,
                        patch: { duration_minutes: Math.max(5, Math.min(600, Number(e.target.value) || 5)) },
                      })
                    }
                    aria-label={`Day ${day.day} duration in minutes`}
                    className="w-14 rounded border border-indigo-200 bg-white px-1 py-0.5 text-right text-xs font-semibold text-indigo-700 focus:border-indigo-500 focus:outline-none"
                  />
                  min
                </span>
              </div>

              {day.note && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  <span aria-hidden="true">💡</span>
                  {day.note}
                </p>
              )}

              {day.question_ids.length > 0 ? (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {day.question_ids.map((qid) => {
                    const q = byId.get(qid);
                    if (!q) return null;
                    return (
                      <li key={qid} className="flex items-center gap-2 text-slate-600">
                        <CategoryBadge category={q.category} />
                        <span className="min-w-0 truncate">{q.prompt}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Self-study day for the requirements listed in Coverage.
                </p>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
