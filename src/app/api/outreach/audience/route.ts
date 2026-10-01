import { audienceQuery, type Audience } from "@/lib/outreach/audience";

export const dynamic = "force-dynamic";

/** How many leads a campaign would reach, plus a few to preview. */
export async function POST(req: Request) {
  const a = (await req.json()) as Audience;
  if (!a.uploadId || !a.target) return Response.json({ error: "uploadId and target required" }, { status: 400 });
  const [count, sample] = await Promise.all([
    audienceQuery(a, "id", { count: "exact", head: true }),
    audienceQuery(a, "id, company_name, domain, founder_name, founder_title, founder_email, founder_email_status, generic_emails, founder_linkedin, company_linkedin, outreach").order("confidence", { ascending: false, nullsFirst: false }).limit(8),
  ]);
  if (count.error) return Response.json({ error: count.error.message }, { status: 500 });
  return Response.json({ count: count.count ?? 0, sample: sample.data ?? [] });
}
