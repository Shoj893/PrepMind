import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getSessionUser } from "@/server/auth";
import { unexpectedErrorResponse } from "@/server/api-helpers";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";

export async function POST() {
  try {
    const user = await getSessionUser();
    if (user) {
      const store = await cookies();
      const token = store.get(SESSION_COOKIE)?.value;
      if (token) destroySession(token);
    }
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}
