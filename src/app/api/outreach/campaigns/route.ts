import { db, must } from "@/lib/db";
import { kickWorker } from "@/lib/kick";
import { audienceQuery, type Audience } from "@/lib/outreach/audience";
import { recipientFor } from "@/lib/outreach/generate";
import { channelOf, type Attachment, type CampaignTarget } from "@/lib/outreach/types";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PER_CAMPAIGN = 2000;

export async function GET() {
  const [campaigns, counts] = await Promise.all([
    db().from("le_campaigns").select("*").order("created_at", { ascending: false }).limit(100),
    db().rpc("le_campaign_counts"),
  ]);
  const byCampaign: Record<string, Record<string, number>> = {};
  for (const r of (counts.data ?? []) as { campaign_id: string; status: string; n: number }[]) {
    (byCampaign[r.campaign_id] ??= {})[r.status] = Number(r.n);
  }
  return Response.json((must(campaigns) ?? []).map((c) => ({ ...c, counts: byCampaign[c.id] ?? {} })));
}

/** Creates a campaign and one outreach row per lead; the worker then writes the drafts. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    name: string;
    target: CampaignTarget;
    brief: string;
    tone?: string;
    cta?: string;
    attachments?: Attachment[];
    audience: Omit<Audience, "target">;
  };
  if (!body.name?.trim() || !body.brief?.trim() || !body.target || !body.audience?.uploadId)
    return Response.json({ error: "name, brief, target and audience are required" }, { status: 400 });

  const audience: Audience = { ...body.audience, target: body.target };
  const leads: Lead[] = [];
  for (let page = 0; leads.length < MAX_PER_CAMPAIGN; page++) {
    const { data, error } = await audienceQuery(audience, "*").order("sheet").order("row_index").range(page * 500, page * 500 + 499);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    leads.push(...(data as Lead[]));
    if ((data as Lead[]).length < 500) break;
  }
  if (!leads.length) return Response.json({ error: "No leads match. Loosen the filters or untick 'skip already contacted'." }, { status: 400 });

  const campaign = must(
    await db()
      .from("le_campaigns")
      .insert({
        name: body.name.trim(),
        channel: channelOf(body.target),
        target: body.target,
        brief: body.brief.trim(),
        tone: body.tone || null,
        cta: body.cta?.trim() || null,
        attachments: channelOf(body.target) === "email" ? body.attachments ?? [] : [],
        status: "generating",
      })
      .select("*")
      .single(),
  );

  const rows = leads
    .slice(0, MAX_PER_CAMPAIGN)
    .map((l) => {
      const r = recipientFor(l, body.target);
      if (!r) return null;
      return {
        campaign_id: campaign.id,
        lead_id: l.id,
        upload_id: l.upload_id,
        channel: channelOf(r.target),
        target: r.target,
        recipient_name: r.name,
        recipient: r.address,
        status: "generating",
        history: [{ at: new Date().toISOString(), status: "generating" }],
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  for (let i = 0; i < rows.length; i += 500) must(await db().from("le_outreach").insert(rows.slice(i, i + 500)));
  await kickWorker(new URL(req.url).origin);
  return Response.json({ id: campaign.id, created: rows.length, capped: leads.length >= MAX_PER_CAMPAIGN });
}
