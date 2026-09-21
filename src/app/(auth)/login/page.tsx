import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { Card } from "@/components/ui";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-xl font-bold">Sign in to PrepMind</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Turn job descriptions into interview preparation kits.
        </p>
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
        <p className="mt-6 text-center text-sm text-slate-600">
          No account yet?{" "}
          <Link href="/register" className="font-medium text-slate-900 underline">
            Register
          </Link>
        </p>
      </Card>
    </main>
  );
}
