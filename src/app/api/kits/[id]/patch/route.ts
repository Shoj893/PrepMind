import { NextResponse } from "next/server";
import { jsonError, requireUser, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";
import { kitQueries } from "@/server/db";
import { applyOp, opSchema } from "@/server/kit-ops";
import { isRunning } from "@/server/generation";
import type { Kit } from "@/core/kit/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * One PATCH endpoint handling every builder mutation as a validated op
 * (edit, add, delete, move, reorder, pin, brief/schedule/requirement edits).
 * Optimistic UI on the client; each op revalidates the entire kit before it
 * is saved, so a malformed edit can never corrupt the document.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    const row = kitQueries.getById(id);
    if (!row || row.user_id !== auth.user.id) return jsonError(404, "not_found", "Kit not found.");
    if (!row.payload) {
      return jsonError(409, "not_ready", "This kit is still being generated.");
    }
    if (isRunning(id)) {
      return jsonError(409, "busy", "A generation or regeneration is running — wait for it to finish.");
    }

    const body = await request.json().catch(() => null);
    const parsed = opSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    let kit: Kit;
    try {
      kit = applyOp(JSON.parse(row.payload) as Kit, parsed.data);
    } catch (err) {
      if ((err as Error).name === "OpError") {
        return jsonError(400, "invalid_op", (err as Error).message);
      }
      throw err;
    }

    kitQueries.setPayload(id, JSON.stringify(kit), kit.title);
    return NextResponse.json({ kit });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
