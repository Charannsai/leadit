import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

/** LinkedIn tasks across all campaigns, oldest first. ?status=todo (default) | invited | connected | messaged | followed */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const status = p.get("status") || "todo";
  const target = p.get("target");
  let q = db()
    .from("le_outreach")
    .select("*, lead:le_leads(company_name, domain, founder_title, location), campaign:le_campaigns(name)", { count: "exact" })
    .eq("channel", "linkedin")
    .eq("status", status);
  if (target) q = q.eq("target", target);
  const res = await q.order("updated_at", { ascending: true }).limit(200);
  return Response.json({ items: must(res), total: res.count ?? 0 });
}
