import { db, must } from "@/lib/db";
import { kickWorker } from "@/lib/kick";
import { outreachPending } from "@/lib/outreach/engine";
import { workerAlive } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Everything the dashboard polls: counts per status, leads in progress, recent activity,
 * credit usage and whether the worker is running. Also restarts the worker if it died with work queued.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const upload = p.get("upload");
  const sheet = p.get("sheet") || null;

  const found = (col: string) => {
    if (!upload) return Promise.resolve({ count: 0 });
    let q = db().from("le_leads").select("id", { count: "exact", head: true }).eq("upload_id", upload).not(col, "is", null);
    if (sheet) q = q.eq("sheet", sheet);
    return q;
  };

  const [counts, alive, events, active, queuedAll, withFounder, withEmail] = await Promise.all([
    upload ? db().rpc("le_lead_counts", { p_upload: upload, p_sheet: sheet }) : Promise.resolve({ data: [], error: null }),
    workerAlive(),
    upload
      ? db().from("le_lead_events").select("id, lead_id, at, level, message").eq("upload_id", upload).order("at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [], error: null }),
    upload
      ? db().from("le_leads").select("id, company_name, domain, stage, row_index").eq("upload_id", upload).eq("status", "processing").limit(10)
      : Promise.resolve({ data: [], error: null }),
    db().from("le_leads").select("id", { count: "exact", head: true }).eq("status", "queued"),
    found("founder_name"),
    found("founder_email"),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of (must(counts) ?? []) as { status: string; n: number }[]) byStatus[r.status] = Number(r.n);

  if (!alive && ((queuedAll.count ?? 0) > 0 || (await outreachPending().catch(() => false)))) await kickWorker(new URL(req.url).origin);

  return Response.json({
    counts: byStatus,
    found: { founders: withFounder.count ?? 0, emails: withEmail.count ?? 0 },
    worker: { alive, queuedTotal: queuedAll.count ?? 0 },
    events: must(events),
    active: must(active),
  });
}
