import { db, must } from "@/lib/db";
import { kickWorker } from "@/lib/kick";
import { refreshCampaign, scheduleEmails, setStatus } from "@/lib/outreach/engine";
import { ensureWorker } from "@/lib/watchdog";
import type { OutreachItem } from "@/lib/outreach/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  await ensureWorker(new URL(req.url).origin);
  const [campaign, items] = await Promise.all([
    db().from("le_campaigns").select("*").eq("id", id).maybeSingle(),
    db()
      .from("le_outreach")
      .select("*, lead:le_leads(company_name, domain, founder_title, location)")
      .eq("campaign_id", id)
      .order("created_at")
      .limit(2000),
  ]);
  if (!campaign.data) return Response.json({ error: "Campaign not found" }, { status: 404 });
  return Response.json({ campaign: campaign.data, items: must(items) });
}

/**
 * Bulk actions on a campaign's items (all eligible ones, or just `ids`):
 * approve   → email drafts get send times inside the daily limit; LinkedIn drafts become to-do tasks
 * unschedule → scheduled emails go back to drafts
 * regenerate → drafts are rewritten
 * skip      → items are left out
 * pause_drafting / resume_drafting → stop writing drafts, and later carry on with the ones not written yet
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { action, ids } = (await req.json()) as { action: "approve" | "unschedule" | "regenerate" | "skip" | "pause_drafting" | "resume_drafting"; ids?: string[] };
  const { data: campaign } = await db().from("le_campaigns").select("channel").eq("id", id).maybeSingle();
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  // Pausing only touches drafts not written yet, so resuming carries on where it stopped.
  // A draft being written at that moment still finishes.
  if (action === "pause_drafting" || action === "resume_drafting") {
    const [fromStatus, toStatus] = action === "pause_drafting" ? ["generating", "paused"] : ["paused", "generating"];
    const rows = must(
      await db()
        .from("le_outreach")
        .update({ status: toStatus, locked_until: null, updated_at: new Date().toISOString() })
        .eq("campaign_id", id)
        .eq("status", fromStatus)
        .select("id"),
    );
    await refreshCampaign(id);
    if (action === "resume_drafting") await kickWorker(new URL(req.url).origin);
    return Response.json({ count: rows?.length ?? 0 });
  }

  const from: Record<string, string[]> = {
    approve: ["draft"],
    unschedule: ["scheduled"],
    regenerate: ["draft", "failed"],
    skip: ["draft", "scheduled", "failed", "todo"],
  };
  let q = db().from("le_outreach").select("id, lead_id, target, history, status").eq("campaign_id", id).in("status", from[action] ?? []);
  if (ids?.length) q = q.in("id", ids);
  const items = must(await q.order("created_at")) as OutreachItem[];

  let result: Record<string, unknown> = { count: items.length };
  if (action === "approve" && campaign.channel === "email") {
    result = await scheduleEmails(items.map((i) => i.id));
  } else {
    const to = action === "approve" ? "todo" : action === "unschedule" ? "draft" : action === "regenerate" ? "generating" : "skipped";
    for (let i = 0; i < items.length; i += 25) {
      await Promise.all(items.slice(i, i + 25).map((it) => setStatus(it, to as OutreachItem["status"], to === "draft" ? { scheduled_at: null } : {})));
    }
  }
  await refreshCampaign(id);
  if (action === "approve" || action === "regenerate") await kickWorker(new URL(req.url).origin);
  return Response.json(result);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const { count } = await db().from("le_outreach").select("id", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["sent", "delivered", "bounced", "invited", "connected", "messaged", "followed", "replied"]);
  if (count) return Response.json({ error: `${count} messages already went out from this campaign, so it's kept for tracking. Skip the rest instead.` }, { status: 400 });
  // Free the leads up for other campaigns before their drafts disappear.
  const items = must(await db().from("le_outreach").select("id, lead_id, target, history").eq("campaign_id", id)) as OutreachItem[];
  for (let i = 0; i < items.length; i += 25) {
    await Promise.all(items.slice(i, i + 25).map((it) => db().rpc("le_set_outreach", { p_lead: it.lead_id, p_target: it.target, p_status: "skipped", p_force: false })));
  }
  must(await db().from("le_campaigns").delete().eq("id", id));
  return Response.json({ ok: true });
}
