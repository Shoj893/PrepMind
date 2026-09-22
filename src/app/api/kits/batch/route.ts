import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, unexpectedErrorResponse, zodErrorResponse, kitSummary } from "@/server/api-helpers";
import { createKit } from "@/server/generation";
import { kitQueries } from "@/server/db";

const batchSchema = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        jd: z.string().min(30),
        company_url: z.string().min(4),
        days: z.number().int().min(1).max(365),
      })
    )
    .min(1)
    .max(20, "Up to 20 kits per batch from the interface; use `npm run evaluate` for larger sets."),
});

/**
 * Batch entry: create several kits from description-and-company pairs, e.g.
 * from an uploaded JSON file. Each case is created independently; failures
 * for one case do not affect the others.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const results = [];
    for (const [index, case_] of parsed.data.cases.entries()) {
      try {
        const { kit, duplicate } = await createKit({
          userId: auth.user.id,
          jd: case_.jd,
          companyUrl: case_.company_url,
          days: case_.days,
        });
        results.push({
          case_id: case_.id ?? `case_${index + 1}`,
          ok: true,
          duplicate,
          kit: kitSummary(kit),
        });
      } catch (err) {
        results.push({
          case_id: case_.id ?? `case_${index + 1}`,
          ok: false,
          error: (err as Error).message,
        });
      }
    }
    return NextResponse.json({ results }, { status: 201 });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
