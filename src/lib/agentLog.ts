import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { BudgetError, RateLimitError } from "./budget";
import { db } from "./db";

// Every external API call and every finished job is written to le_agent_logs, tagged with
// the agent doing the work. Settings → Agents reads it back.

export type AgentId = "enrichment" | "drafting" | "sending" | "delivery";

interface Ctx {
  agent: AgentId;
  leadId?: string | null;
  outreachId?: string | null;
  campaignId?: string | null;
  /** Human label of what's being worked on, e.g. the company name. */
  label?: string | null;
}

const als = new AsyncLocalStorage<Ctx>();

/** Runs fn with every API call inside it attributed to this agent and target. */
export function withAgent<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export interface CallMeta {
  tokensIn?: number;
  tokensOut?: number;
  message?: string;
  detail?: Record<string, unknown>;
}

type Status = "ok" | "error" | "rate_limited" | "skipped";

async function write(row: { kind: "call" | "job"; provider: string; action: string; status: Status; latency: number } & CallMeta) {
  const ctx = als.getStore();
  try {
    await db().from("le_agent_logs").insert({
      agent: ctx?.agent ?? "enrichment",
      kind: row.kind,
      provider: row.provider,
      action: row.action,
      status: row.status,
      latency_ms: Math.round(row.latency),
      tokens_in: row.tokensIn ?? null,
      tokens_out: row.tokensOut ?? null,
      lead_id: ctx?.leadId ?? null,
      outreach_id: ctx?.outreachId ?? null,
      campaign_id: ctx?.campaignId ?? null,
      label: ctx?.label ?? null,
      message: row.message?.slice(0, 500) ?? null,
      detail: row.detail ?? null,
    });
  } catch {
    // Logging must never break the actual work (e.g. table not created yet).
  }
}

function errorStatus(e: unknown): Status {
  if (e instanceof BudgetError) return "skipped";
  if (e instanceof RateLimitError) return "rate_limited";
  return "error";
}

function errorDetail(e: unknown): Record<string, unknown> | undefined {
  const body = (e as { body?: unknown }).body;
  if (body === undefined) return undefined;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { response: text.slice(0, 1500) };
}

/** Times one external API call and logs it, success or failure. Rethrows errors unchanged. */
export async function track<T>(provider: string, action: string, fn: () => Promise<T>, meta?: (r: T) => CallMeta): Promise<T> {
  const start = performance.now();
  try {
    const r = await fn();
    await write({ kind: "call", provider, action, status: "ok", latency: performance.now() - start, ...(meta?.(r) ?? {}) });
    return r;
  } catch (e) {
    await write({ kind: "call", provider, action, status: errorStatus(e), latency: performance.now() - start, message: (e as Error).message, detail: errorDetail(e) });
    throw e;
  }
}

/** Logs a finished unit of work (one lead enriched, one draft written, one email sent). */
export async function logJob(action: string, status: Status, startedAt: number, message?: string, detail?: Record<string, unknown>) {
  await write({ kind: "job", provider: "job", action, status, latency: performance.now() - startedAt, message, detail });
}

export { errorStatus };
