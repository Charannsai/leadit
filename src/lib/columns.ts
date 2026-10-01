import type { ColumnMapping } from "./types";

// Header keywords per field, most specific first. Matching is on a normalized header.
const RULES: { field: keyof ColumnMapping; exact: string[]; contains: string[]; avoid?: string[] }[] = [
  {
    field: "company",
    exact: ["company", "companyname", "company_name", "name", "organization", "organisation", "account", "accountname", "business", "businessname", "brand", "startup", "firm", "lead", "client"],
    contains: ["company", "organi", "business", "startup", "brand", "account"],
    avoid: ["url", "website", "domain", "linkedin", "size", "type", "id", "phone", "email", "address", "industry", "revenue", "employees"],
  },
  {
    field: "website",
    exact: ["website", "domain", "url", "site", "web", "homepage", "companywebsite", "companydomain", "companyurl", "websiteurl"],
    contains: ["website", "domain", "homepage", "url", "site"],
    avoid: ["linkedin", "twitter", "facebook", "instagram", "crunchbase", "logo", "image", "search", "companieshouse", "check"],
  },
  {
    field: "location",
    exact: ["location", "city", "country", "hq", "headquarters", "address", "region", "state"],
    contains: ["location", "headquart", "city", "country", "address", "region", "office", "postcode", "zip"],
    avoid: ["email", "ip"],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function detectMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const rule of RULES) {
    const candidates = columns.filter((c) => !used.has(c));
    const avoid = (c: string) => (rule.avoid ?? []).some((a) => norm(c).includes(a));
    const hit =
      candidates.find((c) => rule.exact.includes(norm(c))) ??
      candidates.find((c) => !avoid(c) && rule.contains.some((k) => norm(c).includes(k)));
    if (hit) {
      mapping[rule.field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/**
 * Turns a sheet's raw rows (array of arrays) into header + objects. The header row is the
 * first of the top 10 rows with at least two filled cells, so title rows above a table are skipped.
 */
export function rowsToObjects(matrix: unknown[][]): { columns: string[]; rows: Record<string, unknown>[] } {
  const filled = (r: unknown[]) => r.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").length;
  let headerIdx = matrix.slice(0, 10).findIndex((r) => filled(r) >= 2);
  if (headerIdx < 0) headerIdx = matrix.findIndex((r) => filled(r) >= 1);
  if (headerIdx < 0) return { columns: [], rows: [] };

  const seen = new Map<string, number>();
  const columns = matrix[headerIdx].map((h, i) => {
    let name = String(h ?? "").trim() || `Column ${i + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });

  const rows: Record<string, unknown>[] = [];
  for (const r of matrix.slice(headerIdx + 1)) {
    if (!r || filled(r) === 0) continue;
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      const v = r[i];
      if (v !== null && v !== undefined && String(v).trim() !== "") obj[c] = typeof v === "string" ? v.trim() : v;
    });
    rows.push(obj);
  }
  return { columns, rows };
}
