import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUser, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";
import { kitQueries } from "@/server/db";
import { isRunning, runSectionRegeneration } from "@/server/generation";
import { parseRegenSection } from "@/server/regen-runner";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const schema = z.object({
  section: z.string().min(1).max(60),
});

/**
 * Regenerate one section (company brief, one question category, the schedule,
 * or flashcards). Runs in the background like generation; progress arrives
 * over the same SSE stream. A failed regeneration keeps the previous payload.
 */
export async function POST(request: Request, context: RouteContext) {
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
      return jsonError(409, "busy", "A generation or regeneration is already running for this kit.");
    }

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const section = parseRegenSection(parsed.data.section);
    if (!section) {
      return jsonError(400, "invalid_section", `Unknown section: ${parsed.data.section}`);
    }

    await runSectionRegeneration(id, section);
    return NextResponse.json({ ok: true, status: "regenerating" }, { status: 202 });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
