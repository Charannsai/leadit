"use client";

import { motion } from "motion/react";
import { Check, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { importSheets, parseFile, type ParsedSheet } from "@/lib/client";
import type { ColumnMapping } from "@/lib/types";
import { Button, Modal, PixelLoader, cx } from "./ui";

const FIELDS: { key: keyof ColumnMapping; label: string; hint: string; required?: boolean }[] = [
  { key: "company", label: "Company name", hint: "Required", required: true },
  { key: "website", label: "Website / domain", hint: "Found automatically if empty" },
  { key: "location", label: "Location", hint: "Helps match the right company" },
];

export function UploadModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<"pick" | "parsing" | "map" | "importing">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setSheets([]);
    setActive(0);
    setPhase("pick");
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (phase === "importing") return;
    reset();
    onClose();
  }, [phase, reset, onClose]);

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    setPhase("parsing");
    try {
      const parsed = await parseFile(f);
      if (!parsed.length) throw new Error("No rows found in this file.");
      setSheets(parsed);
      setPhase("map");
    } catch (e) {
      setError((e as Error).message);
      setPhase("pick");
    }
  }

  async function doImport() {
    if (!file) return;
    setPhase("importing");
    try {
      const id = await importSheets(file.name, sheets, (done, total) => setProgress({ done, total }));
      reset();
      onImported(id);
    } catch (e) {
      setError((e as Error).message);
      setPhase("map");
    }
  }

  const setMapping = (i: number, key: keyof ColumnMapping, value: string) =>
    setSheets((s) => s.map((sh, j) => (j === i ? { ...sh, mapping: { ...sh.mapping, [key]: value || undefined } } : sh)));
  const toggle = (i: number) => setSheets((s) => s.map((sh, j) => (j === i ? { ...sh, include: !sh.include } : sh)));

  const ready = sheets.filter((s) => s.include && s.mapping.company);
  const totalRows = ready.reduce((n, s) => n + s.rows.length, 0);
  const sheet = sheets[active];

  return (
    <Modal open={open} onClose={close} width={phase === "map" || phase === "importing" ? 920 : 560} title={phase === "map" || phase === "importing" ? file?.name : "Import leads"}>
      {(phase === "pick" || phase === "parsing") && (
        <div className="p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => input.current?.click()}
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center transition-colors",
              drag ? "border-ink bg-panel" : "border-line-strong bg-panel/60 hover:bg-panel",
            )}
          >
            {phase === "parsing" ? (
              <>
                <PixelLoader className="scale-150" />
                <div className="shimmer-text text-[13px] font-medium">Reading {file?.name}</div>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white shadow-sm">
                  <UploadCloud size={18} className="text-ink-2" />
                </div>
                <div>
                  <div className="text-[13.5px] font-medium">Drop a CSV or Excel file</div>
                  <div className="mt-1 text-[12px] text-muted">Every sheet in a workbook is imported separately · up to 50k+ rows</div>
                </div>
              </>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.xlsm,.ods"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {error && <div className="mt-3 rounded-lg bg-[#fdeeee] px-3 py-2 text-[12.5px] text-[#b4403b]">{error}</div>}
        </div>
      )}

      {(phase === "map" || phase === "importing") && sheet && (
        <>
          <div className="flex min-h-0 flex-1">
            {/* sheet list */}
            <div className="scroll-thin w-56 shrink-0 overflow-y-auto border-r border-line bg-panel/60 p-2">
              <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted">Sheets</div>
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => setActive(i)}
                  className={cx("relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]", i === active ? "text-ink" : "text-ink-2 hover:text-ink")}
                >
                  {i === active && <motion.span layoutId="sheet-active" className="absolute inset-0 rounded-lg border border-line bg-white shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(i);
                    }}
                    className={cx("relative flex h-4 w-4 shrink-0 items-center justify-center rounded border", s.include ? "border-ink bg-ink text-white" : "border-line-strong bg-white")}
                  >
                    {s.include && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="relative min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="relative text-[11px] tabular-nums text-muted">{s.rows.length.toLocaleString()}</span>
                </button>
              ))}
            </div>

            {/* mapping + preview */}
            <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-5">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
                <FileSpreadsheet size={15} className="text-muted" /> {sheet.name}
                <span className="font-normal text-muted">· {sheet.columns.length} columns</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <div className="mb-1 text-[12px] font-medium text-ink-2">
                      {f.label}
                      {f.required && <span className="text-[#b4403b]"> *</span>}
                    </div>
                    <select
                      value={sheet.mapping[f.key] ?? ""}
                      onChange={(e) => setMapping(active, f.key, e.target.value)}
                      className={cx(
                        "h-8 w-full rounded-lg border bg-white px-2 text-[13px] outline-none focus:border-ink",
                        f.required && !sheet.mapping[f.key] ? "border-[#e8b4b1]" : "border-line-strong",
                      )}
                    >
                      <option value="">— none —</option>
                      {sheet.columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[11px] text-muted">{f.hint}</div>
                  </label>
                ))}
              </div>

              <div className="mt-5 overflow-hidden rounded-xl border border-line">
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-panel/70 text-left text-muted">
                        {sheet.columns.slice(0, 8).map((c) => (
                          <th key={c} className="whitespace-nowrap border-b border-line px-3 py-2 font-medium">
                            {c}
                            {Object.entries(sheet.mapping).find(([, v]) => v === c) && (
                              <span className="ml-1.5 rounded bg-ink px-1 py-px text-[10px] text-white">{Object.entries(sheet.mapping).find(([, v]) => v === c)![0]}</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(0, 6).map((r, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          {sheet.columns.slice(0, 8).map((c) => (
                            <td key={c} className="max-w-[180px] truncate whitespace-nowrap px-3 py-2 text-ink-2">
                              {String(r[c] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {sheet.rows.length > 6 && <div className="mt-2 text-[11.5px] text-muted">Showing 6 of {sheet.rows.length.toLocaleString()} rows</div>}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <div className="min-w-0 flex-1 text-[12.5px] text-muted">
              {phase === "importing" ? (
                <div className="flex items-center gap-3">
                  <div className="h-1 w-48 overflow-hidden rounded-full bg-panel-2">
                    <motion.div className="progress-live h-full rounded-full bg-ink" animate={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                  </div>
                  <span className="tabular-nums">
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()} rows
                  </span>
                </div>
              ) : error ? (
                <span className="text-[#b4403b]">{error}</span>
              ) : (
                <>
                  {ready.length} of {sheets.length} sheet{sheets.length > 1 ? "s" : ""} · {totalRows.toLocaleString()} rows
                  {sheets.some((s) => s.include && !s.mapping.company) && <span className="text-[#946215]"> · pick a company column for every included sheet</span>}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset} disabled={phase === "importing"}>
                Choose another file
              </Button>
              <Button variant="primary" onClick={doImport} disabled={!ready.length || phase === "importing" || sheets.some((s) => s.include && !s.mapping.company)}>
                {phase === "importing" ? <PixelLoader className="[&>span]:bg-white" /> : null}
                Import {totalRows.toLocaleString()} rows
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
