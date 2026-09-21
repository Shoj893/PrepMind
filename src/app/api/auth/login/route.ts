import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, setSessionCookie, verifyPassword } from "@/server/auth";
import { getDb } from "@/server/db";
import { jsonError, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";

const schema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const row = getDb()
      .prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`)
      .get(parsed.data.email) as
      | { id: string; email: string; password_hash: string }
      | undefined;

    if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
      return jsonError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    const { token, expiresAt } = createSession(row.id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user: { id: row.id, email: row.email } });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
