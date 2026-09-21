import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { kitQueries } from "@/server/db";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  const rows = kitQueries.getByUser(user!.id);
  return (
    <DashboardClient
      email={user!.email}
      kits={rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        stage: row.stage,
        company_url: row.company_url,
        days: row.days,
        error: row.error,
        created_at: row.created_at,
      }))}
    />
  );
}
