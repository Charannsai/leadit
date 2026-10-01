import "server-only";
import { track } from "../agentLog";
import { ensureBudget, markExhausted, recordUsage, BudgetError } from "../budget";
import { cached } from "../cache";
import { getKey } from "../keys";
import { fetchJson, HttpError } from "./http";

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
}

const BASE = "https://api.firecrawl.dev/v2";

async function headers() {
  const key = await getKey("firecrawl");
  if (!key) throw new Error("No Firecrawl API key (Settings → API keys)");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function call<T>(path: string, payload: unknown, credits: number): Promise<T> {
  return track("firecrawl", path.slice(1), () => callRaw<T>(path, payload, credits), () => ({ detail: { credits } }));
}

async function callRaw<T>(path: string, payload: unknown, credits: number): Promise<T> {
  await ensureBudget("firecrawl", credits);
  try {
    const res = await fetchJson<T>("firecrawl", BASE + path, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(payload),
      timeoutMs: 60_000,
    });
    await recordUsage("firecrawl", credits);
    return res;
  } catch (e) {
    if (e instanceof HttpError && e.status === 402) {
      await markExhausted("firecrawl");
      throw new BudgetError("firecrawl");
    }
    throw e;
  }
}

/** Web search (Google-like). About 2 credits per call of up to 10 results. */
export async function search(query: string, limit = 5): Promise<SearchResult[]> {
  return cached(`fc:search:${limit}:${query.toLowerCase()}`, 30, async () => {
    const res = await call<{ data?: { web?: SearchResult[] } }>("/search", { query, limit }, 2);
    return (res.data?.web ?? []).map((r) => ({ url: r.url, title: r.title, description: r.description }));
  });
}

export interface ScrapeResult {
  markdown: string;
  links: string[];
  html?: string;
}

/** Renders a page (handles JS-heavy sites). 1 credit. Used only when a plain fetch fails. */
export async function scrape(url: string): Promise<ScrapeResult> {
  return cached(`fc:scrape:${url}`, 30, async () => {
    const res = await call<{ data?: { markdown?: string; links?: string[]; rawHtml?: string } }>(
      "/scrape",
      { url, formats: ["markdown", "links"], onlyMainContent: false, timeout: 30000 },
      1,
    );
    return { markdown: res.data?.markdown ?? "", links: res.data?.links ?? [] };
  });
}
