import { db } from "@/lib/db";
import { sentLast24h } from "@/lib/outreach/engine";
import { keyStatus } from "@/lib/keys";
import { getSettings } from "@/lib/settings";
import { workerAlive } from "@/lib/worker";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, number> = { "1h": 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000 };

const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

/** What each agent is doing right now, its queue, and per-API totals for the chosen window. */
export async function GET(req: Request) {
  const win = new URL(req.url).searchParams.get("window") ?? "24h";
  const since = new Date(Date.now() - (WINDOWS[win] ?? WINDOWS["24h"])).toISOString();
  const now = new Date().toISOString();
  const head = { count: "exact" as const, head: true };

  const [settings, alive, breakdown, enriching, drafting, sending, queuedLeads, toDraft, pausedDrafts, scheduled, nextSend, sent24h, awaitingDelivery] = await Promise.all([
    getSettings(),
    workerAlive(),
    db().rpc("le_agent_breakdown", { p_since: since }),
    db().from("le_leads").select("id, company_name, domain, stage, updated_at").eq("status", "processing").order("updated_at").limit(10),
    db().from("le_outreach").select("id, lead_id, recipient_name, recipient, target, updated_at, lead:le_leads(company_name)").eq("status", "generating").gt("locked_until", now).limit(10),
    db().from("le_outreach").select("id, lead_id, recipient_name, recipient, target, updated_at, lead:le_leads(company_name)").eq("status", "sending").limit(10),
    count(db().from("le_leads").select("id", head).eq("status", "queued")),
    count(db().from("le_outreach").select("id", head).eq("status", "generating")),
    count(db().from("le_outreach").select("id", head).eq("status", "paused")),
    count(db().from("le_outreach").select("id", head).eq("status", "scheduled")),
    db().from("le_outreach").select("scheduled_at").eq("status", "scheduled").order("scheduled_at").limit(1),
    sentLast24h(),
    count(db().from("le_outreach").select("id", head).eq("status", "sent").not("provider_id", "is", null)),
  ]);

  if (breakdown.error) {
    const missing = /le_agent|schema cache|does not exist/i.test(breakdown.error.message);
    return Response.json({ error: missing ? "Run supabase/004_agent_logs.sql in Supabase to turn on agent logs." : breakdown.error.message }, { status: 500 });
  }

  type Row = { agent: string; kind: string; provider: string; action: string; calls: number; errors: number; rate_limited: number; skipped: number; avg_ms: number; p95_ms: number; tokens_in: number; tokens_out: number; last_at: string };
  const rows = (breakdown.data ?? []) as Row[];
  const totals = (agent: string) => {
    const calls = rows.filter((r) => r.agent === agent && r.kind === "call");
    const jobs = rows.filter((r) => r.agent === agent && r.kind === "job");
    const sum = (list: Row[], k: keyof Row) => list.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    return {
      calls: sum(calls, "calls"),
      errors: sum(calls, "errors"),
      rateLimited: sum(calls, "rate_limited"),
      jobs: sum(jobs, "calls"),
      jobErrors: sum(jobs, "errors"),
      tokensIn: sum(calls, "tokens_in"),
      tokensOut: sum(calls, "tokens_out"),
      lastAt: [...calls, ...jobs].map((r) => r.last_at).sort().at(-1) ?? null,
    };
  };

  const label = (o: { lead?: unknown; recipient_name: string | null; recipient: string | null }) =>
    `${(o.lead as { company_name?: string } | null)?.company_name ?? "—"} · ${o.recipient_name ?? o.recipient ?? ""}`;

  // Key status per provider, so each agent can show which keys it depends on.
  const keys = new Map((await keyStatus()).map((k) => [k.id, { source: k.source, masked: k.masked }]));
  const keyOf = (id: string) => keys.get(id as never) ?? null;
  const tool = (name: string, use: string, keyId?: string) => ({ name, use, key: keyId ? { id: keyId, ...(keyOf(keyId) ?? { source: "missing", masked: null }) } : null });
  const llm = (agent: "enrichment" | "drafting") => {
    const { provider, model } = settings.agents[agent];
    const k = (id: string) => ({ id, ...(keyOf(id) ?? { source: "missing", masked: null }) });
    return { provider, model, key: k(provider), keys: { groq: k("groq"), gemini: k("gemini") } };
  };

  const agents = [
    {
      id: "enrichment",
      name: "Enrichment agent",
      role: "Turns a company name into a full profile: website, founder, LinkedIn pages and verified emails.",
      steps: [
        "Finds the company's website (sheet, Clearbit, web search)",
        "Pulls the company profile from Apollo",
        "Reads the website's about, team and contact pages",
        "Identifies founders from the website and LinkedIn search results",
        "Finds and verifies the founder's email, then company inboxes",
      ],
      llm: llm("enrichment"),
      tools: [
        tool("Firecrawl", "Web + LinkedIn search, JS page rendering", "firecrawl"),
        tool("Hunter", "Email finder, domain search, verification", "hunter"),
        tool("Apollo", "Company profile by domain", "apollo"),
        tool("Clearbit", "Company name → domain (free, no key)"),
        tool("Website crawl", "Reads company pages directly (free)"),
      ],
      now: (enriching.data ?? []).map((l) => ({ id: l.id, title: l.company_name ?? l.domain ?? "—", step: l.stage, since: l.updated_at })),
      queue: { label: "leads queued", n: queuedLeads, note: null as string | null },
      stats: totals("enrichment"),
    },
    {
      id: "drafting",
      name: "Drafting agent",
      role: "Writes a personalised email or LinkedIn message for every lead in a campaign, from your brief and what we know about the company.",
      steps: [
        "Reads the campaign brief, tone and call to action",
        "Reads the company's description, industry, location and founder details",
        "Writes a subject and body (email) or a connection note and message (LinkedIn)",
        "Saves it as a draft for you to review",
      ],
      llm: llm("drafting"),
      tools: [] as ReturnType<typeof tool>[],
      now: (drafting.data ?? []).map((o) => ({ id: o.id, title: label(o), step: "Writing draft", since: o.updated_at })),
      queue: { label: "drafts to write", n: toDraft, note: pausedDrafts ? `${pausedDrafts} paused` : null },
      stats: totals("drafting"),
    },
    {
      id: "sending",
      name: "Sending agent",
      role: `Sends approved emails from ${settings.outreach.fromEmail}, one every ${settings.outreach.gapSeconds}s and at most ${settings.outreach.dailyLimit} in any 24 hours.`,
      steps: [
        "Picks the next email whose send time has come",
        "Checks the daily limit and the gap since the last email",
        "Adds your signature, opt-out line and attachments",
        "Sends it through Resend and marks it Sent",
      ],
      llm: null,
      tools: [tool("Resend", "Sends email from your verified domain", "resend")],
      now: (sending.data ?? []).map((o) => ({ id: o.id, title: label(o), step: "Sending", since: o.updated_at })),
      queue: { label: "emails queued", n: scheduled, note: `${sent24h}/${settings.outreach.dailyLimit} sent in 24h` },
      nextAt: nextSend.data?.[0]?.scheduled_at ?? null,
      stats: totals("sending"),
    },
    {
      id: "delivery",
      name: "Delivery tracker",
      role: "Checks every sent email with Resend and marks it Delivered or Bounced. A bounced founder email is marked invalid so it's never used again.",
      steps: ["Every few minutes while the Outreach page is open", "Asks Resend for each recent email's latest event", "Updates the email and the lead's status"],
      llm: null,
      tools: [tool("Resend", "Delivery events for sent emails", "resend")],
      now: [],
      queue: { label: "sent, waiting for delivery status", n: awaitingDelivery, note: null },
      stats: totals("delivery"),
    },
  ];

  return Response.json({ worker: { alive }, window: win, agents, breakdown: rows });
}
