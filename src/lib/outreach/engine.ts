import "server-only";
import { logJob, withAgent } from "../agentLog";
import { RateLimitError } from "../budget";
import { db, must } from "../db";
import { getSettings } from "../settings";
import type { Lead } from "../types";
import { writeDraft, type Brief } from "./generate";
import { emailEvent, NO_SENDER, sendEmail, SendError } from "./resend";
import type { Attachment, Campaign, OutreachItem, OutreachStatus } from "./types";

const DAY_MS = 86_400_000;

/** Updates an outreach row (with a history entry) and the lead's per-channel status. */
export async function setStatus(item: Pick<OutreachItem, "id" | "lead_id" | "target" | "history">, status: OutreachStatus, extra: Partial<OutreachItem> = {}, note?: string) {
  const history = [...(item.history ?? []), { at: new Date().toISOString(), status, ...(note ? { note } : {}) }].slice(-30);
  must(await db().from("le_outreach").update({ ...extra, status, history, locked_until: null, updated_at: new Date().toISOString() }).eq("id", item.id));
  // A fresh draft or a skip shouldn't overwrite "sent"; the SQL function only moves forward.
  must(await db().rpc("le_set_outreach", { p_lead: item.lead_id, p_target: item.target, p_status: status, p_force: false }));
}

/** Emails sent in the last 24 hours (Resend's daily limit is a rolling window). */
export async function sentLast24h(): Promise<number> {
  const { count } = await db().from("le_outreach").select("id", { count: "exact", head: true }).eq("channel", "email").gte("sent_at", new Date(Date.now() - DAY_MS).toISOString());
  return count ?? 0;
}

/**
 * Gives approved emails a send time: one every gapSeconds after the last one already queued,
 * never more than dailyLimit inside any 24 hours. Returns when the last one goes out.
 */
export async function scheduleEmails(ids: string[]) {
  if (!ids.length) return { scheduled: 0, firstAt: null as string | null, lastAt: null as string | null };
  const { outreach } = await getSettings(true);
  const gap = outreach.gapSeconds * 1000;

  const [{ data: tail }, { data: recent }] = await Promise.all([
    db().from("le_outreach").select("scheduled_at").eq("status", "scheduled").order("scheduled_at", { ascending: false }).limit(1),
    db().from("le_outreach").select("sent_at").eq("channel", "email").gte("sent_at", new Date(Date.now() - DAY_MS).toISOString()).order("sent_at"),
  ]);
  // Times already used in the rolling window: sent ones plus everything queued.
  const { data: queued } = await db().from("le_outreach").select("scheduled_at").eq("status", "scheduled").order("scheduled_at");
  const slots = [...(recent ?? []).map((r) => Date.parse(r.sent_at)), ...(queued ?? []).map((r) => Date.parse(r.scheduled_at))].sort((a, b) => a - b);

  let t = Math.max(Date.now() + 5_000, tail?.[0]?.scheduled_at ? Date.parse(tail[0].scheduled_at) + gap : 0);
  const times: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    // If the 24h window ending at t is full, move t to when its oldest send drops out.
    for (;;) {
      const inWindow = slots.filter((s) => s > t - DAY_MS && s <= t);
      if (inWindow.length < outreach.dailyLimit) break;
      t = inWindow[0] + DAY_MS + 1000;
    }
    times.push(t);
    slots.push(t);
    slots.sort((a, b) => a - b);
    t += gap;
  }

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await Promise.all(
      chunk.map(async (id, j) => {
        const { data: row } = await db().from("le_outreach").select("id, lead_id, target, history").eq("id", id).single();
        if (row) await setStatus(row as OutreachItem, "scheduled", { scheduled_at: new Date(times[i + j]).toISOString(), error: null } as Partial<OutreachItem>);
      }),
    );
  }
  return { scheduled: ids.length, firstAt: new Date(times[0]).toISOString(), lastAt: new Date(times[times.length - 1]).toISOString() };
}

const campaignCache = new Map<string, { at: number; c: Campaign }>();
async function campaignOf(id: string | null): Promise<Campaign | null> {
  if (!id) return null;
  const hit = campaignCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.c;
  const { data } = await db().from("le_campaigns").select("*").eq("id", id).maybeSingle();
  if (data) campaignCache.set(id, { at: Date.now(), c: data as Campaign });
  return (data as Campaign) ?? null;
}

/** Brief stored on single (non-campaign) outreach rows, in history[0].note as JSON. */
function briefOf(item: OutreachItem, campaign: Campaign | null): { brief: Brief; attachments: Attachment[] } {
  if (campaign) return { brief: { brief: campaign.brief, tone: campaign.tone, cta: campaign.cta, attachmentNames: campaign.attachments.map((a) => a.name) }, attachments: campaign.attachments };
  try {
    const meta = JSON.parse(item.history?.find((h) => h.status === "brief")?.note ?? "{}") as { brief?: string; tone?: string; cta?: string; attachments?: Attachment[] };
    return { brief: { brief: meta.brief ?? "", tone: meta.tone, cta: meta.cta, attachmentNames: (meta.attachments ?? []).map((a) => a.name) }, attachments: meta.attachments ?? [] };
  } catch {
    return { brief: { brief: "" }, attachments: [] };
  }
}

/** Runs one claimed outreach job: write a draft, or send a scheduled email. */
export async function processOutreach(item: OutreachItem) {
  const campaign = await campaignOf(item.campaign_id);
  const { brief, attachments } = briefOf(item, campaign);
  const settings = await getSettings();

  if (item.status === "generating") {
    const startedAt = performance.now();
    try {
      const { data: lead } = await db().from("le_leads").select("*").eq("id", item.lead_id).single();
      const d = await writeDraft(lead as Lead, item.target, item.recipient_name, brief, settings.outreach);
      await setStatus(item, "draft", { subject: d.subject, body: d.body, note: d.note, error: null });
      await logJob("write draft", "ok", startedAt, d.subject ?? d.note ?? d.body.slice(0, 80), { target: item.target, company: (lead as Lead)?.company_name });
    } catch (e) {
      await logJob("write draft", e instanceof RateLimitError ? "rate_limited" : "error", startedAt, (e as Error).message, { target: item.target });
      if (e instanceof RateLimitError) {
        await db().from("le_outreach").update({ locked_until: new Date(Date.now() + e.retryAfterSec * 1000).toISOString(), attempts: Math.max(0, item.attempts - 1) } as never).eq("id", item.id);
        return;
      }
      if (item.attempts >= 3) await setStatus(item, "failed", { error: (e as Error).message.slice(0, 300) }, "Draft could not be written");
      else await db().from("le_outreach").update({ locked_until: new Date(Date.now() + 30_000).toISOString(), error: (e as Error).message.slice(0, 300) }).eq("id", item.id);
    }
    if (item.campaign_id) await refreshCampaign(item.campaign_id);
    return;
  }

  if (item.status === "scheduled") {
    // One send at a time, so the gap check below can't be raced by parallel worker slots.
    const run = sendLock.then(() => sendScheduled(item, attachments, settings));
    sendLock = run.catch(() => {});
    await run;
  }
}

let sendLock: Promise<unknown> = Promise.resolve();

async function sendScheduled(item: OutreachItem, attachments: Attachment[], settings: Awaited<ReturnType<typeof getSettings>>) {
  {
    // Push this email back to a later time without counting it as a failed attempt.
    const defer = (at: number) =>
      db().from("le_outreach").update({ scheduled_at: new Date(at).toISOString(), locked_until: null, attempts: Math.max(0, item.attempts - 1) }).eq("id", item.id);

    // No sender configured yet: hold the email (not a failed attempt) until one is set.
    if (!settings.outreach.fromEmail) {
      await db().from("le_outreach").update({ scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString(), locked_until: null, attempts: Math.max(0, item.attempts - 1), error: NO_SENDER }).eq("id", item.id);
      return;
    }
    // Respect the daily limit even if the schedule was made before the limit changed.
    if ((await sentLast24h()) >= settings.outreach.dailyLimit) {
      const { data: oldest } = await db().from("le_outreach").select("sent_at").eq("channel", "email").gte("sent_at", new Date(Date.now() - DAY_MS).toISOString()).order("sent_at").limit(1);
      await defer(oldest?.[0] ? Date.parse(oldest[0].sent_at) + DAY_MS + 60_000 : Date.now() + 3600_000);
      return;
    }
    // Keep the gap between emails even when several are overdue (e.g. the worker was down),
    // so a backlog still trickles out instead of going all at once.
    const { data: last } = await db().from("le_outreach").select("sent_at").eq("channel", "email").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1);
    const gapMs = settings.outreach.gapSeconds * 1000;
    const lastAt = last?.[0]?.sent_at ? Date.parse(last[0].sent_at) : 0;
    if (Date.now() - lastAt < gapMs) {
      await defer(lastAt + gapMs);
      return;
    }
    if (!item.recipient || !item.subject || !item.body) {
      await setStatus(item, "failed", { error: "Missing recipient, subject or body" });
      return;
    }
    await db().from("le_outreach").update({ status: "sending" }).eq("id", item.id);
    const startedAt = performance.now();
    try {
      const id = await sendEmail({ to: item.recipient, subject: item.subject, body: item.body, attachments, sender: settings.outreach, idempotencyKey: `le-${item.id}` });
      await setStatus(item, "sent", { provider_id: id, sent_at: new Date().toISOString(), error: null }, `To ${item.recipient}`);
      await logJob("send email", "ok", startedAt, `${item.subject} → ${item.recipient}`);
    } catch (e) {
      const err = e as SendError;
      await logJob("send email", "error", startedAt, err.message, { to: item.recipient });
      if (err.permanent || item.attempts >= 3) await setStatus(item, "failed", { error: err.message.slice(0, 300) });
      else await db().from("le_outreach").update({ status: "scheduled", scheduled_at: new Date(Date.now() + (err.retryAfterSec || 120) * 1000).toISOString(), locked_until: null, error: err.message.slice(0, 300) }).eq("id", item.id);
    }
    if (item.campaign_id) await refreshCampaign(item.campaign_id);
  }
}

/** Moves a campaign along: generating (or paused) → review → sending → done. */
export async function refreshCampaign(id: string) {
  const { data } = await db().from("le_outreach").select("status").eq("campaign_id", id);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const pending = (counts.scheduled ?? 0) + (counts.sending ?? 0);
  const status = counts.generating ? "generating" : pending ? "sending" : counts.paused ? "paused" : counts.draft || counts.todo ? "review" : "done";
  await db().from("le_campaigns").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Is there outreach work the worker should stay alive for (drafts to write or sends due soon)? */
export async function outreachPending(withinMs = 10 * 60_000): Promise<boolean> {
  const [gen, due] = await Promise.all([
    db().from("le_outreach").select("id", { count: "exact", head: true }).eq("status", "generating"),
    db().from("le_outreach").select("id", { count: "exact", head: true }).eq("status", "scheduled").lte("scheduled_at", new Date(Date.now() + withinMs).toISOString()),
  ]);
  return (gen.count ?? 0) + (due.count ?? 0) > 0;
}

/** Next scheduled send time, so the worker can wait for it. */
export async function nextSendAt(): Promise<number | null> {
  const { data } = await db().from("le_outreach").select("scheduled_at").eq("status", "scheduled").order("scheduled_at").limit(1);
  return data?.[0]?.scheduled_at ? Date.parse(data[0].scheduled_at) : null;
}

/**
 * When the next outreach job becomes claimable: the next scheduled send, or a draft that is
 * waiting out a rate-limit lock. Lets the worker sleep until then instead of exiting and restarting.
 */
export async function nextOutreachAt(): Promise<number | null> {
  const [send, lockedDraft] = await Promise.all([
    nextSendAt(),
    db().from("le_outreach").select("locked_until").eq("status", "generating").not("locked_until", "is", null).order("locked_until").limit(1),
  ]);
  const draftAt = lockedDraft.data?.[0]?.locked_until ? Date.parse(lockedDraft.data[0].locked_until) : null;
  const times = [send, draftAt].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/** Pulls delivery events from Resend for recently sent emails. */
export function syncDelivery(limit = 20) {
  return withAgent({ agent: "delivery" }, () => syncDeliveryRaw(limit));
}

async function syncDeliveryRaw(limit: number) {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await db()
    .from("le_outreach")
    .select("id, lead_id, target, history, provider_id, status, last_event")
    .eq("channel", "email")
    .in("status", ["sent", "delivered"])
    .not("provider_id", "is", null)
    .gte("sent_at", since)
    .or(`synced_at.is.null,synced_at.lt.${stale}`)
    .limit(limit);
  let changed = 0;
  for (const row of (data ?? []) as OutreachItem[]) {
    const ev = await emailEvent(row.provider_id!).catch(() => null);
    const patch = { synced_at: new Date().toISOString(), last_event: ev ?? row.last_event };
    if ((ev === "bounced" || ev === "complained") && row.status !== "bounced") {
      await setStatus(row, "bounced", patch, ev === "complained" ? "Marked as spam" : "Bounced");
      // A bounced founder address is dead: stop future campaigns from picking it.
      if (ev === "bounced" && row.target === "founder_email") await db().from("le_leads").update({ founder_email_status: "invalid" }).eq("id", row.lead_id);
      changed++;
    } else if (ev === "delivered" && row.status === "sent") {
      await setStatus(row, "delivered", patch);
      changed++;
    } else {
      await db().from("le_outreach").update(patch).eq("id", row.id);
    }
  }
  return changed;
}
