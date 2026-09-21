import { NextResponse } from "next/server";
import { jsonError, requireUser, unexpectedErrorResponse } from "@/server/api-helpers";
import { kitQueries } from "@/server/db";
import { isRunning } from "@/server/generation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadOwnedKit(userId: string, id: string) {
  const row = kitQueries.getById(id);
  if (!row || row.user_id !== userId) return null;
  return row;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = await loadOwnedKit(auth.user.id, id);
    if (!row) return jsonError(404, "not_found", "Kit not found.");

    return NextResponse.json({
      kit: {
        id: row.id,
        title: row.title,
        status: row.status,
        stage: row.stage,
        company_url: row.company_url,
        days: row.days,
        error: row.error,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      // The full document only exists once generation finished.
      payload: row.payload ? JSON.parse(row.payload) : null,
      running: isRunning(row.id),
    });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = await loadOwnedKit(auth.user.id, id);
    if (!row) return jsonError(404, "not_found", "Kit not found.");
    if (isRunning(id)) {
      return jsonError(409, "busy", "This kit is being generated right now — try again in a moment.");
    }
    kitQueries.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
