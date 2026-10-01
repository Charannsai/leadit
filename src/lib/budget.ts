import "server-only";
import { db, must } from "./db";
import { getSettings, type Provider } from "./settings";

/** Thrown when a provider's monthly budget is used up. The lead is paused, not failed. */
export class BudgetError extends Error {
  constructor(public provider: Provider) {
    super(`${provider} credits used up for this month`);
  }
}

/** Thrown on HTTP 429. The lead goes back in the queue after a delay. */
export class RateLimitError extends Error {
  constructor(public provider: string, public retryAfterSec = 60) {
    super(`${provider} rate limit`);
  }
}

export const period = () => new Date().toISOString().slice(0, 7);

type UsageRow = { provider: string; used: number; exhausted: boolean };

let usageCache: { at: number; rows: Map<string, UsageRow> } | null = null;

async function usage(): Promise<Map<string, UsageRow>> {
  if (usageCache && Date.now() - usageCache.at < 5_000) return usageCache.rows;
  const rows = must(await db().from("le_provider_usage").select("provider, used, exhausted").eq("period", period())) as UsageRow[];
  usageCache = { at: Date.now(), rows: new Map(rows.map((r) => [r.provider, { ...r, used: Number(r.used) }])) };
  return usageCache.rows;
}

/** Throws BudgetError if spending `amount` would go over the monthly limit. */
export async function ensureBudget(provider: Exclude<Provider, "groq" | "gemini">, amount = 1) {
  const [settings, rows] = await Promise.all([getSettings(), usage()]);
  const row = rows.get(provider);
  if (row?.exhausted || (row?.used ?? 0) + amount > settings.limits[provider]) throw new BudgetError(provider);
}

export async function recordUsage(provider: Provider, amount = 1) {
  const used = must(await db().rpc("le_add_usage", { p_provider: provider, p_period: period(), p_amount: amount })) as number;
  const rows = usageCache?.rows;
  if (rows) rows.set(provider, { provider, used: Number(used), exhausted: rows.get(provider)?.exhausted ?? false });
}

/** The provider told us we're out of credits: stop using it until next month. */
export async function markExhausted(provider: Provider) {
  must(await db().from("le_provider_usage").upsert({ provider, period: period(), exhausted: true }, { onConflict: "provider,period", ignoreDuplicates: false }));
  usageCache = null;
}

export interface UsageItem {
  provider: Provider;
  used: number;
  limit: number | null;
  exhausted: boolean;
}

export async function usageSummary(): Promise<UsageItem[]> {
  const [settings, rows] = await Promise.all([getSettings(), usage()]);
  const providers: Provider[] = ["firecrawl", "hunter_search", "hunter_verify", "apollo", "groq", "gemini"];
  return providers.map((p) => ({
    provider: p,
    used: rows.get(p)?.used ?? 0,
    limit: p === "groq" || p === "gemini" ? null : settings.limits[p],
    exhausted: rows.get(p)?.exhausted ?? false,
  }));
}
