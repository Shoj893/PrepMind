import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { BrandMark } from "@/components/ui";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(139,92,246,0.14),transparent)]"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-lg font-bold tracking-tight">PrepMind</p>
            <p className="text-xs text-slate-500">Interview prep that does the research</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-xl shadow-slate-200/60">
          <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">
            Your kits stay private to your account.
          </p>
          <Suspense>
            <AuthForm mode="register" />
          </Suspense>
          <p className="mt-6 text-center text-sm text-slate-600">
            Already registered?{" "}
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
