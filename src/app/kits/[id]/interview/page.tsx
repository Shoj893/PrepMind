import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { kitQueries } from "@/server/db";
import { InterviewClient } from "./InterviewClient";
import type { Kit } from "@/core/kit/types";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  const { id } = await params;
  const row = kitQueries.getById(id);
  if (!row || row.user_id !== user.id || !row.payload) redirect("/dashboard");
  return <InterviewClient kit={JSON.parse(row.payload) as Kit} />;
}
