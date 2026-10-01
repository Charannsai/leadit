import { db } from "@/lib/db";
import { workerAlive } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const [{ data, error }, alive, events] = await Promise.all([
    db().rpc("le_overview"),
    workerAlive(),
    db().from("le_lead_events").select("id, lead_id, upload_id, at, level, message").order("at", { ascending: false }).limit(12),
  ]);
  if (error) {
    const msg = /schema cache|does not exist|le_overview/.test(error.message) ? "Run supabase/002_keys_overview.sql in Supabase to enable the overview." : error.message;
    return Response.json({ error: msg }, { status: 500 });
  }
  return Response.json({ ...data, worker: { alive }, events: events.data ?? [] });
}
