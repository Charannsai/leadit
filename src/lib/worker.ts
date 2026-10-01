import "server-only";
import { logJob, withAgent } from "./agentLog";
import { RateLimitError } from "./budget";
import { db, must } from "./db";
import { nextOutreachAt, outreachPending, processOutreach } from "./outreach/engine";
import type { OutreachItem } from "./outreach/types";
import { enrichLead } from "./pipeline/enrich";
import { getSettings } from "./settings";
import type { Lead } from "./types";

const LOCK_TTL_SEC = 45;
const LEASE_SEC = 300;
/** Stop claiming new leads after this long so the function finishes inside Vercel's 300s limit. */
const CLAIM_WINDOW_MS = 190_000;

/**
 * One worker run: claims queued leads and processes them `concurrency` at a time until the queue
 * is empty or the claim window ends. Only one run holds the lock at a time.
 * Returns whether queued work remains, so the caller can chain another run.
 */
export async function runWorker(): Promise<{ started: boolean; processed: number; more: boolean }> {
  const runId = crypto.randomUUID();
  const acquire = async () => Boolean(must(await db().rpc("le_acquire_worker", { p_run_id: runId, p_ttl_seconds: LOCK_TTL_SEC })));
  if (!(await acquire())) return { started: false, processed: 0, more: false };

  const settings = await getSettings(true);
  const deadline = Date.now() + CLAIM_WINDOW_MS;
  let processed = 0;
  let lost = false;

  const beat = setInterval(async () => {
    try {
      if (!(await acquire())) lost = true;
    } catch {}
  }, 15_000);

  const slot = async () => {
    while (!lost && Date.now() < deadline) {
      const [lead] = must(await db().rpc("le_claim_leads", { p_limit: 1, p_lease_seconds: LEASE_SEC })) as Lead[];
      if (lead) {
        await processOne(lead);
        processed++;
        continue;
      }
      // No leads to enrich: write outreach drafts and send emails that are due.
      const [job] = (await db().rpc("le_claim_outreach", { p_limit: 1, p_lease_seconds: 120 })).data ?? [];
      if (job) {
        try {
          const o = job as OutreachItem;
          await withAgent(
            { agent: o.status === "scheduled" ? "sending" : "drafting", outreachId: o.id, campaignId: o.campaign_id, leadId: o.lead_id, label: o.recipient_name ?? o.recipient },
            () => processOutreach(o),
          );
        } catch (e) {
          console.error("outreach job failed", e);
        }
        processed++;
        continue;
      }
      // Nothing right now. If an email (or a rate-limited draft) is due before this run ends, wait for it.
      const next = await nextOutreachAt().catch(() => null);
      if (next && next < deadline) {
        await new Promise((r) => setTimeout(r, Math.min(Math.max(next - Date.now(), 1000), 15_000)));
        continue;
      }
      return;
    }
  };

  try {
    await Promise.all(Array.from({ length: settings.concurrency }, slot));
  } finally {
    clearInterval(beat);
    await db().rpc("le_release_worker", { p_run_id: runId });
  }

  const { count } = await db().from("le_leads").select("id", { count: "exact", head: true }).eq("status", "queued");
  const more = (count ?? 0) > 0 || (await outreachPending().catch(() => false));
  return { started: true, processed, more };
}

function processOne(lead: Lead) {
  return withAgent({ agent: "enrichment", leadId: lead.id, label: lead.company_name ?? lead.domain }, () => enrichOne(lead));
}

async function enrichOne(lead: Lead) {
  const startedAt = performance.now();
  try {
    await enrichLead(lead);
  } catch (e) {
    const err = e as Error;
    await logJob("enrich lead", e instanceof RateLimitError ? "rate_limited" : "error", startedAt, err.message);
    const event = (message: string, level: "warn" | "error") =>
      db().from("le_lead_events").insert({ lead_id: lead.id, upload_id: lead.upload_id, level, message: `${lead.company_name ?? `Row ${lead.row_index + 1}`} — ${message}` });

    if (e instanceof RateLimitError) {
      // Rate limits don't count as a failed attempt.
      await db().from("le_leads").update({
        status: "queued", stage: null, locked_until: null, attempts: Math.max(0, lead.attempts - 1),
        queued_at: new Date(Date.now() + e.retryAfterSec * 1000).toISOString(),
      }).eq("id", lead.id);
      await event(`${e.provider} rate limit, retrying in ${e.retryAfterSec}s`, "warn");
      return;
    }

    const giveUp = lead.attempts >= 3;
    await db().from("le_leads").update({
      status: giveUp ? "failed" : "queued",
      stage: null,
      locked_until: null,
      error: err.message.slice(0, 500),
      queued_at: new Date(Date.now() + 30_000).toISOString(),
    }).eq("id", lead.id);
    await event(giveUp ? `Failed: ${err.message.slice(0, 160)}` : `Error, will retry: ${err.message.slice(0, 120)}`, giveUp ? "error" : "warn");
  }
}

export async function workerAlive(): Promise<boolean> {
  const row = must(await db().from("le_worker_state").select("run_id, heartbeat_at").eq("id", 1).maybeSingle()) as { run_id: string | null; heartbeat_at: string | null } | null;
  return Boolean(row?.run_id && row.heartbeat_at && Date.now() - new Date(row.heartbeat_at).getTime() < LOCK_TTL_SEC * 1000);
}
