"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiSend } from "@/lib/api";
import { Button, ErrorBanner, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; detail?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const expired = params.get("expired") === "1";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiSend(`/api/auth/${mode}`, "POST", { email, password });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError({ message: (err as Error).message, detail: (err as { detail?: string[] }).detail });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={mode === "login" ? "Sign in" : "Create account"}>
      {expired && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Your session expired — sign in again to continue.
        </p>
      )}
      {error && <ErrorBanner message={error.message} detail={error.detail} />}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          autoFocus
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Password</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : 1}
          required
        />
        {mode === "register" && (
          <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
        )}
      </label>
      <Button type="submit" loading={loading} className="w-full">
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
