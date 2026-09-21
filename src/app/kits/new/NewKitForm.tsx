"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/api";
import { Button, ErrorBanner, Input, Textarea } from "@/components/ui";

interface CreateResponse {
  kit: { id: string; status: string };
  duplicate: boolean;
}

export function NewKitForm() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState<{ message: string; detail?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const jdValid = jd.trim().length >= 30;
  const urlValid = /^https?:\/\/[^\s]+\.[^\s]+/.test(companyUrl.trim()) || /^[^\s]+\.[^\s]+/.test(companyUrl.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiSend<CreateResponse>("/api/kits", "POST", {
        jd: jd.trim(),
        company_url: companyUrl.trim(),
        days,
      });
      router.push(`/kits/${response.kit.id}`);
    } catch (err) {
      setError({ message: (err as Error).message, detail: (err as { detail?: string[] }).detail });
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Create a preparation kit">
      {error && <ErrorBanner message={error.message} detail={error.detail} />}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Job description</span>
        <Textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          rows={12}
          required
          placeholder={"Paste the full job description here…\n\nInclude the responsibilities and requirements sections — the kit is built from what the posting actually says."}
        />
        <span className={`mt-1 block text-xs ${jdValid ? "text-slate-400" : "text-amber-600"}`}>
          {jd.trim().length} characters {jdValid ? "" : "— at least a couple of sentences, please"}
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Company website</span>
          <Input
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            required
            inputMode="url"
            placeholder="https://example.com"
          />
          <span className="mt-1 block text-xs text-slate-400">
            We crawl this site for what they do and how they hire — careers pages are found by
            following links, not guessed paths.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Days until interview</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            required
          />
          <span className="mt-1 block text-xs text-slate-400">1 to 365</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={loading} disabled={!jdValid || !urlValid}>
          Build my kit
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/dashboard")}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        Generation usually takes a minute or two: the site crawl and the public-discussion search
        are rate-limited on purpose.
      </p>
    </form>
  );
}
