"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, REQUIREMENT_CATEGORIES, type Kit, type Question } from "@/core/kit/types";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

/**
 * Question bank: grouped by category. Text edits are local + debounced (no
 * round-trip per keystroke); structural actions (move, delete, reorder, pin)
 * call the API immediately and the response replaces the kit. User-added and
 * edited questions survive category regeneration.
 */
export function QuestionsPanel({ kit, patch, regenerate, busy }: PanelProps) {
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const move = async (question: Question, direction: -1 | 1) => {
    const ids = kit.questions.filter((q) => q.category === question.category).map((q) => q.id);
    const idx = ids.indexOf(question.id);
    const target = idx + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    await patch({ op: "reorder_questions", category: question.category, question_ids: ids });
  };

  return (
    <div className="space-y-6">
      {REQUIREMENT_CATEGORIES.map((category) => {
        const questions = kit.questions.filter((q) => q.category === category);
        if (questions.length === 0 && addingFor !== category) return null;
        return (
          <Card key={category} className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                {CATEGORY_LABELS[category]}{" "}
                <span className="text-sm font-normal text-slate-400">({questions.length})</span>
              </h3>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAddingFor(category)}>
                  Add question
                </Button>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={busy}
                  onClick={() => regenerate(`questions:${category}`)}
                  title="Regenerates generated questions in this category; your edits and additions survive"
                >
                  Regenerate
                </Button>
              </div>
            </div>

            {addingFor === category && (
              <AddQuestionForm
                kit={kit}
                onCancel={() => setAddingFor(null)}
                onAdd={async (payload) => {
                  await patch({ op: "add_question", question: { ...payload, category } });
                  setAddingFor(null);
                }}
              />
            )}

            <ul className="space-y-3">
              {questions.map((q, idx) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  first={idx === 0}
                  last={idx === questions.length - 1}
                  kit={kit}
                  onMove={move}
                  patch={patch}
                />
              ))}
            </ul>
            {questions.length === 0 && (
              <p className="text-sm text-slate-400">No questions in this category yet.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function QuestionRow({
  question,
  kit,
  first,
  last,
  onMove,
  patch,
}: {
  question: Question;
  kit: Kit;
  first: boolean;
  last: boolean;
  onMove: (q: Question, direction: -1 | 1) => Promise<void>;
  patch: PanelProps["patch"];
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [outline, setOutline] = useState(question.answer_outline_md);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef({ prompt: question.prompt, outline: question.answer_outline_md });

  useEffect(() => {
    setPrompt(question.prompt);
    setOutline(question.answer_outline_md);
    committed.current = { prompt: question.prompt, outline: question.answer_outline_md };
  }, [question.id, question.prompt, question.answer_outline_md]);

  const scheduleSave = (field: "prompt" | "outline", value: string) => {
    if (field === "prompt") setPrompt(value);
    else setOutline(value);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const changed =
        (field === "prompt" ? value : prompt) !== committed.current.prompt ||
        (field === "outline" ? value : outline) !== committed.current.outline;
      if (!changed) {
        setSaved("idle");
        return;
      }
      try {
        await patch({
          op: "update_question",
          question_id: question.id,
          patch: {
            prompt: field === "prompt" ? value : prompt,
            answer_outline_md: field === "outline" ? value : outline,
          },
        });
        committed.current = { prompt, outline };
        setSaved("idle");
      } catch {
        setSaved("error");
      }
    }, 700);
  };

  const requirementTexts = question.requirement_ids
    .map((rid) => kit.role.requirements.find((r) => r.id === rid)?.text)
    .filter(Boolean)
    .slice(0, 2) as string[];

  return (
    <li className="rounded-lg border border-slate-100 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => scheduleSave("prompt", e.target.value)}
            rows={2}
            aria-label="Question prompt"
            className="font-medium"
          />
          {saved !== "idle" && (
            <p className={`text-xs ${saved === "saving" ? "text-slate-400" : "text-red-600"}`}>
              {saved === "saving" ? "Saving…" : "Save failed — retry by editing again"}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Badge tone={question.origin === "user" ? "blue" : question.origin === "edited" ? "amber" : "slate"}>
              {question.origin}
            </Badge>
            {question.pinned && <Badge tone="amber">pinned</Badge>}
            <span>difficulty</span>
            <select
              value={question.difficulty}
              aria-label="Difficulty"
              onChange={(e) =>
                patch({
                  op: "update_question",
                  question_id: question.id,
                  patch: { difficulty: Number(e.target.value) },
                })
              }
              className="rounded border border-slate-200 px-1 py-0.5"
            >
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span>covers</span>
            <span className="max-w-md truncate">{requirementTexts.join(" · ") || "—"}</span>
          </div>
          {open && (
            <div className="space-y-2">
              <Textarea
                value={outline}
                onChange={(e) => scheduleSave("outline", e.target.value)}
                rows={4}
                aria-label="Answer outline"
                className="text-sm"
              />
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Category</span>
                <select
                  value={question.category}
                  aria-label="Move to category"
                  onChange={(e) =>
                    patch({ op: "move_question", question_id: question.id, category: e.target.value })
                  }
                  className="rounded border border-slate-200 px-1 py-0.5"
                >
                  {REQUIREMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => onMove(question, -1)} disabled={first} aria-label="Move question up">
              ↑
            </Button>
            <Button variant="ghost" onClick={() => onMove(question, 1)} disabled={last} aria-label="Move question down">
              ↓
            </Button>
            <Button
              variant="ghost"
              onClick={() => patch({ op: "toggle_pin", question_id: question.id })}
              aria-label={question.pinned ? "Unpin question" : "Pin question"}
              title={question.pinned ? "Unpin" : "Pin — survives regeneration"}
            >
              {question.pinned ? "★" : "☆"}
            </Button>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide outline" : "Answer outline"}
            </Button>
            <Button
              variant="danger"
              onClick={() => patch({ op: "delete_question", question_id: question.id })}
              aria-label="Delete question"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function AddQuestionForm({
  kit,
  onAdd,
  onCancel,
}: {
  kit: Kit;
  onAdd: (payload: { prompt: string; answer_outline_md: string; difficulty: number; requirement_ids: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [requirementId, setRequirementId] = useState(kit.role.requirements[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await onAdd({
            prompt: prompt.trim(),
            answer_outline_md: outline.trim() || "Outline to be written during practice.",
            difficulty,
            requirement_ids: [requirementId],
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Question prompt" required aria-label="New question prompt" />
      <Textarea value={outline} onChange={(e) => setOutline(e.target.value)} placeholder="Answer outline (optional)" rows={2} aria-label="New question answer outline" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className="rounded border border-slate-200 px-1 py-0.5">
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1">
          Requirement
          <select value={requirementId} onChange={(e) => setRequirementId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5">
            {kit.role.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!prompt.trim() || !requirementId}>
          Add
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
