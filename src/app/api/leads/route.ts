import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIST_COLUMNS =
  "id, sheet, row_index, raw, company_name, domain_input, location, status, stage, paused_reason, attempts, domain, domain_source, company_linkedin, founder_name, founder_title, founder_linkedin, founder_email, founder_email_status, generic_emails, phone, outcome, confidence, error, enriched_at, updated_at, outreach";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const upload = p.get("upload");
  if (!upload) return Response.json({ error: "upload required" }, { status: 400 });
  const page = Math.max(0, Number(p.get("page") ?? 0));
  const size = Math.min(500, Math.max(10, Number(p.get("size") ?? 100)));

  let q = db().from("le_leads").select(LIST_COLUMNS, { count: "exact" }).eq("upload_id", upload);
  const sheet = p.get("sheet");
  if (sheet) q = q.eq("sheet", sheet);
  const status = p.get("status");
  if (status) q = q.in("status", status.split(","));
  const outcome = p.get("outcome");
  if (outcome === "email") q = q.not("founder_email", "is", null);
  else if (outcome) q = q.eq("outcome", outcome);
  // Outreach tracking: oc = channel key (founder_email, ...), os = statuses, "none" = not started.
  const oc = p.get("oc");
  const os = p.get("os")?.split(",").filter(Boolean);
  if (oc && /^(founder|company)_(email|linkedin)$/.test(oc) && os?.length) {
    const parts = os.filter((x) => x !== "none").map((x) => x.replace(/[^a-z_]/g, ""));
    const ors = [];
    if (parts.length) ors.push(`outreach->>${oc}.in.(${parts.join(",")})`);
    if (os.includes("none")) ors.push(`outreach->>${oc}.is.null`);
    q = q.or(ors.join(","));
  }
  if (p.get("touched") === "1") q = q.neq("outreach", "{}");
  const search = p.get("q")?.trim();
  if (search) {
    const s = search.replace(/[%,()]/g, " ");
    q = q.or(`company_name.ilike.%${s}%,domain.ilike.%${s}%,founder_name.ilike.%${s}%`);
  }

  const res = await q.order("sheet").order("row_index").range(page * size, page * size + size - 1);
  const rows = must(res);
  return Response.json({ rows, total: res.count ?? 0 });
}
