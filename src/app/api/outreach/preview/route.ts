import { withAgent } from "@/lib/agentLog";
import { db } from "@/lib/db";
import { audienceQuery, type Audience } from "@/lib/outreach/audience";
import { recipientFor, writeDraft } from "@/lib/outreach/generate";
import type { CampaignTarget } from "@/lib/outreach/types";
import { getSettings } from "@/lib/settings";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Writes one sample draft (not saved) so the brief can be checked before a whole campaign is generated. */
export async function POST(req: Request) {
  const body = (await req.json()) as { leadId?: string; audience?: Omit<Audience, "target">; target: CampaignTarget; brief: string; tone?: string; cta?: string; attachmentNames?: string[]; skip?: number };
  let lead: Lead | null = null;
  if (body.leadId) {
    lead = (await db().from("le_leads").select("*").eq("id", body.leadId).maybeSingle()).data as Lead | null;
  } else if (body.audience) {
    const { data } = await audienceQuery({ ...body.audience, target: body.target }, "*").order("confidence", { ascending: false, nullsFirst: false }).range(body.skip ?? 0, body.skip ?? 0);
    lead = (data?.[0] as Lead) ?? null;
  }
  if (!lead) return Response.json({ error: "No lead to preview with" }, { status: 400 });
  const r = recipientFor(lead, body.target);
  if (!r) return Response.json({ error: "That lead has nothing to contact on this channel" }, { status: 400 });

  try {
    const { outreach } = await getSettings();
    const draft = await withAgent({ agent: "drafting", leadId: lead.id, label: `${lead.company_name} (sample)` }, () =>
      writeDraft(lead!, r.target, r.name, { brief: body.brief, tone: body.tone, cta: body.cta, attachmentNames: body.attachmentNames }, outreach),
    );
    return Response.json({ lead: { id: lead.id, company_name: lead.company_name, domain: lead.domain }, recipient: r, draft, signature: outreach.signature, optOutLine: outreach.optOutLine });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
