import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { BrandMark } from "@/components/ui";
import { NewKitForm } from "./NewKitForm";

export default async function NewKitPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  return (
    <main className="min-h-screen">
      <div className="border-b border-slate-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60">
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">New preparation kit</h1>
              <p className="text-sm text-slate-500">
                Paste the job description, point us at the company&apos;s website, and say how many
                days you have.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <NewKitForm />
      </div>
    </main>
  );
}
