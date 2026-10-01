"use client";

import { Reorder, useDragControls } from "motion/react";
import { Bookmark, Check, Download, GripVertical, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, exportUpload, type ExportColumn } from "@/lib/client";
import { ENRICHED_COLUMNS, filtersToParams, type ExportFilters } from "@/lib/exportColumns";
import type { Upload } from "@/lib/types";
import { Button, Modal, PixelLoader, cx } from "./ui";

const STATUS_OPTS = [
  ["done", "Enriched"],
  ["new", "Not enriched"],
  ["paused", "Paused"],
  ["failed", "Failed"],
] as const;
const OUTCOME_OPTS = [
  ["founder", "Founder found"],
  ["company", "Company contacts only"],
  ["none", "Nothing found"],
] as const;
const EMAIL_OPTS = [
  ["valid", "Verified"],
  ["accept_all", "Catch-all"],
  ["unknown", "Unknown"],
  ["unverified", "Unverified"],
  ["invalid", "Invalid"],
  ["none", "No founder email"],
] as const;

interface Config {
  columns: string[];
  filters: ExportFilters;
  format: "xlsx" | "csv";
  layout: "per-sheet" | "single";
}

interface Preset extends Config {
  name: string;
}

const PRESETS_KEY = "le:export-presets";
const lastKey = (uploadId: string) => `le:export-last:${uploadId}`;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function ExportBuilder({ open, onClose, upload, sheet, onDone }: { open: boolean; onClose: () => void; upload: Upload; sheet: string | null; onDone: (msg: string) => void }) {
  // Every column this upload can export.
  const allColumns = useMemo(() => {
    const raw = [...new Set(upload.sheets.flatMap((s) => s.columns))];
    const cols: (ExportColumn & { group: string; default?: boolean })[] = [];
    if (upload.sheets.length > 1) cols.push({ id: "meta:sheet", label: "Sheet", group: "Original", default: true });
    for (const r of raw) cols.push({ id: `raw:${r}`, label: r, group: "Original", default: true });
    for (const c of ENRICHED_COLUMNS) cols.push({ id: `enr:${c.key}`, label: raw.includes(c.key) ? `${c.key} (enriched)` : c.key, group: c.group, default: c.default });
    return cols;
  }, [upload]);
  const byId = useMemo(() => new Map(allColumns.map((c) => [c.id, c])), [allColumns]);

  const defaults = useMemo<Config>(
    () => ({ columns: allColumns.filter((c) => c.default).map((c) => c.id), filters: { sheets: sheet ? [sheet] : [] }, format: "xlsx", layout: "per-sheet" }),
    [allColumns, sheet],
  );

  const [cfg, setCfg] = useState<Config>(defaults);
  const [filename, setFilename] = useState("");
  const [search, setSearch] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    if (!open) return;
    const last = load<Config | null>(lastKey(upload.id), null);
    const start = last ? { ...last, columns: last.columns.filter((id) => byId.has(id)), filters: { ...last.filters, sheets: sheet ? [sheet] : last.filters.sheets } } : defaults;
    setCfg(start);
    setFilename(upload.filename.replace(/\.[^.]+$/, "") + "-enriched");
    setPresets(load<Preset[]>(PRESETS_KEY, []));
    setProgress(null);
  }, [open, upload, sheet, defaults, byId]);

  // Live count of matching rows.
  useEffect(() => {
    if (!open) return;
    setCount(null);
    const t = setTimeout(() => {
      const qs = filtersToParams(cfg.filters, new URLSearchParams({ upload: upload.id, count: "1" }));
      api<{ count: number }>(`/api/export?${qs}`).then((r) => setCount(r.count)).catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(t);
  }, [open, cfg.filters, upload.id]);

  const setFilters = (patch: Partial<ExportFilters>) => setCfg((c) => ({ ...c, filters: { ...c.filters, ...patch } }));
  const toggleIn = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const toggleColumn = (id: string) => setCfg((c) => ({ ...c, columns: c.columns.includes(id) ? c.columns.filter((x) => x !== id) : [...c.columns, id] }));

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const m = new Map<string, typeof allColumns>();
    for (const c of allColumns) if (!q || c.label.toLowerCase().includes(q)) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [allColumns, search]);

  async function run() {
    setProgress(0);
    try {
      store(lastKey(upload.id), cfg);
      const n = await exportUpload(
        upload,
        { ...cfg, filename, columns: cfg.columns.map((id) => byId.get(id)!).filter(Boolean) },
        (k) => setProgress(k),
      );
      onDone(`Exported ${n.toLocaleString()} rows`);
      onClose();
    } catch (e) {
      onDone((e as Error).message);
      setProgress(null);
    }
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, ...cfg, filters: { ...cfg.filters, sheets: [] } }];
    setPresets(next);
    store(PRESETS_KEY, next);
    setPresetName("");
  }
  function applyPreset(p: Preset) {
    setCfg({ ...p, columns: p.columns.filter((id) => byId.has(id)), filters: { ...p.filters, sheets: cfg.filters.sheets } });
  }
  function deletePreset(name: string) {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    store(PRESETS_KEY, next);
  }

  const busy = progress !== null;

  return (
    <Modal open={open} onClose={() => !busy && onClose()} width={1040} title="Export leads">
      <div className="flex min-h-0 flex-1">
        {/* ---- filters & format ---- */}
        <div className="scroll-thin w-72 shrink-0 space-y-5 overflow-y-auto border-r border-line bg-panel/50 p-4">
          {presets.length > 0 && (
            <Group title="Presets">
              <div className="space-y-1">
                {presets.map((p) => (
                  <div key={p.name} className="group flex items-center gap-1">
                    <button onClick={() => applyPreset(p)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white">
                      <Bookmark size={12} className="shrink-0 text-muted" />
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto text-[11px] text-muted">{p.columns.length} cols</span>
                    </button>
                    <button onClick={() => deletePreset(p.name)} className="hidden rounded p-1 text-muted hover:text-[#b4403b] group-hover:block" title="Delete preset">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </Group>
          )}

          {upload.sheets.length > 1 && (
            <Group title="Sheets" hint={cfg.filters.sheets?.length ? undefined : "All sheets"}>
              <Chips options={upload.sheets.map((s) => [s.name, s.name] as const)} value={cfg.filters.sheets} onToggle={(v) => setFilters({ sheets: toggleIn(cfg.filters.sheets, v) })} />
            </Group>
          )}
          <Group title="Enrich status" hint={cfg.filters.statuses?.length ? undefined : "Any"}>
            <Chips options={STATUS_OPTS} value={cfg.filters.statuses} onToggle={(v) => setFilters({ statuses: toggleIn(cfg.filters.statuses, v) })} />
          </Group>
          <Group title="Result" hint={cfg.filters.outcomes?.length ? undefined : "Any"}>
            <Chips options={OUTCOME_OPTS} value={cfg.filters.outcomes} onToggle={(v) => setFilters({ outcomes: toggleIn(cfg.filters.outcomes, v) })} />
          </Group>
          <Group title="Founder email" hint={cfg.filters.emailStatuses?.length ? undefined : "Any"}>
            <Chips options={EMAIL_OPTS} value={cfg.filters.emailStatuses} onToggle={(v) => setFilters({ emailStatuses: toggleIn(cfg.filters.emailStatuses, v) })} />
          </Group>
          <Group title="More">
            <label onClick={() => setFilters({ anyEmail: !cfg.filters.anyEmail })} className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-ink-2">
              <Box checked={!!cfg.filters.anyEmail} />
              Has at least one email
            </label>
            <div className="mt-2 text-[12px] text-ink-2">
              <div className="mb-1 flex justify-between">
                <span>Minimum confidence</span>
                <span className="tabular-nums text-muted">{cfg.filters.minConfidence || 0}</span>
              </div>
              <input type="range" min={0} max={95} step={5} value={cfg.filters.minConfidence || 0} onChange={(e) => setFilters({ minConfidence: Number(e.target.value) })} className="w-full accent-[#1f1f1f]" />
            </div>
            <input
              value={cfg.filters.q ?? ""}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Company, domain or founder contains…"
              className="mt-2 h-8 w-full rounded-lg border border-line-strong bg-white px-2.5 text-[12.5px] outline-none placeholder:text-muted focus:border-ink"
            />
          </Group>
          <Group title="Format">
            <Segmented value={cfg.format} options={[["xlsx", "Excel"], ["csv", "CSV"]]} onChange={(v) => setCfg((c) => ({ ...c, format: v as Config["format"] }))} />
            {cfg.format === "xlsx" && (
              <div className="mt-2">
                <Segmented value={cfg.layout} options={[["per-sheet", "Tab per sheet"], ["single", "One tab"]]} onChange={(v) => setCfg((c) => ({ ...c, layout: v as Config["layout"] }))} />
              </div>
            )}
          </Group>
        </div>

        {/* ---- columns ---- */}
        <div className="flex min-w-0 flex-1">
          <div className="flex w-1/2 min-w-0 flex-col border-r border-line">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <Search size={13} className="text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a column" className="h-6 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted" />
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
              {groups.map(([group, cols]) => {
                const allOn = cols.every((c) => cfg.columns.includes(c.id));
                return (
                  <div key={group} className="mb-2">
                    <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{group}</span>
                      <button
                        className="text-[11px] text-muted hover:text-ink"
                        onClick={() =>
                          setCfg((c) => ({
                            ...c,
                            columns: allOn ? c.columns.filter((id) => !cols.some((x) => x.id === id)) : [...c.columns, ...cols.map((x) => x.id).filter((id) => !c.columns.includes(id))],
                          }))
                        }
                      >
                        {allOn ? "None" : "All"}
                      </button>
                    </div>
                    {cols.map((c) => (
                      <label key={c.id} onClick={() => toggleColumn(c.id)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-panel">
                        <Box checked={cfg.columns.includes(c.id)} />
                        <span className="truncate">{c.label}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex w-1/2 min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[12.5px]">
              <span className="font-medium">
                {cfg.columns.length} columns <span className="font-normal text-muted">· drag to reorder</span>
              </span>
              <div className="flex gap-2 text-[11.5px] text-muted">
                <button className="hover:text-ink" onClick={() => setCfg((c) => ({ ...c, columns: defaults.columns }))}>
                  Reset
                </button>
                <button className="hover:text-ink" onClick={() => setCfg((c) => ({ ...c, columns: [] }))}>
                  Clear
                </button>
              </div>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
              {cfg.columns.length === 0 && <div className="px-2 py-6 text-center text-[12.5px] text-muted">Pick columns on the left.</div>}
              <Reorder.Group axis="y" values={cfg.columns} onReorder={(columns) => setCfg((c) => ({ ...c, columns }))} className="space-y-1">
                {cfg.columns.map((id) => (
                  <ColumnItem key={id} id={id} label={byId.get(id)?.label ?? id} group={byId.get(id)?.group ?? ""} onRemove={() => toggleColumn(id)} />
                ))}
              </Reorder.Group>
            </div>
          </div>
        </div>
      </div>

      {/* ---- footer ---- */}
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <div className="flex items-center gap-1.5">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
            placeholder="Save as preset…"
            className="h-8 w-40 rounded-lg border border-line-strong px-2.5 text-[12.5px] outline-none placeholder:text-muted focus:border-ink"
          />
          <Button size="sm" variant="ghost" onClick={savePreset} disabled={!presetName.trim()}>
            <Bookmark size={12} /> Save
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12.5px] text-muted tabular-nums">
            {busy ? `Fetching ${progress!.toLocaleString()}${count ? ` / ${count.toLocaleString()}` : ""} rows…` : count === null ? <PixelLoader /> : `${count.toLocaleString()} rows match`}
          </span>
          <div className="flex items-center rounded-lg border border-line-strong">
            <input value={filename} onChange={(e) => setFilename(e.target.value)} className="h-8 w-56 rounded-l-lg px-2.5 text-[12.5px] outline-none" />
            <span className="pr-2.5 text-[12px] text-muted">.{cfg.format}</span>
          </div>
          <Button variant="primary" onClick={run} disabled={busy || !cfg.columns.length || count === 0}>
            {busy ? <PixelLoader className="[&>span]:bg-white" /> : <Download size={13} />} Export
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ColumnItem({ id, label, group, onRemove }: { id: string; label: string; group: string; onRemove: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className="flex select-none items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] shadow-[0_1px_1px_rgba(0,0,0,0.02)]" whileDrag={{ scale: 1.02, boxShadow: "0 8px 20px -6px rgba(0,0,0,0.18)" }}>
      <span onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none text-muted active:cursor-grabbing">
        <GripVertical size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[10.5px] text-muted">{group}</span>
      <button onClick={onRemove} className="rounded p-0.5 text-muted hover:bg-panel hover:text-ink" title="Remove column">
        <X size={12} />
      </button>
    </Reorder.Item>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Chips({ options, value, onToggle }: { options: readonly (readonly [string, string])[]; value?: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => {
        const on = value?.includes(v);
        return (
          <button key={v} onClick={() => onToggle(v)} className={cx("inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[12px] transition-colors", on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink-2 hover:border-ink-2")}>
            {on && <Check size={11} strokeWidth={3} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg bg-panel-2 p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cx("flex-1 rounded-md py-1 text-[12px]", value === v ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink-2")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors", checked ? "border-ink bg-ink text-white" : "border-line-strong bg-white")}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  );
}
