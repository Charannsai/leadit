import "server-only";
import { track } from "../agentLog";
import { ensureBudget, markExhausted, recordUsage, BudgetError, RateLimitError } from "../budget";
import { cached } from "../cache";
import { getKey } from "../keys";
import type { EmailStatus } from "../types";
import { fetchJson, HttpError } from "./http";

const BASE = "https://api.hunter.io/v2";

async function key() {
  const k = await getKey("hunter");
  if (!k) throw new Error("No Hunter API key (Settings → API keys)");
  return k;
}

type Kind = "hunter_search" | "hunter_verify";

function get<T>(kind: Kind, path: string, params: Record<string, string>): Promise<T> {
  return track("hunter", path.slice(1), () => getRaw<T>(kind, path, params));
}

async function getRaw<T>(kind: Kind, path: string, params: Record<string, string>): Promise<T> {
  await ensureBudget(kind);
  const qs = new URLSearchParams({ ...params, api_key: await key() });
  try {
    return await fetchJson<T>("hunter", `${BASE}${path}?${qs}`, { timeoutMs: 40_000 });
  } catch (e) {
    // Hunter reports "out of monthly credits" as 429 or 403 with an explanatory message;
    // a plain per-second rate limit stays a RateLimitError.
    const err = (e as { body?: { errors?: { id?: string; details?: string }[] } }).body?.errors?.[0];
    const text = `${err?.id ?? ""} ${err?.details ?? ""}`;
    if ((e instanceof RateLimitError || (e instanceof HttpError && e.status === 403)) && /month|plan|usage|upgrade|exceeded|quota/i.test(text)) {
      await markExhausted(kind);
      throw new BudgetError(kind);
    }
    throw e;
  }
}

export interface DomainSearch {
  pattern?: string;
  organization?: string;
  linkedin?: string;
  twitter?: string;
  emails: {
    value: string;
    type: "personal" | "generic";
    confidence: number;
    first_name?: string;
    last_name?: string;
    position?: string;
    seniority?: string;
    linkedin?: string;
    twitter?: string;
    verification?: { status?: string };
  }[];
}

/** All public emails Hunter knows for a domain, plus the email pattern. 1 search credit when results exist. */
export async function domainSearch(domain: string): Promise<DomainSearch> {
  return cached(`hunter:domain:${domain}`, 60, async () => {
    const res = await get<{ data: DomainSearch }>("hunter_search", "/domain-search", { domain, limit: "10" });
    if (res.data?.emails?.length || res.data?.pattern) await recordUsage("hunter_search");
    return { ...res.data, emails: res.data?.emails ?? [] };
  });
}

export interface FinderResult {
  email: string | null;
  score?: number;
  status?: EmailStatus;
  position?: string;
  linkedin?: string;
  twitter?: string;
}

/** Finds a person's email from name + domain. 1 search credit when an email is found. */
export async function emailFinder(domain: string, first: string, last: string): Promise<FinderResult> {
  return cached(`hunter:finder:${domain}:${first}:${last}`.toLowerCase(), 60, async () => {
    try {
      const res = await get<{ data: { email: string | null; score?: number; position?: string; linkedin_url?: string; twitter?: string; verification?: { status?: string } } }>(
        "hunter_search",
        "/email-finder",
        { domain, first_name: first, last_name: last },
      );
      const d = res.data;
      if (d?.email) await recordUsage("hunter_search");
      return {
        email: d?.email ?? null,
        score: d?.score,
        status: mapStatus(d?.verification?.status),
        position: d?.position,
        linkedin: d?.linkedin_url,
        twitter: d?.twitter,
      };
    } catch (e) {
      // Hunter answers 404/400 when it can't find anything; that's a normal "no result".
      if (e instanceof HttpError && (e.status === 404 || e.status === 400)) return { email: null };
      throw e;
    }
  });
}

/** Checks if an email can receive mail. 1 verification credit. */
export async function verifyEmail(email: string): Promise<EmailStatus> {
  return cached(`hunter:verify:${email.toLowerCase()}`, 30, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await get<{ data?: { status?: string } }>("hunter_verify", "/email-verifier", { email });
      // A 202 without a status means Hunter is still checking; it wants a retry shortly.
      if (res.data?.status) {
        await recordUsage("hunter_verify");
        return mapStatus(res.data.status) ?? "unknown";
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    return "unknown";
  });
}

function mapStatus(s?: string): EmailStatus | undefined {
  if (!s) return undefined;
  if (s === "valid") return "valid";
  if (s === "invalid") return "invalid";
  if (s === "accept_all") return "accept_all";
  if (s === "webmail" || s === "disposable") return "unknown";
  return "unknown";
}
