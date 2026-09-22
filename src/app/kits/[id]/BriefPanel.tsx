"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

const KIND_TONE: Record<string, "green" | "blue" | "slate" | "indigo"> = {
  hiring: "green",
  discussion: "blue",
  home: "indigo",
  about: "indigo",
  engineering: "slate",
  other: "slate",
};

export function BriefPanel({ kit, patch, regenerate, busy }: PanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(kit.company.brief_md);

  function startEditing() {
    setDraft(kit.company.brief_md);
    setEditing(true);
  }

  async function save() {
    await patch({ op: "update_brief", brief_md: draft });
    setEditing(false);
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-xs font-bold text-white"
            >
              {kit.company.name.slice(0, 1).toUpperCase()}
            </span>
            {kit.company.name}
            {kit.company.brief_edited && <Badge tone="amber">edited by you</Badge>}
          </h2>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={draft.trim().length === 0}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={startEditing}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={busy}
                  onClick={() => regenerate("brief")}
                >
                  Regenerate
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="p-5">
          {editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              aria-label="Company brief (markdown)"
            />
          ) : (
            <Markdown text={kit.company.brief_md} className="text-[15px] text-slate-700" />
          )}
        </div>
      </Card>

      {kit.meta.notices.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <span aria-hidden="true">💡</span> Generation notes
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {kit.meta.notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Sources used</h3>
        {kit.company.sources.length === 0 ? (
          <p className="text-sm text-slate-500">No sources could be retrieved.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {kit.company.sources.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge tone={KIND_TONE[s.kind] ?? "slate"}>{s.kind}</Badge>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-indigo-700 hover:decoration-indigo-300"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        )}
        {kit.meta.sources_skipped.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
              {kit.meta.sources_skipped.length} source(s) skipped
            </summary>
            <ul className="mt-2 space-y-1 text-sm text-slate-500">
              {kit.meta.sources_skipped.map((s, i) => (
                <li key={i} className="truncate">
                  <span className="text-slate-400">{s.url}</span> — {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}
