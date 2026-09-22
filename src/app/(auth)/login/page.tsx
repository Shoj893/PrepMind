import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { BrandMark } from "@/components/ui";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.14),transparent)]"
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
          <h1 className="text-xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">
            Sign in to your interview preparation kits.
          </p>
          <Suspense>
            <AuthForm mode="login" />
          </Suspense>
          <p className="mt-6 text-center text-sm text-slate-600">
            No account yet?{" "}
            <Link href="/register" className="font-semibold text-indigo-600 hover:text-indigo-500">
              Register
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
