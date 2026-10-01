"use client";

import { AnimatePresence, motion } from "motion/react";
import { Activity, ChevronLeft, ChevronRight, Download, Pause, Play, Plus, RotateCcw, Search, Send, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import type { Lead, LeadEvent } from "@/lib/types";
import { PageHeader, useApp } from "./AppShell";
import { ExportBuilder } from "./ExportBuilder";
import { CampaignWizard } from "./outreach/CampaignWizard";
import { LeadDrawer } from "./LeadDrawer";
import { Button, EmailStatus, LinkedInIcon, Pill, PixelLoader, StatusPill, cx } from "./ui";

type Row = Omit<Lead, "profile" | "upload_id">;

interface Stats {
  counts: Record<string, number>;
  found: { founders: number; emails: number };
  worker: { alive: boolean; queuedTotal: number };
  events: (LeadEvent & { lead_id: string })[];
  active: { id: string; company_name: string | null; domain: string | null; stage: string | null; row_index: number }[];
}

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "new", label: "Not enriched" },
  { key: "queued,processing", label: "In progress" },
  { key: "done", label: "Enriched" },
  { key: "paused", label: "Paused" },
  { key: "failed", label: "Failed" },
];

const PAGE_SIZE = 100;

/** setInterval that pauses while the browser tab is hidden. */
function useVisibleInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!t) t = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (t) clearInterval(t);
      t = null;
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        saved.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
}

export function LeadsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { uploads, uploadsError, openUpload, refreshUsage } = useApp();

  const uploadId = params.get("u") ?? uploads?.[0]?.id ?? null;
  const upload = uploads?.find((u) => u.id === uploadId) ?? null;

  const [sheet, setSheet] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Stats | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [wizardIds, setWizardIds] = useState<string[] | null>(null);
  const wizardInitial = useMemo(() => (wizardIds ? { uploadId: uploadId ?? undefined, ids: wizardIds } : undefined), [wizardIds, uploadId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prevStatus = useRef<Map<string, string>>(new Map());
  const rowsSig = useRef("");
  const statsSig = useRef("");

  useEffect(() => {
    if (params.get("imported")) {
      setToast("Imported. Review the rows, then press Enrich.");
      router.replace(`/leads?u=${params.get("u")}`);
    }
  }, [params, router]);

  useEffect(() => {
    setSheet(null);
    setPage(0);
    setSelected(new Set());
    setStats(null);
    setRows([]);
    rowsSig.current = statsSig.current = "";
  }, [uploadId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => setPage(0), [sheet, status, onlyEmail, debounced]);

  const loadRows = useCallback(async () => {
    if (!uploadId) return;
    const qs = new URLSearchParams({ upload: uploadId, page: String(page), size: String(PAGE_SIZE) });
    if (sheet) qs.set("sheet", sheet);
    if (status) qs.set("status", status);
    if (onlyEmail) qs.set("outcome", "email");
    if (debounced) qs.set("q", debounced);
    const key = qs.toString();
    const res = await api<{ rows: Row[]; total: number }>(`/api/leads?${qs}`);

    // Skip the re-render entirely when nothing changed since the last poll.
    const sig = key + "|" + res.total + "|" + res.rows.map((r) => r.id + r.updated_at + r.status + (r.stage ?? "")).join(",");
    if (sig === rowsSig.current) return;
    rowsSig.current = sig;

    const finished = res.rows.filter((r) => prevStatus.current.get(r.id) === "processing" && r.status !== "processing").map((r) => r.id);
    res.rows.forEach((r) => prevStatus.current.set(r.id, r.status));
    if (finished.length) {
      setFlash(new Set(finished));
      setTimeout(() => setFlash(new Set()), 1600);
    }
    setRows(res.rows);
    setTotal(res.total);
  }, [uploadId, page, sheet, status, onlyEmail, debounced]);

  useEffect(() => {
    setLoadingRows(true);
    loadRows()
      .catch((e) => setToast(e.message))
      .finally(() => setLoadingRows(false));
  }, [loadRows]);

  const loadStats = useCallback(async () => {
    if (!uploadId) return;
    const qs = new URLSearchParams({ upload: uploadId });
    if (sheet) qs.set("sheet", sheet);
    const s = await api<Stats>(`/api/stats?${qs}`);
    const sig = JSON.stringify(s);
    if (sig === statsSig.current) return;
    statsSig.current = sig;
    setStats(s);
  }, [uploadId, sheet]);

  useEffect(() => {
    loadStats().catch(() => {});
  }, [loadStats]);

  const running = !!stats && (stats.counts.queued ?? 0) + (stats.counts.processing ?? 0) > 0;

  useVisibleInterval(() => loadStats().catch(() => {}), uploadId ? (running ? 3000 : 10000) : null);
  useVisibleInterval(() => loadRows().catch(() => {}), running ? 4000 : null);
  useVisibleInterval(refreshUsage, running ? 8000 : null);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      loadRows().catch(() => {});
      refreshUsage();
    }
    wasRunning.current = running;
  }, [running, loadRows, refreshUsage]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- actions ----
  async function enrich(scope: "new" | "failed" | "paused" | "all", ids?: string[]) {
    if (!uploadId) return;
    setBusy(scope);
    try {
      const { queued } = await api<{ queued: number }>("/api/enrich", { method: "POST", body: JSON.stringify({ uploadId, sheet, scope, ids }) });
      setToast(queued ? `${queued.toLocaleString()} lead${queued > 1 ? "s" : ""} queued` : "Nothing to queue");
      setSelected(new Set());
      await Promise.all([loadStats(), loadRows()]);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!uploadId) return;
    setBusy("stop");
    try {
      const { stopped } = await api<{ stopped: number }>("/api/stop", { method: "POST", body: JSON.stringify({ uploadId, sheet }) });
      setToast(`Removed ${stopped.toLocaleString()} from the queue`);
      await Promise.all([loadStats(), loadRows()]);
    } finally {
      setBusy(null);
    }
  }

  const toggleRow = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const openRow = useCallback((id: string) => setDrawer(id), []);

  // ---- derived ----
  const c = stats?.counts ?? {};
  const totalInView = Object.values(c).reduce((a, b) => a + b, 0);
  const finished = (c.done ?? 0) + (c.failed ?? 0) + (c.paused ?? 0);
  const inFlight = (c.queued ?? 0) + (c.processing ?? 0);

  const rawColumns = useMemo(() => {
    if (!upload) return [];
    const sheets = sheet ? upload.sheets.filter((s) => s.name === sheet) : upload.sheets;
    const skip = new Set(sheets.map((s) => s.mapping.company).filter(Boolean));
    return [...new Set(sheets.flatMap((s) => s.columns))].filter((col) => !skip.has(col));
  }, [upload, sheet]);

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  if (uploads === null)
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelLoader className="scale-150" />
      </div>
    );

  if (!upload)
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
          <h2 className="text-[18px] font-semibold tracking-tight">{uploadsError ? "Can't reach the database" : "Upload a lead list"}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {uploadsError ?? "A CSV or Excel file with company names (websites optional). You'll review every row first, then enrich in the background."}
          </p>
          {!uploadsError && (
            <Button variant="primary" className="mt-5" onClick={openUpload}>
              <Plus size={14} /> New upload
            </Button>
          )}
        </motion.div>
      </div>
    );

  return (
    <>
      <div className="border-b border-line">
        <PageHeader
          title={upload.filename}
          subtitle={
            stats?.worker.alive || inFlight ? (
              <>
                <PixelLoader /> <span className="shimmer-text font-medium">Enriching in the background · {inFlight.toLocaleString()} left</span>
              </>
            ) : (
              <span>
                {upload.total_rows.toLocaleString()} rows · {upload.sheets.length} sheet{upload.sheets.length > 1 ? "s" : ""} · imported {timeAgo(upload.created_at)}
              </span>
            )
          }
          actions={
            <>
              {inFlight > 0 && (
                <Button onClick={stop} disabled={busy === "stop"}>
                  <Pause size={13} /> Stop queue
                </Button>
              )}
              <Button onClick={() => setShowExport(true)}>
                <Download size={13} /> Export
              </Button>
              <Button variant={showActivity ? "secondary" : "ghost"} onClick={() => setShowActivity((v) => !v)} title="Live activity">
                <Activity size={13} />
              </Button>
            </>
          }
        />

        <div className="px-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Leads" value={totalInView} />
            <Stat label="Enriched" value={c.done ?? 0} />
            <Stat label="Founders found" value={stats?.found.founders ?? 0} />
            <Stat label="Founder emails" value={stats?.found.emails ?? 0} />
            <Stat label="In queue" value={inFlight} live={inFlight > 0} />
            <Stat label="Paused · Failed" value={`${(c.paused ?? 0).toLocaleString()} · ${(c.failed ?? 0).toLocaleString()}`} />
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2">
            <div className={cx("h-full rounded-full bg-ink transition-[width] duration-700 ease-out", inFlight > 0 && "progress-live")} style={{ width: `${totalInView ? (finished / totalInView) * 100 : 0}%` }} />
          </div>

          {upload.sheets.length > 1 ? (
            <div className="-mb-px mt-3 flex gap-1 overflow-x-auto">
              {[{ name: null as string | null, rows: upload.total_rows }, ...upload.sheets.map((s) => ({ name: s.name as string | null, rows: s.rows }))].map((s) => (
                <button key={s.name ?? "__all"} onClick={() => setSheet(s.name)} className={cx("relative whitespace-nowrap px-3 pb-2.5 pt-1 text-[13px]", sheet === s.name ? "text-ink" : "text-muted hover:text-ink-2")}>
                  {s.name ?? "All sheets"} <span className="ml-1 text-[11px] text-muted tabular-nums">{s.rows.toLocaleString()}</span>
                  {sheet === s.name && <motion.span layoutId="sheet-tab" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-3" />
          )}
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, domain, founder" className="h-8 w-64 rounded-lg border border-line-strong bg-white pl-8 pr-3 text-[13px] outline-none placeholder:text-muted focus:border-ink" />
        </div>
        <div className="flex rounded-lg bg-panel p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatus(f.key)} className={cx("rounded-md px-2.5 py-1 text-[12px] transition-colors", status === f.key ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink-2")}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => setOnlyEmail((v) => !v)} className={cx("h-8 rounded-lg border px-2.5 text-[12px]", onlyEmail ? "border-ink bg-ink text-white" : "border-line-strong text-ink-2 hover:bg-panel")}>
          Has founder email
        </button>

        <div className="ml-auto flex items-center gap-2">
          {(c.failed ?? 0) > 0 && (
            <Button variant="ghost" onClick={() => enrich("failed")} disabled={!!busy}>
              <RotateCcw size={13} /> Retry failed
            </Button>
          )}
          {(c.paused ?? 0) > 0 && (
            <Button variant="ghost" onClick={() => enrich("paused")} disabled={!!busy}>
              <Play size={13} /> Resume paused
            </Button>
          )}
          {selected.size > 0 && (
            <Button onClick={() => setWizardIds([...selected])}>
              <Send size={13} /> Add {selected.size} to outreach
            </Button>
          )}
          {selected.size > 0 ? (
            <Button variant="primary" onClick={() => enrich("all", [...selected])} disabled={!!busy}>
              <Sparkles size={13} /> Enrich {selected.size} selected
            </Button>
          ) : (
            <Button variant="primary" onClick={() => enrich("new")} disabled={!!busy || !(c.new ?? 0)}>
              {busy === "new" ? <PixelLoader className="[&>span]:bg-white" /> : <Sparkles size={13} />}
              Enrich {(c.new ?? 0) ? `${(c.new ?? 0).toLocaleString()} leads` : "all"}
            </Button>
          )}
        </div>
      </div>

      {/* table + activity */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
              <thead className="sticky top-0 z-20">
                <tr className="text-left text-[11.5px] text-muted">
                  <Th className="sticky left-0 z-30 w-10 pl-6">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (allOnPageSelected) rows.forEach((r) => n.delete(r.id));
                          else rows.forEach((r) => n.add(r.id));
                          return n;
                        })
                      }
                      className="accent-[#1f1f1f]"
                    />
                  </Th>
                  <Th className="sticky left-10 z-30 min-w-[220px]">Company</Th>
                  <Th className="min-w-[170px]">Status</Th>
                  <Th className="min-w-[200px]">Founder</Th>
                  <Th className="min-w-[260px]">Founder email</Th>
                  <Th className="min-w-[200px]">Company contact</Th>
                  {rawColumns.map((col) => (
                    <Th key={col} className="max-w-[220px] text-muted/80">
                      {col}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <LeadRow key={r.id} r={r} rawColumns={rawColumns} selected={selected.has(r.id)} flashing={flash.has(r.id)} onOpen={openRow} onToggle={toggleRow} />
                ))}
              </tbody>
            </table>
            {!loadingRows && rows.length === 0 && <div className="py-16 text-center text-[13px] text-muted">No leads match these filters.</div>}
            {loadingRows && rows.length === 0 && (
              <div className="flex justify-center py-16">
                <PixelLoader className="scale-150" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line px-6 py-2 text-[12px] text-muted">
            <span>
              {selected.size > 0 ? (
                <>
                  {selected.size} selected ·{" "}
                  <button className="underline hover:text-ink" onClick={() => setSelected(new Set())}>
                    clear
                  </button>
                </>
              ) : total ? (
                `${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString()} of ${total.toLocaleString()}`
              ) : (
                "0 leads"
              )}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={14} />
              </Button>
              <span className="tabular-nums">
                {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </div>

        {showActivity && (
          <aside className="w-[320px] shrink-0 overflow-hidden border-l border-line bg-panel/40">
            <ActivityRail stats={stats} onOpen={openRow} />
          </aside>
        )}
      </div>

      <ExportBuilder open={showExport} onClose={() => setShowExport(false)} upload={upload} sheet={sheet} onDone={setToast} />
      <CampaignWizard open={!!wizardIds} onClose={() => setWizardIds(null)} initial={wizardInitial} />
      <LeadDrawer id={drawer} onClose={() => setDrawer(null)} onRerun={(id) => enrich("all", [id])} />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-accent px-4 py-2.5 text-[13px] text-white shadow-lg">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------- pieces ----------

const LeadRow = memo(function LeadRow({ r, rawColumns, selected, flashing, onOpen, onToggle }: { r: Row; rawColumns: string[]; selected: boolean; flashing: boolean; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const done = r.status === "done";
  return (
    <tr onClick={() => onOpen(r.id)} className={cx("group cursor-pointer transition-colors duration-700", flashing ? "bg-[#f1f8f3]" : selected ? "bg-panel/70" : "hover:bg-panel/70")}>
      <Td className="sticky left-0 z-10 bg-white pl-6 group-hover:bg-panel" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggle(r.id)} className="accent-[#1f1f1f]" />
      </Td>
      <Td className="sticky left-10 z-10 bg-white group-hover:bg-panel">
        <div className="max-w-[260px] truncate font-medium text-ink">{r.company_name || <span className="text-muted">—</span>}</div>
        <div className="truncate font-mono text-[11px] text-muted">{r.domain || r.domain_input || (done ? "domain not found" : "")}</div>
      </Td>
      <Td>
        <StatusPill status={r.status} stage={r.stage} />
        {r.status === "paused" && r.paused_reason && <div className="mt-0.5 text-[10.5px] text-muted">{r.paused_reason}</div>}
      </Td>
      <Td>
        {r.founder_name ? (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0">
              <div className="max-w-[200px] truncate text-ink">{r.founder_name}</div>
              <div className="max-w-[200px] truncate text-[11px] text-muted">{r.founder_title}</div>
            </div>
            {r.founder_linkedin && (
              <a href={r.founder_linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[#0a66c2] opacity-80 hover:opacity-100">
                <LinkedInIcon size={12} />
              </a>
            )}
          </div>
        ) : (
          <Dash done={done} />
        )}
      </Td>
      <Td>
        {r.founder_email ? (
          <div className="flex items-center gap-2">
            <span className="max-w-[190px] truncate font-mono text-[11.5px] text-ink">{r.founder_email}</span>
            <EmailStatus status={r.founder_email_status} />
          </div>
        ) : (
          <Dash done={done} />
        )}
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          {r.company_linkedin && (
            <a href={r.company_linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[#0a66c2] opacity-80 hover:opacity-100" title="Company LinkedIn">
              <LinkedInIcon size={12} />
            </a>
          )}
          {r.generic_emails?.length ? <span className="max-w-[160px] truncate font-mono text-[11.5px] text-ink-2">{r.generic_emails[0]}</span> : null}
          {(r.generic_emails?.length ?? 0) > 1 && <Pill>+{r.generic_emails.length - 1}</Pill>}
          {!r.company_linkedin && !r.generic_emails?.length && <Dash done={done} />}
        </div>
      </Td>
      {rawColumns.map((col) => (
        <Td key={col} className="max-w-[220px] truncate text-ink-2">
          {r.raw?.[col] != null ? String(r.raw[col]) : ""}
        </Td>
      ))}
    </tr>
  );
});

function ActivityRail({ stats, onOpen }: { stats: Stats | null; onOpen: (id: string) => void }) {
  return (
    <div className="flex h-full w-[320px] flex-col">
      <div className="px-4 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted">Running now</div>
      <div className="space-y-1 px-3">
        {(stats?.active ?? []).length === 0 && <div className="px-1 pb-1 text-[12px] text-muted">{stats?.worker.alive ? "Picking the next leads…" : "Idle"}</div>}
        {(stats?.active ?? []).map((a) => (
          <button key={a.id} onClick={() => onOpen(a.id)} className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-white px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <PixelLoader />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{a.company_name || a.domain || `Row ${a.row_index + 1}`}</span>
              <span className="shimmer-text block truncate text-[11.5px]">{a.stage || "Starting"}…</span>
            </span>
          </button>
        ))}
      </div>
      <div className="px-4 pb-2 pt-5 text-[11px] font-medium uppercase tracking-wide text-muted">Activity</div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {(stats?.events ?? []).length === 0 && <div className="px-1 text-[12px] text-muted">Events show up here while leads are enriched.</div>}
        <ol>
          {(stats?.events ?? []).map((e) => {
            const [who, ...rest] = e.message.split(" — ");
            return (
              <li key={e.id} className="flex gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white">
                <span className={cx("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", e.level === "success" ? "bg-[#3a9a5b]" : e.level === "warn" ? "bg-[#d39a2c]" : e.level === "error" ? "bg-[#c4554f]" : "bg-line-strong")} />
                <button className="min-w-0 flex-1 text-left" onClick={() => e.lead_id && onOpen(e.lead_id)}>
                  <span className="block truncate text-[12px] font-medium text-ink">{who}</span>
                  <span className="block text-[11.5px] leading-snug text-ink-2">{rest.join(" — ")}</span>
                </button>
                <span className="shrink-0 pt-px text-[10.5px] text-muted tabular-nums">{timeAgo(e.at)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, live }: { label: string; value: number | string; live?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {label} {live && <PixelLoader className="scale-75" />}
      </div>
      <div className="mt-0.5 text-[19px] font-semibold tabular-nums tracking-tight">{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap border-b border-line bg-white px-3 py-2 font-medium", className)}>{children}</th>;
}

function Td({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <td onClick={onClick} className={cx("whitespace-nowrap border-b border-line px-3 py-2 align-middle", className)}>
      {children}
    </td>
  );
}

function Dash({ done }: { done: boolean }) {
  return <span className={cx("text-[12px]", done ? "text-muted" : "text-line-strong")}>{done ? "Not found" : "—"}</span>;
}
