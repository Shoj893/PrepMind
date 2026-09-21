import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getDb } from "./db";

/**
 * Session auth: scrypt password hashing, opaque random session tokens in an
 * httpOnly cookie, 7-day expiry. No email verification or resets — out of
 * scope by the brief.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "pm_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  getDb()
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expiresAt.toISOString());
  // opportunistic cleanup of expired sessions
  getDb()
    .prepare(`DELETE FROM sessions WHERE expires_at < ?`)
    .run(new Date().toISOString());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function getUserByToken(token: string): SessionUser | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token) as { id: string; email: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

/** Read the session from the request cookie store (server components + routes). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return getUserByToken(store.get(SESSION_COOKIE)?.value ?? "");
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
