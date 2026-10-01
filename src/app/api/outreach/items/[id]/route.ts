import { withAgent } from "@/lib/agentLog";
import { db, must } from "@/lib/db";
import { kickWorker } from "@/lib/kick";
import { refreshCampaign, sentLast24h, setStatus } from "@/lib/outreach/engine";
import { sendEmail } from "@/lib/outreach/resend";
import type { Attachment, OutreachItem, OutreachStatus } from "@/lib/outreach/types";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const EDITABLE: OutreachStatus[] = ["draft", "todo", "scheduled", "failed"];
// Status changes you can make by hand (tracking LinkedIn steps, replies, skipping).
const MANUAL: OutreachStatus[] = ["draft", "todo", "invited", "connected", "messaged", "followed", "replied", "skipped"];

async function load(id: string) {
  return must(await db().from("le_outreach").select("*").eq("id", id).maybeSingle()) as OutreachItem | null;
}

/** Edit the text, or move the item to another status. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const item = await load(id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { subject?: string; body?: string; note?: string; recipient?: string; status?: OutreachStatus; note_text?: string };

  if (body.status) {
    if (!MANUAL.includes(body.status)) return Response.json({ error: `Can't set ${body.status} by hand` }, { status: 400 });
    const now = new Date().toISOString();
    const extra: Partial<OutreachItem> = {};
    if (body.status === "replied") extra.replied_at = now;
    if (["invited", "followed", "messaged"].includes(body.status) && !item.sent_at) extra.sent_at = now;
    if (body.status === "draft") extra.scheduled_at = null;
    await setStatus(item, body.status, extra, body.note_text);
  } else {
    if (!EDITABLE.includes(item.status)) return Response.json({ error: "Already sent, can't be edited" }, { status: 400 });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["subject", "body", "note", "recipient"] as const) if (typeof body[k] === "string") patch[k] = body[k];
    must(await db().from("le_outreach").update(patch).eq("id", id));
  }
  if (item.campaign_id) await refreshCampaign(item.campaign_id);
  return Response.json(await load(id));
}

/** send: send this email now (still inside the daily limit). regenerate: rewrite the draft. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { action } = (await req.json()) as { action: "send" | "regenerate" };
  const item = await load(id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  if (action === "regenerate") {
    if (!EDITABLE.includes(item.status)) return Response.json({ error: "Already sent" }, { status: 400 });
    await setStatus(item, "generating", { scheduled_at: null });
    await kickWorker(new URL(req.url).origin);
    return Response.json(await load(id));
  }

  if (item.channel !== "email") return Response.json({ error: "Only emails can be sent from here" }, { status: 400 });
  if (!["draft", "scheduled", "failed"].includes(item.status)) return Response.json({ error: "Already sent" }, { status: 400 });
  if (!item.recipient || !item.subject || !item.body) return Response.json({ error: "Recipient, subject and body are required" }, { status: 400 });

  const settings = await getSettings(true);
  const sent = await sentLast24h();
  if (sent >= settings.outreach.dailyLimit) return Response.json({ error: `Daily limit reached (${sent}/${settings.outreach.dailyLimit} in the last 24h). Approve it instead and it goes out when there's room.` }, { status: 429 });

  let attachments: Attachment[] = [];
  if (item.campaign_id) {
    const { data } = await db().from("le_campaigns").select("attachments").eq("id", item.campaign_id).single();
    attachments = (data?.attachments as Attachment[]) ?? [];
  } else {
    try {
      attachments = JSON.parse(item.history.find((h) => h.status === "brief")?.note ?? "{}").attachments ?? [];
    } catch {}
  }

  try {
    const providerId = await withAgent({ agent: "sending", outreachId: item.id, campaignId: item.campaign_id, leadId: item.lead_id, label: item.recipient_name ?? item.recipient }, () => sendEmail({ to: item.recipient!, subject: item.subject!, body: item.body!, attachments, sender: settings.outreach, idempotencyKey: `le-${item.id}` }));
    await setStatus(item, "sent", { provider_id: providerId, sent_at: new Date().toISOString(), error: null, scheduled_at: null }, `To ${item.recipient}`);
  } catch (e) {
    await db().from("le_outreach").update({ error: (e as Error).message.slice(0, 300) }).eq("id", id);
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  if (item.campaign_id) await refreshCampaign(item.campaign_id);
  return Response.json(await load(id));
}
