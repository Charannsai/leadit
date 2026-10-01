import { withAgent } from "@/lib/agentLog";
import { db, must } from "@/lib/db";
import { recipientFor, writeDraft } from "@/lib/outreach/generate";
import { channelOf, type Attachment, type Target } from "@/lib/outreach/types";
import { getSettings } from "@/lib/settings";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-off outreach for a single lead (outside a campaign): writes the draft right away. */
export async function POST(req: Request) {
  const body = (await req.json()) as { leadId: string; target: Target; brief: string; tone?: string; cta?: string; attachments?: Attachment[] };
  const lead = (await db().from("le_leads").select("*").eq("id", body.leadId).maybeSingle()).data as Lead | null;
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!body.brief?.trim()) return Response.json({ error: "Write what the outreach is for" }, { status: 400 });
  const r = recipientFor(lead, body.target);
  if (!r) return Response.json({ error: "This lead has nothing to contact on that channel" }, { status: 400 });

  const attachments = channelOf(body.target) === "email" ? body.attachments ?? [] : [];
  let draft;
  try {
    const { outreach } = await getSettings();
    draft = await withAgent({ agent: "drafting", leadId: lead.id, label: lead.company_name }, () => writeDraft(lead, r.target, r.name, { brief: body.brief, tone: body.tone, cta: body.cta, attachmentNames: attachments.map((a) => a.name) }, outreach));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  const now = new Date().toISOString();
  const item = must(
    await db()
      .from("le_outreach")
      .insert({
        lead_id: lead.id,
        upload_id: lead.upload_id,
        channel: channelOf(r.target),
        target: r.target,
        recipient_name: r.name,
        recipient: r.address,
        subject: draft.subject,
        body: draft.body,
        note: draft.note,
        status: "draft",
        // The brief lives in history so "regenerate" can reuse it.
        history: [
          { at: now, status: "brief", note: JSON.stringify({ brief: body.brief, tone: body.tone, cta: body.cta, attachments }) },
          { at: now, status: "draft" },
        ],
      })
      .select("*")
      .single(),
  );
  await db().rpc("le_set_outreach", { p_lead: lead.id, p_target: r.target, p_status: "draft", p_force: false });
  return Response.json(item);
}
