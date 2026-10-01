import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A lead with every outreach message on every channel, newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, items] = await Promise.all([
    db().from("le_leads").select("*").eq("id", id).maybeSingle(),
    db().from("le_outreach").select("*, campaign:le_campaigns(name)").eq("lead_id", id).order("created_at", { ascending: false }),
  ]);
  if (!lead.data) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead: lead.data, items: must(items) });
}
