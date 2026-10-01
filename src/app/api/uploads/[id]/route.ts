import { db, must } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  must(await db().from("le_uploads").delete().eq("id", id));
  return Response.json({ ok: true });
}
