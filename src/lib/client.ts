"use client";

import * as XLSX from "xlsx";
import { detectMapping, rowsToObjects } from "./columns";
import { filtersToParams, type ExportFilters } from "./exportColumns";
import type { ColumnMapping, Upload } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface ParsedSheet {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  mapping: ColumnMapping;
  include: boolean;
}

/** Reads a CSV or Excel file in the browser. Every non-empty sheet becomes its own table. */
export async function parseFile(file: File): Promise<ParsedSheet[]> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(file.name);
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });

  const sheets: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: null, blankrows: false });
    const { columns, rows } = rowsToObjects(matrix);
    if (!rows.length) continue;
    const mapping = detectMapping(columns);
    sheets.push({ name: isCsv ? file.name.replace(/\.[^.]+$/, "") : name, columns, rows, mapping, include: true });
  }
  return sheets;
}

const CHUNK = 500;

/** Creates the upload, then sends each included sheet's rows in chunks. */
export async function importSheets(filename: string, sheets: ParsedSheet[], onProgress: (done: number, total: number) => void): Promise<string> {
  const included = sheets.filter((s) => s.include && s.mapping.company);
  const total = included.reduce((n, s) => n + s.rows.length, 0);
  const { id } = await api<{ id: string }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename,
      sheets: included.map((s) => ({ name: s.name, rows: s.rows.length, columns: s.columns, mapping: s.mapping })),
    }),
  });

  let done = 0;
  onProgress(0, total);
  for (const s of included) {
    for (let i = 0; i < s.rows.length; i += CHUNK) {
      const rows = s.rows.slice(i, i + CHUNK).map((raw, j) => ({ i: i + j, raw }));
      await api(`/api/uploads/${id}/rows`, { method: "POST", body: JSON.stringify({ sheet: s.name, mapping: s.mapping, rows }) });
      done += rows.length;
      onProgress(done, total);
    }
  }
  return id;
}

type ExportRow = { sheet: string; raw: Record<string, unknown>; enriched: Record<string, unknown> };

/** A column in an export: "raw:<sheet column>", "enr:<enriched key>" or "meta:sheet", with its header. */
export interface ExportColumn {
  id: string;
  label: string;
}

export interface ExportOptions {
  format: "xlsx" | "csv";
  /** xlsx only: one tab per original sheet, or everything in one tab. */
  layout: "per-sheet" | "single";
  filters: ExportFilters;
  columns: ExportColumn[];
  filename: string;
}

/** Fetches the matching rows page by page and downloads them with exactly the chosen columns. */
export async function exportUpload(upload: Upload, opts: ExportOptions, onProgress?: (n: number) => void): Promise<number> {
  const all: ExportRow[] = [];
  for (let page = 0; ; page++) {
    const qs = filtersToParams(opts.filters, new URLSearchParams({ upload: upload.id, page: String(page) }));
    const res = await api<{ rows: ExportRow[]; more: boolean }>(`/api/export?${qs}`);
    all.push(...res.rows);
    onProgress?.(all.length);
    if (!res.more) break;
  }

  // Duplicate headers would silently overwrite each other, so number them.
  const seen = new Map<string, number>();
  const cols = opts.columns.map((c) => {
    const n = seen.get(c.label) ?? 0;
    seen.set(c.label, n + 1);
    return { ...c, header: n ? `${c.label} (${n + 1})` : c.label };
  });
  const toRecord = (r: ExportRow) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      const [kind, ...rest] = c.id.split(":");
      const key = rest.join(":");
      out[c.header] = kind === "raw" ? r.raw?.[key] ?? "" : kind === "enr" ? r.enriched?.[key] ?? "" : r.sheet;
    }
    return out;
  };
  const header = cols.map((c) => c.header);
  const base = opts.filename.trim() || upload.filename.replace(/\.[^.]+$/, "") + "-enriched";

  if (opts.format === "csv") {
    const ws = XLSX.utils.json_to_sheet(all.map(toRecord), { header });
    const blob = new Blob(["\uFEFF" + XLSX.utils.sheet_to_csv(ws)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return all.length;
  }

  const wb = XLSX.utils.book_new();
  const groups = opts.layout === "single" ? new Map([["Leads", all]]) : new Map<string, ExportRow[]>();
  if (opts.layout === "per-sheet") for (const r of all) groups.set(r.sheet, [...(groups.get(r.sheet) ?? []), r]);
  if (!all.length) groups.set("Leads", []);
  for (const [name, rows] of groups) {
    const ws = XLSX.utils.json_to_sheet(rows.map(toRecord), { header });
    ws["!cols"] = header.map((h) => ({ wch: Math.min(48, Math.max(10, h.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31).replace(/[\/?*[\]:]/g, " ") || "Sheet");
  }
  XLSX.writeFile(wb, `${base}.xlsx`);
  return all.length;
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
