import { db, must } from "@/lib/db";
import { kickWorker } from "@/lib/kick";

export const dynamic = "force-dynamic";

/** Queues leads and starts the worker. scope: new | failed | paused | all. ids queues just those rows. */
export async function POST(req: Request) {
  const { uploadId, sheet, scope = "new", ids } = (await req.json()) as {
    uploadId: string;
    sheet?: string | null;
    scope?: "new" | "failed" | "paused" | "all";
    ids?: string[];
  };
  if (!uploadId) return Response.json({ error: "uploadId required" }, { status: 400 });
  const queued = must(await db().rpc("le_queue_leads", {
    p_upload: uploadId,
    p_sheet: sheet || null,
    p_scope: scope,
    p_ids: ids?.length ? ids : null,
  })) as number;
  if (queued > 0) await kickWorker(new URL(req.url).origin);
  return Response.json({ queued });
}
