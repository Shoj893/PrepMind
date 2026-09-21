import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { kitQueries } from "@/server/db";
import { KitWorkspace } from "./KitWorkspace";
import type { Kit } from "@/core/kit/types";

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  const { id } = await params;
  const row = kitQueries.getById(id);
  if (!row || row.user_id !== user.id) redirect("/dashboard");

  return (
    <KitWorkspace
      kitId={row.id}
      initialStatus={row.status}
      initialStage={row.stage}
      initialError={row.error}
      initialKit={row.payload ? (JSON.parse(row.payload) as Kit) : null}
    />
  );
}
