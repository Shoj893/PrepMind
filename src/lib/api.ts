"use client";

/** Client-side API wrapper. A 401 anywhere redirects to /login. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly detail?: string[]
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login?expired=1";
    }
    throw new ApiError("Your session has expired. Please sign in again.", 401, "unauthorized");
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; detail?: string[] } }
    | null;
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error?.code ?? "error",
      body?.error?.detail
    );
  }
  return body as T;
}

export function apiGet<T>(url: string): Promise<T> {
  return fetch(url, { headers: { accept: "application/json" } }).then((r) => handle<T>(r));
}

export function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  payload?: unknown
): Promise<T> {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then((r) => handle<T>(r));
}
