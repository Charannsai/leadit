import { db, must } from "@/lib/db";
import { ENRICHED_COLUMNS, paramsToFilters } from "@/lib/exportColumns";
import { applyFilters } from "@/lib/leadQuery";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 1000;

/**
 * Export rows matching the filters, one page at a time. The browser fetches every page,
 * keeps only the columns you picked and builds the CSV/XLSX itself (keeps responses
 * under Vercel's body size limit). ?count=1 returns just the number of matching rows.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const upload = p.get("upload");
  if (!upload) return Response.json({ error: "upload required" }, { status: 400 });
  const filters = paramsToFilters(p);

  if (p.get("count") === "1") {
    const res = await applyFilters(db().from("le_leads").select("id", { count: "exact", head: true }).eq("upload_id", upload), filters);
    if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
    return Response.json({ count: res.count ?? 0 });
  }

  const page = Math.max(0, Number(p.get("page") ?? 0));
  const query = applyFilters(db().from("le_leads").select("*").eq("upload_id", upload), filters);
  const leads = must(await query.order("sheet").order("row_index").range(page * PAGE, page * PAGE + PAGE - 1)) as Lead[];

  const rows = leads.map((l) => ({
    sheet: l.sheet,
    raw: l.raw,
    enriched: Object.fromEntries(ENRICHED_COLUMNS.map((c) => [c.key, c.get(l)])),
  }));

  return Response.json({ rows, more: leads.length === PAGE });
}
