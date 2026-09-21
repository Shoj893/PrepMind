"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBanner } from "@/components/ui";

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

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "blue"> = {
  ready: "green",
  generating: "blue",
  regenerating: "blue",
  queued: "blue",
  failed: "red",
};

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
      if (!Array.isArray(cases)) throw new Error("Expected a JSON array of cases or {\"cases\": [...] }.");
      const response = await apiSend<{ results: { case_id: string; ok: boolean; error?: string; duplicate?: boolean }[] }>(
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
      // refresh the list in place
      const list = await apiGet<{ kits: KitSummary[] }>("/api/kits");
      setKits(list.kits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Your preparation kits</h1>
          <p className="text-sm text-slate-500">Signed in as {email}</p>
        </div>
        <div className="flex items-center gap-2">
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
            <Button>New kit</Button>
          </Link>
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {batchMessage && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{batchMessage}</div>
      )}

      {kits.length === 0 ? (
        <EmptyState
          title="No kits yet"
          hint="Paste a job description and the company's website to build your first kit."
          action={
            <Link href="/kits/new">
              <Button>Create your first kit</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {kits.map((kit) => (
            <li key={kit.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/kits/${kit.id}`}
                      className="font-semibold text-slate-900 underline-offset-2 hover:underline"
                    >
                      {kit.title}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {kit.company_url} · {kit.days} day{kit.days === 1 ? "" : "s"}
                    </p>
                    {kit.status === "failed" && kit.error && (
                      <p className="mt-1 text-sm text-red-700">{kit.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[kit.status] ?? "slate"}>
                      {kit.status === "generating" || kit.status === "regenerating"
                        ? kit.stage || kit.status
                        : kit.status}
                    </Badge>
                    <Button variant="danger" onClick={() => remove(kit.id)} aria-label={`Delete ${kit.title}`}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-slate-400">
        Batch files: a JSON array of {"{"} id, jd, company_url, days {"}"} objects.
      </p>
    </div>
  );
}
