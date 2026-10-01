import { db, must } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";
import type { ColumnMapping } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Receives one chunk of parsed rows for a sheet (the browser parses the file and sends chunks). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sheet, mapping, rows } = (await req.json()) as {
    sheet: string;
    mapping: ColumnMapping;
    rows: { i: number; raw: Record<string, unknown> }[];
  };
  if (!sheet || !Array.isArray(rows)) return Response.json({ error: "sheet and rows required" }, { status: 400 });

  const pick = (raw: Record<string, unknown>, col?: string) => {
    const v = col ? raw[col] : undefined;
    return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim();
  };

  const records = rows.map(({ i, raw }) => {
    const website = pick(raw, mapping.website);
    return {
      upload_id: id,
      sheet,
      row_index: i,
      raw,
      company_name: pick(raw, mapping.company),
      domain_input: website,
      location: pick(raw, mapping.location),
      domain: normalizeDomain(website),
    };
  });

  must(await db().from("le_leads").insert(records));
  return Response.json({ inserted: records.length });
}
