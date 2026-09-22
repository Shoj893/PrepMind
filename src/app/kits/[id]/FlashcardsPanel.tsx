"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import type { PanelProps } from "./KitWorkspace";

export function FlashcardsPanel({ kit, patch, regenerate, busy }: PanelProps) {
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {kit.flashcards.length} card{kit.flashcards.length === 1 ? "" : "s"} — your edits and
          hand-added cards survive regeneration.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setAdding((v) => !v)}>
            Add flashcard
          </Button>
          <Button variant="secondary" loading={busy} disabled={busy} onClick={() => regenerate("flashcards")}>
            Regenerate
          </Button>
          <Link href={`/kits/${kit.id}/practice`}>
            <Button>Practice</Button>
          </Link>
        </div>
      </div>

      {adding && (
        <Card className="space-y-2 p-4">
          <Input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front — the prompt" aria-label="New flashcard front" />
          <Textarea value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back — the answer" rows={2} aria-label="New flashcard back" />
          <div className="flex gap-2">
            <Button
              disabled={!front.trim() || !back.trim()}
              onClick={async () => {
                await patch({ op: "add_flashcard", front: front.trim(), back: back.trim(), requirement_ids: [] });
                setFront("");
                setBack("");
                setAdding(false);
              }}
            >
              Add card
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {kit.flashcards.map((card) => (
          <li key={card.id} className="group">
            <Card className="h-full p-4 transition-shadow hover:shadow-md hover:shadow-indigo-100/60">
              <FlashcardFields kitId={kit.id} card={card} patch={patch} />
            </Card>
          </li>
        ))}
      </ul>
      {kit.flashcards.length === 0 && (
        <Card className="p-6 text-center text-sm text-slate-500">
          No flashcards yet — add one by hand or regenerate.
        </Card>
      )}
    </div>
  );
}

function FlashcardFields({
  card,
  patch,
}: {
  kitId: string;
  card: { id: string; front: string; back: string; origin: string; pinned: boolean };
  patch: PanelProps["patch"];
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (field: "front" | "back", value: string) => {
    if (field === "front") setFront(value);
    else setBack(value);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await patch({
          op: "update_flashcard",
          card_id: card.id,
          patch: { front: field === "front" ? value : front, back: field === "back" ? value : back },
        });
        setState("idle");
      } catch {
        setState("error");
      }
    }, 700);
  };

  return (
    <div className="space-y-2">
      <Input value={front} onChange={(e) => save("front", e.target.value)} aria-label="Flashcard front" className="border-transparent bg-transparent px-2 py-1 font-medium shadow-none hover:border-slate-200 focus:border-indigo-500" />
      <Textarea value={back} onChange={(e) => save("back", e.target.value)} rows={2} aria-label="Flashcard back" className="resize-none border-transparent bg-transparent px-2 py-1 text-sm text-slate-600 shadow-none hover:border-slate-200 focus:border-indigo-500" />
      <div className="flex items-center justify-between text-xs">
        <div className="flex gap-1.5">
          <Badge tone={card.origin === "user" ? "indigo" : card.origin === "edited" ? "amber" : "slate"}>
            {card.origin}
          </Badge>
          {state !== "idle" && (
            <span className={state === "saving" ? "text-slate-400" : "text-red-600"}>
              {state === "saving" ? "Saving…" : "Save failed"}
            </span>
          )}
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button variant="ghost" onClick={() => patch({ op: "toggle_pin_flashcard", card_id: card.id })} aria-label={card.pinned ? "Unpin card" : "Pin card"} className={card.pinned ? "text-amber-500" : ""}>
            {card.pinned ? "★" : "☆"}
          </Button>
          <Button variant="danger" onClick={() => patch({ op: "delete_flashcard", card_id: card.id })} aria-label="Delete card">
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
