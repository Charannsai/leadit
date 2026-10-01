import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Agent log entries, newest first. Filters: agent, provider, status (ok | error | rate_limited |
 * skipped | problems), kind (call | job), q (company/message contains). Paging: before=<id>.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const limit = Math.min(200, Number(p.get("limit") ?? 100));
  let q = db().from("le_agent_logs").select("*").order("id", { ascending: false }).limit(limit);
  for (const k of ["agent", "provider", "kind"] as const) {
    const v = p.get(k);
    if (v) q = q.eq(k, v);
  }
  const status = p.get("status");
  if (status === "problems") q = q.neq("status", "ok");
  else if (status) q = q.eq("status", status);
  const before = Number(p.get("before"));
  if (before) q = q.lt("id", before);
  const search = p.get("q")?.trim().replace(/[%,()]/g, " ");
  if (search) q = q.or(`label.ilike.%${search}%,message.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data ?? [] });
}
