import "server-only";
import { db } from "./db";
import { kickWorker } from "./kick";
import { outreachPending } from "./outreach/engine";
import { workerAlive } from "./worker";

let lastCheck = 0;

/**
 * Restarts the worker if it isn't running but work is waiting. Called from routes the
 * dashboard polls on every page, so a lost wake-up (timeout, dev recompile, crash) heals
 * within seconds. Throttled to one check per 15s per server instance.
 */
export async function ensureWorker(origin: string) {
  if (Date.now() - lastCheck < 15_000) return;
  lastCheck = Date.now();
  try {
    // An email stuck in "sending" (process died mid-send) goes back to the queue.
    // Resend's idempotency key makes a repeat of an email that did go out a no-op.
    await db()
      .from("le_outreach")
      .update({ status: "scheduled", locked_until: null })
      .eq("status", "sending")
      .lt("locked_until", new Date(Date.now() - 5 * 60_000).toISOString());

    if (await workerAlive()) return;
    const now = new Date().toISOString();
    const { count } = await db().from("le_leads").select("id", { count: "exact", head: true }).eq("status", "queued").or(`queued_at.is.null,queued_at.lte.${now}`);
    // Not awaited: the poll that noticed shouldn't wait for the worker route to answer.
    if ((count ?? 0) > 0 || (await outreachPending())) void kickWorker(origin);
  } catch (e) {
    console.warn("ensureWorker", (e as Error).message);
  }
}
