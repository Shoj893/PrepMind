"use client";

import { CATEGORY_LABELS } from "@/core/kit/types";
import { Badge, Card } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

export function CoveragePanel({ kit }: PanelProps) {
  const byId = new Map(kit.role.requirements.map((r) => [r.id, r]));
  const covered = kit.coverage.covered_requirement_ids;
  const gaps = kit.coverage.gaps;
  const musts = kit.role.requirements.filter((r) => r.kind === "must");

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-500 to-teal-500 p-5 text-white">
          <h2 className="font-semibold">Coverage after {kit.coverage.passes} generation pass(es)</h2>
          <p className="mt-1 text-sm text-emerald-50">
            {covered.length} of {kit.role.requirements.length} requirements have at least one
            question against them — computed by comparing ids, not by asking the model.
          </p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white shadow-sm transition-all"
              style={{
                width: `${kit.role.requirements.length === 0 ? 0 : (covered.length / kit.role.requirements.length) * 100}%`,
              }}
            />
          </div>
          <p className="mt-2 text-sm text-emerald-50">
            {musts.length} must-have requirement{musts.length === 1 ? "" : "s"} ·{" "}
            {musts.filter((r) => covered.includes(r.id)).length} fully covered
          </p>
        </div>
      </Card>

      {gaps.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 p-5">
          <h3 className="font-semibold text-amber-900">
            {gaps.length} requirement{gaps.length === 1 ? "" : "s"} without a question
          </h3>
          <p className="mt-1 text-sm text-amber-800">
            The generator tried {kit.coverage.passes} pass(es). Regenerate the relevant category or
            add a question by hand.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {gaps.map((gap) => {
              const req = byId.get(gap.requirement_id);
              return (
                <li key={gap.requirement_id} className="flex items-start gap-2">
                  <Badge tone={req?.kind === "must" ? "red" : "slate"}>{req?.kind ?? "?"}</Badge>
                  <div>
                    <p className="text-slate-800">{req?.text ?? gap.requirement_id}</p>
                    <p className="text-xs text-slate-500">
                      {req ? CATEGORY_LABELS[req.category] : ""} — {gap.reason}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-semibold">Covered requirements</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {kit.role.requirements
            .filter((r) => covered.includes(r.id))
            .map((r) => (
              <li key={r.id} className="flex items-start gap-2">
                <Badge tone={r.kind === "must" ? "green" : "slate"}>{r.kind}</Badge>
                <span className="text-slate-700">{r.text}</span>
              </li>
            ))}
          {covered.length === 0 && <li className="text-slate-500">Nothing covered yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
