import { db } from "@/lib/db";
import { kickWorker } from "@/lib/kick";
import { nextSendAt, outreachPending, sentLast24h, syncDelivery } from "@/lib/outreach/engine";
import { getSettings } from "@/lib/settings";
import { workerAlive } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let lastSync = 0;

/** Numbers for the Outreach overview. Also pulls delivery events from Resend every couple of minutes. */
export async function GET(req: Request) {
  if (Date.now() - lastSync > 120_000) {
    lastSync = Date.now();
    await syncDelivery().catch(() => 0);
  }

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [settings, sent24h, next, alive, rows, invitesToday, recent] = await Promise.all([
    getSettings(),
    sentLast24h(),
    nextSendAt(),
    workerAlive(),
    db().from("le_outreach").select("target, status").limit(50_000),
    db().from("le_outreach").select("id", { count: "exact", head: true }).eq("target", "founder_linkedin").in("status", ["invited", "connected", "messaged", "replied"]).gte("sent_at", dayAgo),
    db()
      .from("le_outreach")
      .select("id, lead_id, target, status, recipient, recipient_name, subject, updated_at, lead:le_leads(company_name)")
      .in("status", ["sent", "delivered", "bounced", "replied", "invited", "connected", "messaged", "followed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(15),
  ]);

  const byTarget: Record<string, Record<string, number>> = {};
  for (const r of rows.data ?? []) (byTarget[r.target] ??= {})[r.status] = (byTarget[r.target][r.status] ?? 0) + 1;

  if (!alive && (await outreachPending().catch(() => false))) await kickWorker(new URL(req.url).origin);

  return Response.json({
    email: { sent24h, dailyLimit: settings.outreach.dailyLimit, nextSendAt: next ? new Date(next).toISOString() : null, from: `${settings.outreach.fromName} <${settings.outreach.fromEmail}>` },
    linkedin: { invitesToday: invitesToday.count ?? 0, dailyLimit: settings.outreach.linkedinDailyLimit },
    byTarget,
    recent: recent.data ?? [],
    worker: { alive },
  });
}
