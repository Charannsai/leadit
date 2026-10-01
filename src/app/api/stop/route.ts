import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Takes queued leads out of the queue. Leads already being processed finish normally. */
export async function POST(req: Request) {
  const { uploadId, sheet } = (await req.json()) as { uploadId: string; sheet?: string | null };
  let q = db().from("le_leads").update({ status: "new", queued_at: null }).eq("upload_id", uploadId).eq("status", "queued");
  if (sheet) q = q.eq("sheet", sheet);
  const rows = must(await q.select("id"));
  return Response.json({ stopped: rows?.length ?? 0 });
}
