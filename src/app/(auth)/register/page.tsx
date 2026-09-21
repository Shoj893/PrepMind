import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { Card } from "@/components/ui";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-xl font-bold">Create your account</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Your kits are private to your account.
        </p>
        <Suspense>
          <AuthForm mode="register" />
        </Suspense>
        <p className="mt-6 text-center text-sm text-slate-600">
          Already registered?{" "}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
