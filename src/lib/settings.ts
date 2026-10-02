import "server-only";
import { db, must } from "./db";

export type Provider = "apollo" | "hunter_search" | "hunter_verify" | "firecrawl" | "groq" | "gemini";

export interface Settings {
  /** Monthly credit limits the worker will not exceed. */
  limits: Record<Exclude<Provider, "groq" | "gemini">, number>;
  /** Leads processed in parallel by the worker. Keep low on free tiers. */
  concurrency: number;
  /** Verify founder emails that did not come from Hunter's finder. */
  verifyEmails: boolean;
  /** Try first@ / first.last@ guesses (each costs a verification). */
  guessEmails: boolean;
  outreach: OutreachSettings;
  /** Which LLM each AI agent thinks with. */
  agents: Record<LlmAgent, AgentLlm>;
}

export type LlmAgent = "enrichment" | "drafting";
export type LlmProvider = "groq" | "gemini";
export interface AgentLlm {
  provider: LlmProvider;
  model: string;
}

export interface OutreachSettings {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  senderTitle: string;
  company: string;
  /** Signature appended to every email (plain text). */
  signature: string;
  /** Emails sent per day at most (Resend free tier is 100). */
  dailyLimit: number;
  /** Seconds between two emails, so a batch trickles out instead of bursting. */
  gapSeconds: number;
  /** Last line of every email. Empty to leave it out. */
  optOutLine: string;
  /** LinkedIn invites the task queue suggests per day. */
  linkedinDailyLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  limits: { apollo: 100, hunter_search: 50, hunter_verify: 100, firecrawl: 1000 },
  concurrency: 3,
  verifyEmails: true,
  guessEmails: true,
  // No sender is built in: each install sets its own in Settings → Outreach
  // (saved in the database). Sending is blocked until fromEmail is set.
  outreach: {
    fromName: "",
    fromEmail: "",
    replyTo: "",
    senderTitle: "",
    company: "",
    signature: "",
    dailyLimit: 50,
    gapSeconds: 90,
    linkedinDailyLimit: 20,
    optOutLine: "If this isn't relevant, just reply \"no\" and I won't follow up.",
  },
  agents: {
    enrichment: { provider: "groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
    drafting: { provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-3.8-flash" },
  },
};

let cached: { at: number; value: Settings } | null = null;

export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const row = must(await db().from("le_settings").select("data").eq("id", 1).maybeSingle());
  const data = (row?.data ?? {}) as Partial<Settings>;
  const value: Settings = {
    ...DEFAULT_SETTINGS,
    ...data,
    limits: { ...DEFAULT_SETTINGS.limits, ...(data.limits ?? {}) },
    outreach: { ...DEFAULT_SETTINGS.outreach, ...(data.outreach ?? {}) },
    agents: { ...DEFAULT_SETTINGS.agents, ...(data.agents ?? {}) },
  };
  cached = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(true);
  const next: Settings = {
    ...current,
    ...patch,
    limits: { ...current.limits, ...(patch.limits ?? {}) },
    outreach: { ...current.outreach, ...(patch.outreach ?? {}) },
    agents: { ...current.agents, ...(patch.agents ?? {}) },
  };
  next.outreach.dailyLimit = Math.min(100, Math.max(1, Math.round(next.outreach.dailyLimit)));
  next.outreach.gapSeconds = Math.min(3600, Math.max(10, Math.round(next.outreach.gapSeconds)));
  next.concurrency = Math.min(10, Math.max(1, Math.round(next.concurrency)));
  must(await db().from("le_settings").upsert({ id: 1, data: next }));
  cached = { at: Date.now(), value: next };
  return next;
}
