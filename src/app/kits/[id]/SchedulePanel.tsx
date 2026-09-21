"use client";

import { CATEGORY_LABELS } from "@/core/kit/types";
import { Badge, Button, Card, Input } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

export function SchedulePanel({ kit, patch, regenerate, busy }: PanelProps) {
  const byId = new Map(kit.questions.map((q) => [q.id, q]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {kit.schedule.days} day{kit.schedule.days === 1 ? "" : "s"} · every must-have requirement
          is scheduled. Harder material comes first.
        </p>
        <Button variant="secondary" loading={busy} disabled={busy} onClick={() => regenerate("schedule")}>
          Re-allocate schedule
        </Button>
      </div>

      <ol className="space-y-3">
        {kit.schedule.items.map((day) => (
          <li key={day.day}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                    {day.day}
                  </span>
                  <Input
                    value={day.focus}
                    onChange={(e) =>
                      patch({ op: "update_day", day: day.day, patch: { focus: e.target.value } })
                    }
                    aria-label={`Day ${day.day} focus`}
                    className="font-medium"
                  />
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <label className="flex items-center gap-1">
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
                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right"
                    />
                    min
                  </label>
                </div>
              </div>

              {day.note && <p className="mt-2 text-xs text-amber-700">{day.note}</p>}

              {day.question_ids.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {day.question_ids.map((qid) => {
                    const q = byId.get(qid);
                    if (!q) return null;
                    return (
                      <li key={qid} className="flex items-center gap-2 text-slate-600">
                        <Badge tone="slate">{CATEGORY_LABELS[q.category]}</Badge>
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
