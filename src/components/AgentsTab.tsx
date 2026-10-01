"use client";

import { motion } from "motion/react";
import { Bot, ChevronDown, ChevronRight, ExternalLink, Mail, Maximize2, Minimize2, PenLine, Radar, Search, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { Button, Drawer, Pill, PixelLoader, cx } from "./ui";

// ---------- types ----------

interface AgentStats {
  calls: number;
  errors: number;
  rateLimited: number;
  jobs: number;
  jobErrors: number;
  tokensIn: number;
  tokensOut: number;
  lastAt: string | null;
}
interface KeyInfo {
  id: string;
  source: "saved" | "env" | "missing";
  masked: string | null;
}
interface Agent {
  id: string;
  name: string;
  role: string;
  steps: string[];
  llm: { provider: "groq" | "gemini"; model: string; key: KeyInfo; keys: Record<"groq" | "gemini", KeyInfo> } | null;
  tools: { name: string; use: string; key: KeyInfo | null }[];
  now: { id: string; title: string; step: string | null; since: string }[];
  queue: { label: string; n: number; note: string | null };
  nextAt?: string | null;
  stats: AgentStats;
}
interface BreakdownRow {
  agent: string;
  kind: string;
  provider: string;
  action: string;
  calls: number;
  errors: number;
  rate_limited: number;
  skipped: number;
  avg_ms: number;
  p95_ms: number;
  tokens_in: number;
  tokens_out: number;
  last_at: string;
}
interface LogRow {
  id: number;
  at: string;
  agent: string;
  kind: string;
  provider: string;
  action: string;
  status: string;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  label: string | null;
  message: string | null;
  detail: Record<string, unknown> | null;
}
type Payload = { worker: { alive: boolean }; agents: Agent[]; breakdown: BreakdownRow[] };

// ---------- helpers ----------

const ICONS: Record<string, typeof Bot> = { enrichment: Radar, drafting: PenLine, sending: Send, delivery: Mail };
const SHORT: Record<string, string> = { enrichment: "Enrichment", drafting: "Drafting", sending: "Sending", delivery: "Delivery" };
const PROVIDER_NAME: Record<string, string> = { groq: "Groq", gemini: "Gemini" };
const DEFAULT_MODEL: Record<string, string> = { groq: "openai/gpt-oss-120b", gemini: "gemini-3.8-flash" };
const STATUS_TONE: Record<string, "green" | "red" | "amber" | "neutral"> = { ok: "green", error: "red", rate_limited: "amber", skipped: "neutral" };
const STATUS_LABEL: Record<string, string> = { ok: "OK", error: "Error", rate_limited: "Rate limited", skipped: "Skipped" };

const n = (v: number) => Number(v).toLocaleString();
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(Number(v) / 1000).toFixed(1)}s` : `${Math.round(Number(v))}ms`);
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v));

function agentState(a: Agent): { label: string; tone: "dark" | "blue" | "neutral" } {
  if (a.now.length) return { label: "Working", tone: "dark" };
  if (a.queue.n) return { label: "Waiting", tone: "blue" };
  return { label: "Idle", tone: "neutral" };
}

function KeyPill({ k }: { k: KeyInfo | null }) {
  if (!k) return <span className="text-[11.5px] text-muted">No key needed</span>;
  if (k.source === "missing") return <Pill tone="red">Key missing</Pill>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill tone={k.source === "saved" ? "dark" : "neutral"}>{k.source === "saved" ? "Saved in app" : "From .env.local"}</Pill>
      {k.masked && <code className="font-mono text-[11px] text-muted">{k.masked}</code>}
    </span>
  );
}

// ---------- main ----------

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs" },
  { id: "usage", label: "API usage" },
] as const;

export function AgentsTab() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [logAgent, setLogAgent] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Payload>("/api/agents?window=24h")
        .then((d) => (setData(d), setError(null)))
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) return <div className="rounded-xl bg-[#fdf4e3] px-4 py-3 text-[12.5px] text-[#946215]">{error}</div>;
  if (!data) return <PixelLoader />;

  const agent = data.agents.find((a) => a.id === open) ?? null;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex rounded-lg bg-panel p-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx("relative rounded-md px-3 py-1 text-[12.5px]", tab === t.id ? "text-ink" : "text-muted hover:text-ink-2")}>
              {tab === t.id && <motion.span layoutId="agents-sub" className="absolute inset-0 rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-2 text-[12px] text-muted">
          {data.worker.alive ? (
            <>
              <PixelLoader /> <span className="shimmer-text font-medium">Worker running</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-line-strong" /> Worker idle
            </>
          )}
        </span>
      </div>

      {tab === "overview" && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.agents.map((a) => (
            <AgentCard key={a.id} a={a} onOpen={() => setOpen(a.id)} />
          ))}
        </div>
      )}
      {tab === "logs" && <Logs agent={logAgent} onAgent={setLogAgent} />}
      {tab === "usage" && <Usage />}

      <AgentPanel
        agent={agent}
        breakdown={data.breakdown.filter((r) => r.agent === open)}
        onClose={() => setOpen(null)}
        onSaved={load}
        onAllLogs={(id) => {
          setOpen(null);
          setLogAgent(id);
          setTab("logs");
        }}
      />
    </div>
  );
}

// ---------- overview card ----------

function AgentCard({ a, onOpen }: { a: Agent; onOpen: () => void }) {
  const Icon = ICONS[a.id] ?? Bot;
  const state = agentState(a);
  const problems = a.stats.errors + a.stats.jobErrors;
  const current = a.now[0];

  return (
    <button onClick={onOpen} className="group flex flex-col rounded-2xl border border-line bg-white p-4 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-3">
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors", a.now.length ? "bg-accent text-white" : "bg-panel-2 text-ink-2")}>
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-semibold">{a.name}</span>
        <Pill tone={state.tone} dot>
          {state.label}
        </Pill>
        <ChevronRight size={15} className="text-muted transition-transform group-hover:translate-x-0.5" />
      </div>

      <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">{a.role}</p>

      <div className="mt-3 flex h-9 items-center gap-2 rounded-lg bg-panel px-3 text-[12px]">
        {current ? (
          <>
            <PixelLoader />
            <span className="min-w-0 flex-1 truncate font-medium">{current.title}</span>
            <span className="shimmer-text shrink-0">{current.step ?? "Working"}…</span>
            {a.now.length > 1 && <span className="shrink-0 text-muted">+{a.now.length - 1}</span>}
          </>
        ) : (
          <span className="truncate text-muted">
            {a.queue.n ? `${n(a.queue.n)} ${a.queue.label}` : "Nothing queued"}
            {a.queue.note ? ` · ${a.queue.note}` : ""}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11.5px]">
        {a.llm ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5">
            <span className="font-medium">{PROVIDER_NAME[a.llm.provider]}</span>
            <span className="truncate font-mono text-muted">{a.llm.model}</span>
          </span>
        ) : (
          <span className="rounded-md border border-line px-1.5 py-0.5 text-muted">{a.tools[0]?.name ?? "No LLM"}</span>
        )}
        <span className="ml-auto shrink-0 text-muted">
          {n(a.stats.jobs)} jobs · {n(a.stats.calls)} calls
          {problems > 0 && <span className="text-[#b4403b]"> · {n(problems)} errors</span>} · 24h
        </span>
      </div>
    </button>
  );
}

// ---------- agent panel ----------

function AgentPanel({ agent, breakdown, onClose, onSaved, onAllLogs }: { agent: Agent | null; breakdown: BreakdownRow[]; onClose: () => void; onSaved: () => void; onAllLogs: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState<LogRow[] | null>(null);
  const [problems, setProblems] = useState<LogRow[] | null>(null);
  const id = agent?.id ?? null;

  useEffect(() => {
    if (!id) return;
    setJobs(null);
    setProblems(null);
    const load = () => {
      api<{ rows: LogRow[] }>(`/api/agents/logs?agent=${id}&kind=job&limit=12`).then((r) => setJobs(r.rows)).catch(() => setJobs([]));
      api<{ rows: LogRow[] }>(`/api/agents/logs?agent=${id}&status=problems&limit=8`).then((r) => setProblems(r.rows)).catch(() => setProblems([]));
    };
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(t);
  }, [id]);

  const Icon = agent ? ICONS[agent.id] ?? Bot : Bot;
  const state = agent ? agentState(agent) : null;
  const calls = breakdown.filter((r) => r.kind === "call");
  const avg = calls.length ? calls.reduce((a, r) => a + Number(r.avg_ms) * Number(r.calls), 0) / Math.max(1, calls.reduce((a, r) => a + Number(r.calls), 0)) : null;

  return (
    <Drawer open={!!agent} onClose={onClose} expanded={expanded}>
      {agent && (
        <div className="pb-8">
          <div className={cx("sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white/95 py-4", expanded ? "px-8" : "px-5")}>
            <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", agent.now.length ? "bg-accent text-white" : "bg-panel-2 text-ink-2")}>
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold">{agent.name}</span>
                {state && (
                  <Pill tone={state.tone} dot>
                    {state.label}
                  </Pill>
                )}
              </div>
              <div className="text-[12px] text-muted">{agent.stats.lastAt ? `Last active ${timeAgo(agent.stats.lastAt)}` : "No activity yet"}</div>
            </div>
            <button onClick={() => setExpanded((v) => !v)} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" aria-label={expanded ? "Collapse" : "Expand"}>
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className={cx("pt-5", expanded ? "mx-auto grid max-w-6xl gap-8 px-8 lg:grid-cols-2" : "space-y-7 px-5")}>
            <div className="space-y-7">
              <Section title="What it does">
                <p className="text-[13px] leading-relaxed text-ink-2">{agent.role}</p>
                <ol className="mt-3 space-y-1.5">
                  {agent.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5 text-[12.5px] text-ink-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[10.5px] font-semibold text-ink-2">{i + 1}</span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Model">
                {agent.llm ? <ModelPicker agentId={agent.id as "enrichment" | "drafting"} llm={agent.llm} onSaved={onSaved} /> : <div className="rounded-xl border border-line px-4 py-3 text-[12.5px] text-muted">This agent doesn&apos;t use an LLM.</div>}
              </Section>

              {agent.tools.length > 0 && (
                <Section title="Tools & keys" action={<Link href="/settings?tab=keys" className="text-[11.5px] text-muted hover:text-ink">Manage keys →</Link>}>
                  <div className="divide-y divide-line rounded-xl border border-line">
                    {agent.tools.map((t) => (
                      <div key={t.name} className="flex items-center gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium">{t.name}</div>
                          <div className="truncate text-[11.5px] text-muted">{t.use}</div>
                        </div>
                        <KeyPill k={t.key} />
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>

            <div className="space-y-7">
              <Section title="Right now">
                {agent.now.length ? (
                  <div className="space-y-1.5">
                    {agent.now.map((t) => (
                      <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                        <PixelLoader />
                        <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                        <span className="shimmer-text shrink-0 text-[12px]">{t.step ?? "Working"}…</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-panel px-3 py-2.5 text-[12.5px] text-muted">Not working on anything.</div>
                )}
                <div className="mt-2 text-[12px] text-ink-2">
                  {n(agent.queue.n)} {agent.queue.label}
                  {agent.queue.note ? ` · ${agent.queue.note}` : ""}
                  {agent.nextAt ? ` · next at ${new Date(agent.nextAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
                </div>
              </Section>

              <Section title="Last 24 hours">
                <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-line bg-line">
                  <Stat label="Jobs done" value={n(agent.stats.jobs)} />
                  <Stat label="API calls" value={n(agent.stats.calls)} />
                  <Stat label="Errors" value={n(agent.stats.errors + agent.stats.jobErrors)} bad={agent.stats.errors + agent.stats.jobErrors > 0} />
                  <Stat label={agent.llm ? "Tokens" : "Avg time"} value={agent.llm ? (agent.stats.tokensIn + agent.stats.tokensOut ? compact(agent.stats.tokensIn + agent.stats.tokensOut) : "—") : ms(avg)} />
                </div>
                {calls.length > 0 && (
                  <div className="mt-2 divide-y divide-line rounded-xl border border-line text-[12px]">
                    {calls.map((r) => (
                      <div key={r.provider + r.action} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-40 truncate">
                          <span className="font-medium capitalize">{r.provider}</span> <span className="text-muted">· {r.action}</span>
                        </span>
                        <span className="tabular-nums">{n(r.calls)} calls</span>
                        {Number(r.errors) > 0 && <span className="tabular-nums text-[#b4403b]">{n(r.errors)} errors</span>}
                        <span className="ml-auto tabular-nums text-muted">avg {ms(r.avg_ms)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Recent work" action={<button onClick={() => onAllLogs(agent.id)} className="text-[11.5px] text-muted hover:text-ink">All logs →</button>}>
                <MiniLog rows={jobs} empty="No finished jobs yet." />
              </Section>

              <Section title="Recent problems">
                <MiniLog rows={problems} empty="No errors. 🎉" showProvider />
              </Section>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ModelPicker({ agentId, llm, onSaved }: { agentId: "enrichment" | "drafting"; llm: NonNullable<Agent["llm"]>; onSaved: () => void }) {
  const [provider, setProvider] = useState(llm.provider);
  const [model, setModel] = useState(llm.model);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setModels(null);
    setModelsError(null);
    api<{ models: string[]; error?: string }>(`/api/agents/models?provider=${provider}`)
      .then((r) => {
        setModels(r.models);
        if (r.error) setModelsError(r.error);
      })
      .catch((e) => setModelsError(e.message));
  }, [provider]);

  const dirty = provider !== llm.provider || model !== llm.model;
  const options = useMemo(() => [...new Set([model, ...(models ?? [])])].filter(Boolean), [model, models]);

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ agents: { [agentId]: { provider, model } } }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const select = "h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-[13px] outline-none focus:border-ink";
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        <label>
          <div className="mb-1 text-[11.5px] font-medium text-ink-2">Provider</div>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as "groq" | "gemini";
              setProvider(p);
              setModel(p === llm.provider ? llm.model : DEFAULT_MODEL[p]);
            }}
            className={select}
          >
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label>
          <div className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-ink-2">
            Model {models === null && <PixelLoader />}
          </div>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={cx(select, "font-mono text-[12.5px]")}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <span className="text-muted">{PROVIDER_NAME[provider]} key:</span>
        <KeyPill k={llm.keys[provider]} />
        <Link href="/settings?tab=keys" className="text-muted hover:text-ink">
          <ExternalLink size={12} />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-[#2f7a45]">Saved. Used from the next job.</span>}
          <Button size="sm" variant="primary" onClick={save} disabled={!dirty || busy}>
            Save
          </Button>
        </div>
      </div>
      {modelsError && <div className="mt-2 text-[11.5px] text-[#946215]">Couldn&apos;t load the model list: {modelsError}</div>}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className={cx("text-[16px] font-semibold tabular-nums", bad && "text-[#b4403b]")}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function MiniLog({ rows, empty, showProvider }: { rows: LogRow[] | null; empty: string; showProvider?: boolean }) {
  if (rows === null) return <PixelLoader />;
  if (!rows.length) return <div className="rounded-lg bg-panel px-3 py-2.5 text-[12.5px] text-muted">{empty}</div>;
  return (
    <ol className="divide-y divide-line rounded-xl border border-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-2.5 px-3 py-2 text-[12px]">
          <span className={cx("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", r.status === "ok" ? "bg-[#3a9a5b]" : r.status === "error" ? "bg-[#c4554f]" : r.status === "rate_limited" ? "bg-[#d39a2c]" : "bg-line-strong")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {showProvider && r.kind === "call" ? `${r.provider}.${r.action}` : r.label ?? r.action}
            </span>
            <span className={cx("block truncate", r.status === "error" ? "text-[#b4403b]" : "text-ink-2")}>{r.message ?? STATUS_LABEL[r.status]}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted">{timeAgo(r.at)}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------- API usage tab ----------

function Usage() {
  const [win, setWin] = useState("24h");
  const [agent, setAgent] = useState("");
  const [rows, setRows] = useState<BreakdownRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    const load = () => api<Payload>(`/api/agents?window=${win}`).then((d) => setRows(d.breakdown)).catch(() => setRows([]));
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(t);
  }, [win]);

  const shown = (rows ?? []).filter((r) => r.kind === "call" && (!agent || r.agent === agent));
  const jobs = (rows ?? []).filter((r) => r.kind === "job" && (!agent || r.agent === agent));
  const total = (k: keyof BreakdownRow) => shown.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={agent} onChange={setAgent} options={[["", "All agents"], ...Object.entries(SHORT)]} />
        <div className="ml-auto">
          <Seg value={win} onChange={setWin} options={[["1h", "1 hour"], ["24h", "24 hours"], ["7d", "7 days"]]} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Stat label="API calls" value={n(total("calls"))} />
        <Stat label="Errors" value={n(total("errors"))} bad={total("errors") > 0} />
        <Stat label="Rate limited" value={n(total("rate_limited"))} />
        <Stat label="LLM tokens" value={compact(total("tokens_in") + total("tokens_out"))} />
      </div>

      <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="px-4 py-2 font-medium">Service · action</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">Errors</th>
              <th className="px-3 py-2 text-right font-medium">Rate limited</th>
              <th className="px-3 py-2 text-right font-medium">Avg</th>
              <th className="px-3 py-2 text-right font-medium">p95</th>
              <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
              <th className="px-4 py-2 text-right font-medium">Last call</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.agent}-${r.provider}-${r.action}`} className="border-t border-line">
                <td className="px-4 py-2">
                  <span className="font-medium capitalize">{r.provider}</span> <span className="text-muted">· {r.action}</span>
                </td>
                <td className="px-3 py-2 text-ink-2">{SHORT[r.agent] ?? r.agent}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n(r.calls)}</td>
                <td className={cx("px-3 py-2 text-right tabular-nums", Number(r.errors) ? "font-medium text-[#b4403b]" : "text-muted")}>{n(r.errors)}</td>
                <td className={cx("px-3 py-2 text-right tabular-nums", Number(r.rate_limited) ? "text-[#946215]" : "text-muted")}>{n(r.rate_limited)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{ms(r.avg_ms)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{ms(r.p95_ms)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{Number(r.tokens_in) || Number(r.tokens_out) ? `${n(r.tokens_in)} / ${n(r.tokens_out)}` : "—"}</td>
                <td className="px-4 py-2 text-right text-[11.5px] text-muted">{timeAgo(r.last_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && (
          <div className="flex justify-center py-8">
            <PixelLoader />
          </div>
        )}
        {rows && !shown.length && <div className="py-8 text-center text-[12.5px] text-muted">No API calls in this period. Answers served from the cache don&apos;t count.</div>}
      </div>

      {jobs.length > 0 && (
        <div className="rounded-xl border border-line">
          <div className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Work done</div>
          {jobs.map((r) => (
            <div key={r.agent + r.action} className="flex items-center gap-3 px-4 py-1.5 text-[12.5px]">
              <span className="w-28 text-ink-2">{SHORT[r.agent]}</span>
              <span className="flex-1 font-medium">{r.action}</span>
              <span className="tabular-nums">{n(r.calls)}</span>
              {Number(r.errors) > 0 && <span className="tabular-nums text-[#b4403b]">{n(r.errors)} failed</span>}
              <span className="w-20 text-right tabular-nums text-muted">avg {ms(r.avg_ms)}</span>
            </div>
          ))}
          <div className="h-2" />
        </div>
      )}
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: (readonly [string, string] | string[])[] }) {
  return (
    <div className="flex rounded-lg bg-panel p-0.5">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} className={cx("rounded-md px-2.5 py-1 text-[12px]", value === k ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink-2")}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------- logs tab ----------

const PROVIDERS = ["groq", "gemini", "firecrawl", "hunter", "apollo", "clearbit", "website", "resend"];

function Logs({ agent, onAgent }: { agent: string | null; onAgent: (a: string | null) => void }) {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [provider, setProvider] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [more, setMore] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const top = useRef(0);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: "100" });
    if (agent) p.set("agent", agent);
    if (status) p.set("status", status);
    if (kind) p.set("kind", kind);
    if (provider) p.set("provider", provider);
    if (q.trim()) p.set("q", q.trim());
    return p;
  }, [agent, status, kind, provider, q]);

  useEffect(() => {
    setRows(null);
    const t = setTimeout(
      () =>
        api<{ rows: LogRow[] }>(`/api/agents/logs?${params}`)
          .then((r) => {
            setRows(r.rows);
            setMore(r.rows.length === 100);
            top.current = r.rows[0]?.id ?? 0;
          })
          .catch(() => setRows([])),
      200,
    );
    return () => clearTimeout(t);
  }, [params]);

  // Live tail: new entries slide in at the top.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const r = await api<{ rows: LogRow[] }>(`/api/agents/logs?${params}`).catch(() => null);
      const fresh = r?.rows.filter((x) => x.id > top.current) ?? [];
      if (fresh.length) {
        top.current = fresh[0].id;
        setRows((old) => [...fresh, ...(old ?? [])].slice(0, 500));
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [params]);

  async function older() {
    if (!rows?.length) return;
    const p = new URLSearchParams(params);
    p.set("before", String(rows[rows.length - 1].id));
    const r = await api<{ rows: LogRow[] }>(`/api/agents/logs?${p}`);
    setRows([...rows, ...r.rows]);
    setMore(r.rows.length === 100);
  }

  const select = "h-8 rounded-lg border border-line-strong bg-white px-2 text-[12px] outline-none focus:border-ink";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={agent ?? ""} onChange={(e) => onAgent(e.target.value || null)} className={select}>
          <option value="">All agents</option>
          {Object.entries(SHORT).map(([k, v]) => (
            <option key={k} value={k}>
              {v} agent
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={select}>
          <option value="">Work + API calls</option>
          <option value="job">Work done only</option>
          <option value="call">API calls only</option>
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className={select}>
          <option value="">All services</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <Seg value={status} onChange={setStatus} options={[["", "All"], ["problems", "Problems"], ["error", "Errors"], ["rate_limited", "Rate limited"]]} />
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or message" className="h-8 w-56 rounded-lg border border-line-strong pl-7 pr-2 text-[12px] outline-none focus:border-ink" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[84px_92px_170px_96px_minmax(0,1fr)_64px] gap-3 border-b border-line bg-panel/60 px-4 py-2 text-[11px] font-medium text-muted">
          <span>Time</span>
          <span>Agent</span>
          <span>What</span>
          <span>Status</span>
          <span>Details</span>
          <span className="text-right">Took</span>
        </div>
        {rows === null ? (
          <div className="flex justify-center py-10">
            <PixelLoader />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-muted">No log entries match.</div>
        ) : (
          <ol className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="grid w-full grid-cols-[84px_92px_170px_96px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-2 text-left text-[12px] hover:bg-panel/50">
                  <span className="font-mono text-[11px] text-muted" title={new Date(r.at).toLocaleString()}>
                    {new Date(r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="truncate text-ink-2">{SHORT[r.agent] ?? r.agent}</span>
                  <span className={cx("truncate", r.kind === "job" ? "font-semibold" : "font-mono text-[11.5px] text-ink-2")}>{r.kind === "job" ? r.action : `${r.provider}.${r.action}`}</span>
                  <span>
                    <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    {r.label && <span className="shrink-0 truncate font-medium text-ink" style={{ maxWidth: "45%" }}>{r.label}</span>}
                    <span className={cx("truncate", r.status === "error" ? "text-[#b4403b]" : "text-ink-2")}>{r.message ?? ""}</span>
                    <ChevronDown size={12} className={cx("ml-auto shrink-0 text-muted transition-transform", open === r.id && "rotate-180")} />
                  </span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-muted">{ms(r.latency_ms)}</span>
                </button>
                {open === r.id && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t border-line bg-panel/40 px-4 py-3 text-[12px]">
                    <div className="mb-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-muted">
                      <span>{new Date(r.at).toLocaleString()}</span>
                      {r.tokens_in != null && (
                        <span>
                          tokens in {n(r.tokens_in)} · out {n(r.tokens_out ?? 0)}
                        </span>
                      )}
                      <span>#{r.id}</span>
                    </div>
                    {r.message && <div className="whitespace-pre-wrap text-ink">{r.message}</div>}
                    {r.detail && <pre className="scroll-thin mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-white p-2.5 font-mono text-[11px] text-ink-2">{JSON.stringify(r.detail, null, 2)}</pre>}
                  </motion.div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {rows && rows.length > 0 && more && (
        <div className="flex justify-center">
          <Button size="sm" variant="ghost" onClick={older}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
