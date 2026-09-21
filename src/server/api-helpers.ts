import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "./auth";

/**
 * Shared API helpers: consistent JSON errors and an auth guard used by every
 * protected route. A signed-out visitor gets 401; an expired session gets 401
 * with a code the client uses to redirect to /login.
 */

export function jsonError(status: number, code: string, message: string, detail?: string[]) {
  return NextResponse.json({ error: { code, message, detail } }, { status });
}

export async function requireUser(): Promise<
  { user: SessionUser } | { response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: jsonError(401, "unauthorized", "You need to sign in to do that."),
    };
  }
  return { user };
}

export function zodErrorResponse(err: z.ZodError) {
  return jsonError(
    400,
    "invalid_request",
    "The request payload was invalid.",
    err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
  );
}

export function unexpectedErrorResponse(err: unknown) {
  console.error("[api]", err);
  return jsonError(500, "internal", "Something went wrong on our side. Please try again.");
}
