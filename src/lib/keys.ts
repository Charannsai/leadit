import "server-only";
import { db } from "./db";

export type KeyProvider = "groq" | "gemini" | "firecrawl" | "apollo" | "hunter" | "resend";

export const KEY_PROVIDERS: { id: KeyProvider; env: string; label: string; hint: string; docs: string }[] = [
  { id: "groq", env: "GROQ_API_KEY", label: "Groq", hint: "Enrichment agent: reads websites and matches founders", docs: "https://console.groq.com/keys" },
  { id: "gemini", env: "GEMINI_API_KEY", label: "Gemini", hint: "Drafting agent: writes outreach emails and LinkedIn messages", docs: "https://aistudio.google.com/apikey" },
  { id: "firecrawl", env: "FIRECRAWL_API_KEY", label: "Firecrawl", hint: "Web + LinkedIn search, JS page rendering", docs: "https://www.firecrawl.dev/app/api-keys" },
  { id: "hunter", env: "HUNTER_API_KEY", label: "Hunter", hint: "Email finder, domain search, verification", docs: "https://hunter.io/api-keys" },
  { id: "apollo", env: "APOLLO_API_KEY", label: "Apollo", hint: "Company profile by domain", docs: "https://app.apollo.io/#/settings/integrations/api" },
  { id: "resend", env: "RESEND_API_KEY", label: "Resend", hint: "Sends outreach emails from your domain", docs: "https://resend.com/api-keys" },
];

let cache: { at: number; keys: Map<string, { key: string; updated_at: string }> } | null = null;

async function stored() {
  if (cache && Date.now() - cache.at < 30_000) return cache.keys;
  const { data, error } = await db().from("le_api_keys").select("provider, key, updated_at");
  // Table missing (migration not run yet) → just use .env keys.
  const keys = new Map((error ? [] : data ?? []).map((r) => [r.provider as string, { key: r.key as string, updated_at: r.updated_at as string }]));
  cache = { at: Date.now(), keys };
  return keys;
}

/** The key to use: one saved in Settings wins, otherwise .env.local. */
export async function getKey(provider: KeyProvider): Promise<string | undefined> {
  const saved = (await stored()).get(provider)?.key;
  return saved || process.env[KEY_PROVIDERS.find((p) => p.id === provider)!.env] || undefined;
}

export async function keyStatus() {
  const keys = await stored();
  return KEY_PROVIDERS.map((p) => {
    const saved = keys.get(p.id);
    const env = process.env[p.env];
    const active = saved?.key || env;
    return {
      ...p,
      source: saved ? "saved" : env ? "env" : "missing",
      masked: active ? mask(active) : null,
      updated_at: saved?.updated_at ?? null,
    };
  });
}

export async function saveKey(provider: KeyProvider, key: string) {
  const { error } = await db().from("le_api_keys").upsert({ provider, key: key.trim(), updated_at: new Date().toISOString() });
  if (error) throw new Error(/schema cache/.test(error.message) ? "Run supabase/002_keys_overview.sql in Supabase first." : error.message);
  cache = null;
}

export async function removeKey(provider: KeyProvider) {
  await db().from("le_api_keys").delete().eq("provider", provider);
  cache = null;
}

function mask(k: string) {
  return k.length <= 10 ? "•".repeat(k.length) : `${k.slice(0, 4)}${"•".repeat(Math.min(16, k.length - 8))}${k.slice(-4)}`;
}

/** Calls a free endpoint of the provider to check the key works. */
export async function testKey(provider: KeyProvider, key: string): Promise<{ ok: boolean; detail: string }> {
  const t = AbortSignal.timeout(15_000);
  try {
    if (provider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: t });
      return r.ok ? { ok: true, detail: "Key works" } : { ok: false, detail: `Groq said ${r.status}` };
    }
    if (provider === "firecrawl") {
      const r = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${key}` }, signal: t });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, detail: `${j.data?.remaining_credits?.toLocaleString?.() ?? "?"} credits left` } : { ok: false, detail: `Firecrawl said ${r.status}` };
    }
    if (provider === "hunter") {
      const r = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`, { signal: t });
      const j = await r.json().catch(() => ({}));
      const s = j.data?.requests?.searches;
      return r.ok ? { ok: true, detail: `${j.data?.plan_name ?? ""} plan · ${s ? s.available - s.used : "?"} searches left` } : { ok: false, detail: `Hunter said ${r.status}` };
    }
    if (provider === "gemini") {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: t });
      return r.ok ? { ok: true, detail: "Key works" } : { ok: false, detail: `Gemini said ${r.status}` };
    }
    if (provider === "resend") {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, signal: t });
      const j = await r.json().catch(() => ({}));
      const verified = (j.data ?? []).filter((d: { status: string }) => d.status === "verified").map((d: { name: string }) => d.name);
      // Sending-only keys can't list domains but still work.
      if (r.status === 401 && /restricted/i.test(JSON.stringify(j))) return { ok: true, detail: "Sending-only key" };
      return r.ok ? { ok: true, detail: verified.length ? `Verified: ${verified.join(", ")}` : "No verified domain yet" } : { ok: false, detail: `Resend said ${r.status}` };
    }
    const r = await fetch("https://api.apollo.io/v1/auth/health", { headers: { "x-api-key": key }, signal: t });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.is_logged_in !== false ? { ok: true, detail: "Key works" } : { ok: false, detail: `Apollo said ${r.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
