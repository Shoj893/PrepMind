import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireUser, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";
import { createKit } from "@/server/generation";
import { kitQueries } from "@/server/db";

const createSchema = z.object({
  jd: z.string().min(30, "Paste the full job description (at least a couple of sentences).").max(200_000),
  company_url: z.string().trim().min(4).max(2000),
  days: z.number().int().min(1).max(365),
});

export function kitSummary(row: ReturnType<typeof kitQueries.getByUser>[number]) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    stage: row.stage,
    company_url: row.company_url,
    days: row.days,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET() {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const rows = kitQueries.getByUser(auth.user.id);
    return NextResponse.json({ kits: rows.map(kitSummary) });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    // Basic URL sanity here; full SSRF validation happens inside the fetcher.
    try {
      const url = new URL(parsed.data.company_url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return jsonError(400, "invalid_url", "The company website must be an http(s) URL.");
      }
    } catch {
      return jsonError(400, "invalid_url", "That doesn't look like a website address.");
    }

    const { kit, duplicate } = await createKit({
      userId: auth.user.id,
      jd: parsed.data.jd,
      companyUrl: parsed.data.company_url,
      days: parsed.data.days,
    });
    return NextResponse.json(
      { kit: kitSummary(kit), duplicate },
      { status: duplicate ? 200 : 201 }
    );
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
