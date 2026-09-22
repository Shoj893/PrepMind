"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, BrandMark, Button, Card, EmptyState, ErrorBanner } from "@/components/ui";

export interface KitSummary {
  id: string;
  title: string;
  status: string;
  stage: string;
  company_url: string;
  days: number;
  error: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "indigo"> = {
  ready: "green",
  generating: "indigo",
  regenerating: "indigo",
  queued: "indigo",
  failed: "red",
};

const STATUS_DOT: Record<string, string> = {
  ready: "bg-emerald-500",
  generating: "bg-indigo-500 animate-pulse",
  regenerating: "bg-indigo-500 animate-pulse",
  queued: "bg-indigo-400 animate-pulse",
  failed: "bg-red-500",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function DashboardClient({ email, kits: initial }: { email: string; kits: KitSummary[] }) {
  const router = useRouter();
  const [kits, setKits] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function logout() {
    await apiSend("/api/auth/logout", "POST").catch(() => {});
    router.push("/login");
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiSend(`/api/kits/${id}`, "DELETE");
      setKits((list) => list.filter((k) => k.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function uploadBatch(file: File) {
    setError(null);
    setBatchMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const cases = Array.isArray(parsed) ? parsed : parsed.cases;
      if (!Array.isArray(cases)) throw new Error("Expected a JSON array of cases or {\"cases\": [...]}.");
      const response = await apiSend<{ results: { case_id: string; ok: boolean; error?: string }[] }>(
        "/api/kits/batch",
        "POST",
        { cases }
      );
      const ok = response.results.filter((r) => r.ok).length;
      const failed = response.results.filter((r) => !r.ok);
      setBatchMessage(
        `Created ${ok} kit(s)${failed.length ? `; ${failed.length} failed (${failed.map((f) => `${f.case_id}: ${f.error}`).join("; ")})` : ""}.`
      );
      router.refresh();
      const list = await apiGet<{ kits: KitSummary[] }>("/api/kits");
      setKits(list.kits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const readyCount = kits.filter((k) => k.status === "ready").length;

  return (
    <div className="min-h-screen">
      {/* hero band */}
      <div className="border-b border-slate-200/70 bg-gradient-to-br from-indigo-50 via-white to-violet-50">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandMark />
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Your preparation kits</h1>
                <p className="text-sm text-slate-500">
                  {readyCount} ready · signed in as {email}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Upload a batch file of description-and-company pairs"
                onChange={(e) => e.target.files?.[0] && uploadBatch(e.target.files[0])}
              />
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                Upload batch file
              </Button>
              <Link href="/kits/new">
                <Button>
                  <span aria-hidden="true">＋</span> New kit
                </Button>
              </Link>
              <Button variant="ghost" onClick={logout}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
        {batchMessage && (
          <div className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
            {batchMessage}
          </div>
        )}

        {kits.length === 0 ? (
          <EmptyState
            title="No kits yet"
            hint="Paste a job description and the company's website — PrepMind crawls, researches and builds a personalised kit."
            action={
              <Link href="/kits/new">
                <Button>Create your first kit</Button>
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {kits.map((kit) => (
              <li key={kit.id}>
                <Link href={`/kits/${kit.id}`} className="group block h-full">
                  <Card className="relative h-full overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-100/60">
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="line-clamp-2 font-semibold leading-snug text-slate-900 group-hover:text-indigo-700">
                          {kit.title}
                        </h2>
                        <p className="mt-1 truncate text-xs text-slate-500">{kit.company_url}</p>
                      </div>
                      <Badge tone={STATUS_TONE[kit.status] ?? "slate"}>
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[kit.status] ?? "bg-slate-400"}`} />
                        {kit.status}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-indigo-500"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        {kit.days} day{kit.days === 1 ? "" : "s"}
                      </span>
                      <span>{formatDate(kit.created_at)}</span>
                    </div>
                    {kit.status === "failed" && kit.error && (
                      <p className="mt-3 line-clamp-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
                        {kit.error}
                      </p>
                    )}
                  </Card>
                </Link>
                <div className="mt-1 text-right">
                  <Button variant="ghost" onClick={() => remove(kit.id)} aria-label={`Delete ${kit.title}`} className="text-xs">
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 text-xs text-slate-400">
          Batch files: a JSON array of {"{"} id, jd, company_url, days {"}"} objects.
        </p>
      </div>
    </div>
  );
}
