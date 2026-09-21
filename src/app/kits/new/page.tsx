import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { NewKitForm } from "./NewKitForm";

export default async function NewKitPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">New preparation kit</h1>
      <p className="mt-1 text-sm text-slate-500">
        Paste the job description, point us at the company&apos;s website, and say how many days
        you have. We crawl the site, look for public interview discussion, and build the kit step
        by step — you can watch it happen.
      </p>
      <div className="mt-6">
        <NewKitForm />
      </div>
    </main>
  );
}
