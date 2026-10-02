"use client";

import { motion } from "motion/react";
import { CircleCheck, CircleX, Database, ExternalLink, Eye, EyeOff, KeyRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { AgentsTab } from "./AgentsTab";
import { PageHeader, providerLabel, useApp, type UsageItem } from "./AppShell";
import { Button, Meter, Pill, PixelLoader, Toggle, cx } from "./ui";

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "keys", label: "API keys" },
  { id: "credits", label: "Credits" },
  { id: "enrichment", label: "Enrichment" },
  { id: "outreach", label: "Outreach" },
] as const;

export function SettingsView() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "keys") as (typeof TABS)[number]["id"];

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <PageHeader title="Settings" subtitle="Keys, credit limits and how leads are enriched" />
      <div className="border-b border-line px-6">
        <div className="-mb-px flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => router.replace(`/settings?tab=${t.id}`)} className={cx("relative px-3 pb-2.5 pt-1 text-[13px]", tab === t.id ? "text-ink" : "text-muted hover:text-ink-2")}>
              {t.label}
              {tab === t.id && <motion.span layoutId="settings-tab" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink" />}
            </button>
          ))}
        </div>
      </div>
      <div className={cx("px-6 py-6", tab !== "agents" && "max-w-3xl")}>
        {tab === "agents" && <AgentsTab />}
        {tab === "keys" && <KeysTab />}
        {tab === "credits" && <CreditsTab />}
        {tab === "enrichment" && <EnrichmentTab />}
        {tab === "outreach" && <OutreachTab />}
      </div>
    </div>
  );
}

// ---------------- API keys ----------------

interface KeyRow {
  id: string;
  label: string;
  hint: string;
  docs: string;
  env: string;
  source: "saved" | "env" | "missing";
  masked: string | null;
  updated_at: string | null;
}

function KeysTab() {
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const load = useCallback(() => api<KeyRow[]>("/api/keys").then(setRows).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Bring your own keys. A key saved here replaces the one in <code className="rounded bg-panel px-1 font-mono text-[11.5px]">.env.local</code> right away, with no restart or redeploy. New keys are tested before they&apos;re saved. Remove a saved key to go back to the .env one.
      </p>
      {!rows ? (
        <PixelLoader />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {rows.map((r) => (
            <KeyItem key={r.id} row={r} onChange={setRows} />
          ))}
          <div className="flex items-start gap-3 bg-panel/40 px-4 py-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white">
              <Database size={14} className="text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">Supabase</div>
              <div className="text-[12px] text-muted">The database connection itself, so it stays in .env.local (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Change it there and restart.</div>
            </div>
            <Pill>.env.local</Pill>
          </div>
        </div>
      )}
    </div>
  );
}

function KeyItem({ row, onChange }: { row: KeyRow; onChange: (rows: KeyRow[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function reveal() {
    if (revealed) return setRevealed(null);
    const { key } = await api<{ key: string }>(`/api/keys?reveal=${row.id}`);
    setRevealed(key);
  }
  async function test() {
    setBusy("test");
    setResult(null);
    try {
      setResult(await api<{ ok: boolean; detail: string }>("/api/keys", { method: "POST", body: JSON.stringify({ provider: row.id, key: editing ? value : undefined }) }));
    } finally {
      setBusy(null);
    }
  }
  async function save(force = false) {
    setBusy("save");
    setResult(null);
    try {
      onChange(await api<KeyRow[]>("/api/keys", { method: "PUT", body: JSON.stringify({ provider: row.id, key: value, force }) }));
      setEditing(false);
      setValue("");
      setRevealed(null);
      setResult({ ok: true, detail: "Saved. The worker uses it from now on." });
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!confirm(`Remove the saved ${row.label} key? The app will use the one from .env.local${row.source === "saved" ? " (if set)" : ""}.`)) return;
    onChange(await api<KeyRow[]>(`/api/keys?provider=${row.id}`, { method: "DELETE" }));
    setRevealed(null);
    setResult(null);
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
          <KeyRound size={14} className="text-ink-2" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{row.label}</span>
            {row.source === "saved" && <Pill tone="dark">Saved in app</Pill>}
            {row.source === "env" && <Pill>From .env.local</Pill>}
            {row.source === "missing" && <Pill tone="red">Missing</Pill>}
            <a href={row.docs} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Get a key">
              <ExternalLink size={12} />
            </a>
          </div>
          <div className="text-[12px] text-muted">{row.hint}</div>
          {!editing && row.masked && (
            <div className="mt-2 flex items-center gap-2">
              <code className="max-w-full truncate rounded-md bg-panel px-2 py-1 font-mono text-[11.5px] text-ink-2">{revealed ?? row.masked}</code>
              <button onClick={reveal} className="rounded p-1 text-muted hover:bg-panel hover:text-ink" title={revealed ? "Hide" : "Reveal"}>
                {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          )}
          {editing && (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && value.trim() && save()}
                placeholder={`New ${row.label} key`}
                className="h-8 flex-1 rounded-lg border border-line-strong px-2.5 font-mono text-[12px] outline-none focus:border-ink"
              />
              <Button size="sm" variant="primary" onClick={() => save()} disabled={!value.trim() || !!busy}>
                {busy === "save" ? <PixelLoader className="[&>span]:bg-white" /> : null} Test & save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setValue(""), setResult(null))}>
                Cancel
              </Button>
            </div>
          )}
          {result && (
            <div className={cx("mt-2 flex items-center gap-1.5 text-[12px]", result.ok ? "text-[#2f7a45]" : "text-[#b4403b]")}>
              {result.ok ? <CircleCheck size={13} /> : <CircleX size={13} />} {result.detail}
              {!result.ok && editing && (
                <button onClick={() => save(true)} className="ml-2 text-muted underline hover:text-ink">
                  Save anyway
                </button>
              )}
            </div>
          )}
          {row.updated_at && !editing && <div className="mt-1.5 text-[11px] text-muted">Updated {new Date(row.updated_at).toLocaleString()}</div>}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={test} disabled={!!busy || row.source === "missing"}>
              {busy === "test" ? <PixelLoader /> : null} Test
            </Button>
            <Button size="sm" onClick={() => (setEditing(true), setResult(null))}>
              {row.source === "missing" ? "Add key" : "Replace"}
            </Button>
            {row.source === "saved" && (
              <Button size="sm" variant="ghost" onClick={remove}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Credits ----------------

interface Settings {
  limits: { apollo: number; hunter_search: number; hunter_verify: number; firecrawl: number };
  concurrency: number;
  verifyEmails: boolean;
  guessEmails: boolean;
  outreach: {
    fromName: string;
    fromEmail: string;
    replyTo: string;
    senderTitle: string;
    company: string;
    signature: string;
    dailyLimit: number;
    gapSeconds: number;
    optOutLine: string;
    linkedinDailyLimit: number;
  };
}

interface Credits {
  usage: UsageItem[];
  hunter: { plan: string | null; searches: { used: number; available: number } | null; verifications: { used: number; available: number } | null; reset: string | null } | null;
  firecrawl: { remaining: number | null; plan: number | null; reset: string | null } | null;
}

const CREDIT_INFO: Record<string, string> = {
  firecrawl: "Web + LinkedIn search (~2 per search) and JavaScript page rendering (1 per page)",
  hunter_search: "Email finder and domain search, 1 per email found",
  hunter_verify: "Checks that an email can receive mail, 1 per check",
  apollo: "Company profile by domain, the only Apollo endpoint on the free plan",
};

function useSettings() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    api<Settings>("/api/settings").then(setS).catch(() => {});
  }, []);
  return [s, setS] as const;
}

function CreditsTab() {
  const { refreshUsage } = useApp();
  const [s, setS] = useSettings();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Credits>("/api/credits").then(setCredits).catch(() => {});
  }, []);
  useEffect(() => {
    if (s && !saved) setSaved(s);
  }, [s, saved]);

  const dirty = s && saved && JSON.stringify(s.limits) !== JSON.stringify(saved.limits);

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const next = await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify({ limits: s.limits }) });
      setS(next);
      setSaved(next);
      refreshUsage();
    } finally {
      setBusy(false);
    }
  }

  const live = (p: string) => {
    if (p === "firecrawl" && credits?.firecrawl?.remaining != null) return { text: `${credits.firecrawl.remaining.toLocaleString()} of ${credits.firecrawl.plan?.toLocaleString() ?? "?"} left`, reset: credits.firecrawl.reset };
    if (p === "hunter_search" && credits?.hunter?.searches) return { text: `${(credits.hunter.searches.available - credits.hunter.searches.used).toLocaleString()} of ${credits.hunter.searches.available} left`, reset: credits.hunter.reset };
    if (p === "hunter_verify" && credits?.hunter?.verifications) return { text: `${(credits.hunter.verifications.available - credits.hunter.verifications.used).toLocaleString()} of ${credits.hunter.verifications.available} left`, reset: credits.hunter.reset };
    return null;
  };

  if (!s) return <PixelLoader />;
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted">
        &quot;Used&quot; is what this app has spent this calendar month. &quot;On your plan&quot; comes live from the provider. When a limit is reached the worker stops using that service, and leads that still need it are <b className="font-medium text-ink-2">paused</b> until you resume them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(CREDIT_INFO) as (keyof Settings["limits"])[]).map((p) => {
          const u = credits?.usage.find((x) => x.provider === p);
          const l = live(p);
          return (
            <div key={p} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {providerLabel(p)}
                    {u?.exhausted && <Pill tone="red">Out of credits</Pill>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{CREDIT_INFO[p]}</div>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <div className="text-[22px] font-semibold tabular-nums tracking-tight">{(u?.used ?? 0).toLocaleString()}</div>
                  <div className="text-[11px] text-muted">used this month</div>
                </div>
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  Monthly limit
                  <input
                    type="number"
                    min={0}
                    value={s.limits[p]}
                    onChange={(e) => setS({ ...s, limits: { ...s.limits, [p]: Number(e.target.value) } })}
                    className="h-7 w-20 rounded-md border border-line-strong px-2 text-right text-[12.5px] text-ink tabular-nums outline-none focus:border-ink"
                  />
                </label>
              </div>
              <Meter className="mt-2.5" value={u?.exhausted ? s.limits[p] : u?.used ?? 0} max={s.limits[p]} />
              <div className="mt-2 flex justify-between text-[11px] text-muted">
                <span>{l ? `On your plan: ${l.text}` : p === "apollo" ? "Apollo has no free usage endpoint" : credits ? "—" : "Checking…"}</span>
                {l?.reset && <span>Resets {new Date(l.reset).toLocaleDateString()}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[12.5px]">
        <span className="text-ink-2">Groq calls this month</span>
        <span className="font-medium tabular-nums">{(credits?.usage.find((u) => u.provider === "groq")?.used ?? 0).toLocaleString()}</span>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={!dirty || busy}>
          Save limits
        </Button>
      </div>
    </div>
  );
}

// ---------------- Enrichment ----------------

function EnrichmentTab() {
  const [s, setS] = useSettings();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function patch(p: Partial<Settings>) {
    if (!s) return;
    setS({ ...s, ...p });
    setS(await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(p) }));
    setSavedAt(Date.now());
  }

  if (!s) return <PixelLoader />;
  return (
    <div className="space-y-4">
      <div className="divide-y divide-line rounded-xl border border-line px-4">
        <div className="py-2">
          <Toggle checked={s.verifyEmails} onChange={(v) => patch({ verifyEmails: v })} label="Verify founder emails found on websites or LinkedIn (1 Hunter verification each)" />
        </div>
        <div className="py-2">
          <Toggle checked={s.guessEmails} onChange={(v) => patch({ guessEmails: v })} label="When nothing is found, try first@ and first.last@ and keep a guess only if it verifies" />
        </div>
        <label className="flex items-center justify-between gap-4 py-3.5 text-[13px]">
          <span className="text-ink-2">
            Leads processed in parallel
            <span className="block text-[11.5px] text-muted">Higher is faster but hits free-tier rate limits sooner. 3 is a good default.</span>
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={s.concurrency}
            onChange={(e) => setS({ ...s, concurrency: Number(e.target.value) })}
            onBlur={() => patch({ concurrency: s.concurrency })}
            className="h-8 w-16 rounded-md border border-line-strong px-2 text-right text-[13px] tabular-nums outline-none focus:border-ink"
          />
        </label>
      </div>
      {savedAt && <div className="text-[12px] text-muted">Saved. The next worker run uses these settings.</div>}
    </div>
  );
}

// ---------------- Outreach ----------------

function OutreachTab() {
  const [s, setS] = useSettings();
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!s) return <PixelLoader />;
  const o = s.outreach;
  const set = (patch: Partial<Settings["outreach"]>) => setS({ ...s, outreach: { ...o, ...patch } });
  const dirty = saved !== JSON.stringify(o);

  async function save() {
    setBusy(true);
    try {
      const next = await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify({ outreach: o }) });
      setS(next);
      setSaved(JSON.stringify(next.outreach));
    } finally {
      setBusy(false);
    }
  }
  if (saved === null) setSaved(JSON.stringify(o));

  const input = "h-8 w-full rounded-lg border border-line-strong px-2.5 text-[13px] outline-none focus:border-ink";
  const perHour = Math.round(3600 / o.gapSeconds);
  return (
    <div className="space-y-5">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Emails go out through Resend from your verified domain. Replies land in your normal inbox (Zoho). Mark them as replied on the lead.
      </p>
      <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
        <L label="From name"><input className={input} placeholder="Jane Doe" value={o.fromName} onChange={(e) => set({ fromName: e.target.value })} /></L>
        <L label="From email" hint="Must be on a domain verified in Resend"><input className={input} placeholder="jane@yourcompany.com" value={o.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} /></L>
        <L label="Reply-to"><input className={input} placeholder="Same as from email" value={o.replyTo} onChange={(e) => set({ replyTo: e.target.value })} /></L>
        <L label="Your title" hint="Used by the AI to write in your voice"><input className={input} placeholder="Founder" value={o.senderTitle} onChange={(e) => set({ senderTitle: e.target.value })} /></L>
        <L label="Your company"><input className={input} placeholder="Acme Inc" value={o.company} onChange={(e) => set({ company: e.target.value })} /></L>
        <div className="sm:col-span-2">
          <L label="Signature" hint="Added under every email">
            <textarea rows={3} className="w-full resize-y rounded-lg border border-line-strong px-2.5 py-2 text-[13px] outline-none focus:border-ink" placeholder={SIGNATURE_PLACEHOLDER} value={o.signature} onChange={(e) => set({ signature: e.target.value })} />
          </L>
        </div>
        <div className="sm:col-span-2">
          <L label="Opt-out line" hint="Last line of every email. Leave empty to drop it"><input className={input} value={o.optOutLine} onChange={(e) => set({ optOutLine: e.target.value })} /></L>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-3">
        <L label="Emails per day" hint="Rolling 24 hours. Resend free tier allows 100"><input type="number" min={1} max={100} className={input} value={o.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} /></L>
        <L label="Seconds between emails" hint={`About ${perHour} per hour`}><input type="number" min={10} className={input} value={o.gapSeconds} onChange={(e) => set({ gapSeconds: Number(e.target.value) })} /></L>
        <L label="LinkedIn invites per day" hint="Suggested cap for your tasks"><input type="number" min={1} max={100} className={input} value={o.linkedinDailyLimit} onChange={(e) => set({ linkedinDailyLimit: Number(e.target.value) })} /></L>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={!dirty || busy}>Save</Button>
      </div>
    </div>
  );
}

function L({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[12px] font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </label>
  );
}

const SIGNATURE_PLACEHOLDER = ["Jane Doe", "Acme Inc"].join("\n");
