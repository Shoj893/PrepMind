import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, hashPassword, setSessionCookie } from "@/server/auth";
import { getDb } from "@/server/db";
import { jsonError, unexpectedErrorResponse, zodErrorResponse } from "@/server/api-helpers";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const { email, password } = parsed.data;
    const db = getDb();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      return jsonError(409, "email_taken", "That email is already registered. Try signing in.");
    }

    const id = `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, email, await hashPassword(password), new Date().toISOString());

    const { token, expiresAt } = createSession(id);
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user: { id, email } }, { status: 201 });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
