import "server-only";
import { llmJson } from "../llm";

/** The drafting agent writes with the LLM chosen in Settings → Agents (Gemini by default). */
function draftJson<T>(system: string, user: string): Promise<T> {
  return llmJson<T>("drafting", system, user);
}
import type { OutreachSettings } from "../settings";
import type { Lead } from "../types";
import type { Target } from "./types";

export interface Brief {
  brief: string;
  tone?: string | null;
  cta?: string | null;
  attachmentNames?: string[];
}

export interface Draft {
  subject: string | null;
  body: string;
  note: string | null;
}

/** Everything we know about the company and the person, for the model. */
function context(lead: Lead) {
  const p = lead.profile ?? {};
  const c = p.company ?? {};
  const f = p.founders?.[0];
  const extra = Object.fromEntries(Object.entries(lead.raw ?? {}).slice(0, 10).map(([k, v]) => [k, String(v).slice(0, 100)]));
  return {
    company: lead.company_name ?? c.name,
    website: lead.domain,
    description: c.description,
    industry: c.industry,
    employees: c.employees,
    founded: c.founded,
    location: c.location ?? lead.location,
    funding: c.funding,
    keywords: c.keywords?.slice(0, 8),
    founder: f ? { name: f.name, title: f.title, background: f.summary, location: f.location } : null,
    other_info_from_lead_list: extra,
  };
}

/** Writes one personalised draft for a lead. Throws on model errors so the worker can retry. */
export async function writeDraft(lead: Lead, target: Target, recipientName: string | null, brief: Brief, sender: OutreachSettings): Promise<Draft> {
  const ctx = context(lead);
  const firstName = recipientName?.split(/\s+/)[0] ?? null;
  const toPerson = target === "founder_email" || target === "founder_linkedin";

  const base = [
    sender.fromName
      ? `You write outreach for ${sender.fromName}${sender.senderTitle || sender.company ? ` (${[sender.senderTitle, sender.company].filter(Boolean).join(" at ")})` : ""}.`
      : "You write outreach on behalf of the sender.",
    "Write like a real person: specific, short, no hype, no buzzwords, no emojis, no placeholders like [Name].",
    "Use one concrete detail about the recipient's company from the context so it's clearly not a template. Never invent facts that aren't in the context.",
    brief.tone ? `Tone: ${brief.tone}.` : "",
  ].join(" ");

  const job = {
    outreach_goal: brief.brief,
    call_to_action: brief.cta || "a short reply or a quick call",
    attachments_included: brief.attachmentNames?.length ? brief.attachmentNames : undefined,
    recipient: toPerson ? { first_name: firstName, full_name: recipientName, role: ctx.founder?.title } : { team_of: ctx.company },
    context: ctx,
  };

  if (target === "founder_email" || target === "company_email") {
    const res = await draftJson<{ subject?: string; body?: string }>(
      base +
        " Write a cold email. Subject: 2-7 words, plain, no clickbait, no ALL CAPS. Body: 60-130 words in short paragraphs," +
        (toPerson ? ` starting "Hi ${firstName ?? "there"},"` : ` starting "Hi ${ctx.company ?? "there"} team,"`) +
        ". End with the call to action as a simple question. Don't add a signature or sign-off name, it's appended automatically." +
        (brief.attachmentNames?.length ? " Mention the attachment briefly and naturally." : ""),
      JSON.stringify({ ...job, return: { subject: "string", body: "plain text with \\n\\n between paragraphs" } }),
    );
    if (!res.body) throw new Error("Model returned no email body");
    return { subject: (res.subject ?? "").trim() || `Quick question for ${ctx.company}`, body: res.body.trim(), note: null };
  }

  if (target === "founder_linkedin") {
    const res = await draftJson<{ note?: string; message?: string }>(
      base +
        " Write two LinkedIn texts for a founder: (1) a connection request note, max 280 characters, warm and specific, no pitch; " +
        "(2) a follow-up message to send after they accept, 50-110 words, that brings in the goal and ends with the call to action.",
      JSON.stringify({ ...job, return: { note: "max 280 characters", message: "plain text" } }),
    );
    if (!res.message) throw new Error("Model returned no LinkedIn message");
    return { subject: null, note: (res.note ?? "").trim().slice(0, 300) || null, body: res.message.trim() };
  }

  const res = await draftJson<{ message?: string }>(
    base + " Write a message to a company's LinkedIn page inbox, 40-90 words, addressed to the team, ending with the call to action.",
    JSON.stringify({ ...job, return: { message: "plain text" } }),
  );
  if (!res.message) throw new Error("Model returned no message");
  return { subject: null, note: null, body: res.message.trim() };
}

/** Who receives the message for a target, or null if the lead has nothing to contact there. */
export function recipientFor(lead: Lead, target: Target | "best_email"): { target: Target; name: string | null; address: string } | null {
  const founder = lead.profile?.founders?.[0];
  if (target === "best_email") {
    return recipientFor(lead, "founder_email") ?? recipientFor(lead, "company_email");
  }
  if (target === "founder_email") {
    if (!lead.founder_email || lead.founder_email_status === "invalid") return null;
    return { target, name: lead.founder_name ?? founder?.name ?? null, address: lead.founder_email };
  }
  if (target === "company_email") {
    const list = lead.profile?.generic_emails ?? [];
    const pick = list.find((g) => g.label === "general" && g.status !== "invalid") ?? list.find((g) => g.status !== "invalid");
    const email = pick?.email ?? lead.generic_emails?.[0];
    return email ? { target, name: null, address: email } : null;
  }
  if (target === "founder_linkedin") {
    const url = lead.founder_linkedin ?? founder?.linkedin;
    return url ? { target, name: lead.founder_name ?? founder?.name ?? null, address: url } : null;
  }
  const url = lead.company_linkedin ?? lead.profile?.company?.linkedin;
  return url ? { target, name: null, address: url } : null;
}
