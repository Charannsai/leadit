import { signedUpload } from "@/lib/outreach/resend";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

/** Gives the browser a one-time URL to upload an attachment straight to Supabase Storage. */
export async function POST(req: Request) {
  const { name, size } = (await req.json()) as { name: string; size: number };
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  if (size > MAX_BYTES) return Response.json({ error: "Attachments can be up to 10 MB each" }, { status: 400 });
  try {
    return Response.json(await signedUpload(name));
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: /bucket/i.test(msg) ? "Run supabase/003_outreach.sql first (it creates the attachments bucket)." : msg }, { status: 500 });
  }
}
