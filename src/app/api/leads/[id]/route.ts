import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, events] = await Promise.all([
    db().from("le_leads").select("*").eq("id", id).maybeSingle(),
    db().from("le_lead_events").select("id, at, level, message").eq("lead_id", id).order("at", { ascending: true }).limit(100),
  ]);
  return Response.json({ lead: must(lead), events: must(events) });
}
