import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUser, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";
import { kitQueries, practiceQueries } from "@/server/db";
import { applyReview, coverageStats, newStat, orderSession, type CardStat } from "@/core/practice";
import type { Kit } from "@/core/kit/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const reviewSchema = z.object({
  card_id: z.string().min(1),
  confidence: z.number().int().min(0).max(3),
});

function statsMap(kitId: string): Map<string, CardStat> {
  const map = new Map<string, CardStat>();
  for (const row of practiceQueries.listForKit(kitId)) {
    map.set(row.card_id, {
      card_id: row.card_id,
      repetitions: row.repetitions,
      interval_days: row.interval_days,
      ease: row.ease,
      due_at: row.due_at,
      last_confidence: row.last_confidence,
      reviews: row.reviews,
    });
  }
  return map;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = kitQueries.getById(id);
    if (!row || row.user_id !== auth.user.id) return jsonError(404, "not_found", "Kit not found.");
    if (!row.payload) return jsonError(409, "not_ready", "This kit is still being generated.");

    const kit = JSON.parse(row.payload) as Kit;
    const stats = statsMap(id);
    const cardIds = kit.flashcards.map((f) => f.id);
    const today = new Date();
    return NextResponse.json({
      cards: kit.flashcards.map((f) => ({
        ...f,
        stat: stats.get(f.id) ?? null,
      })),
      order: orderSession(cardIds, stats, today),
      coverage: coverageStats(cardIds, stats),
    });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = kitQueries.getById(id);
    if (!row || row.user_id !== auth.user.id) return jsonError(404, "not_found", "Kit not found.");

    const body = await request.json().catch(() => null);
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    // Card must belong to this kit.
    const kit = row.payload ? (JSON.parse(row.payload) as Kit) : null;
    if (!kit?.flashcards.some((f) => f.id === parsed.data.card_id)) {
      return jsonError(400, "unknown_card", "That flashcard does not belong to this kit.");
    }

    const stats = statsMap(id);
    const current = stats.get(parsed.data.card_id) ?? newStat(parsed.data.card_id);
    const updated = applyReview(current, parsed.data.confidence as 0 | 1 | 2 | 3);
    practiceQueries.upsert(id, updated);
    return NextResponse.json({ stat: updated });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
