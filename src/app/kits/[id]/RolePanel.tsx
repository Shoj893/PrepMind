"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

export function RolePanel({ kit, patch }: PanelProps) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="font-semibold">{kit.role.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{kit.role.summary_md}</p>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Requirements</h3>
          <span className="text-sm text-slate-500">
            {kit.role.requirements.filter((r) => r.kind === "must").length} must ·{" "}
            {kit.role.requirements.filter((r) => r.kind === "nice").length} nice
          </span>
        </div>
        <ul className="space-y-3">
          {kit.role.requirements.map((req) => (
            <RequirementRow
              key={req.id}
              id={req.id}
              text={req.text}
              kind={req.kind}
              category={req.category}
              questionCount={
                kit.questions.filter((q) => q.requirement_ids.includes(req.id)).length
              }
              onChange={(text, kind) =>
                patch({ op: "update_requirement", requirement_id: req.id, patch: { text, kind } })
              }
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RequirementRow({
  text,
  kind,
  category,
  questionCount,
  onChange,
}: {
  id: string;
  text: string;
  kind: "must" | "nice";
  category: string;
  questionCount: number;
  onChange: (text: string, kind: "must" | "nice") => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Requirement text"
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  onChange(draft.trim(), kind).finally(() => setEditing(false));
                }
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
          ) : (
            <p className="text-sm text-slate-800">{text}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={kind}
            aria-label="Requirement priority"
            onChange={(e) => onChange(text, e.target.value as "must" | "nice")}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          >
            <option value="must">must</option>
            <option value="nice">nice</option>
          </select>
          <Badge>{category.replace("_", " ")}</Badge>
          <Badge tone={questionCount > 0 ? "green" : "red"}>
            {questionCount} question{questionCount === 1 ? "" : "s"}
          </Badge>
          <Button variant="ghost" onClick={() => setEditing((v) => !v)} aria-label="Edit requirement">
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>
    </li>
  );
}
