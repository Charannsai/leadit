import { db, must } from "@/lib/db";
import type { SheetMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = must(await db().from("le_uploads").select("*").order("created_at", { ascending: false }));
    return Response.json(rows);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { filename, sheets } = (await req.json()) as { filename: string; sheets: SheetMeta[] };
  if (!filename || !Array.isArray(sheets) || !sheets.length) return Response.json({ error: "filename and sheets required" }, { status: 400 });
  const total = sheets.reduce((n, s) => n + (s.rows || 0), 0);
  const row = must(await db().from("le_uploads").insert({ filename, sheets, total_rows: total }).select("id").single());
  return Response.json(row);
}
