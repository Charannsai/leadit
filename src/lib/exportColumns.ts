import type { Lead } from "./types";

// Every enriched column an export can include. Shared by the export API (values) and the
// export builder (labels and groups), so the two never drift apart.

export type ColumnGroup = "Founder" | "Company" | "Contacts" | "Status";

export interface EnrichedColumn {
  key: string;
  group: ColumnGroup;
  get: (l: Lead) => string | number;
  /** Selected by default in a fresh export. */
  default?: boolean;
}

const founder = (l: Lead, i = 0) => l.profile?.founders?.[i];
const company = (l: Lead) => l.profile?.company ?? {};

export const ENRICHED_COLUMNS: EnrichedColumn[] = [
  { key: "Founder Name", group: "Founder", get: (l) => founder(l)?.name ?? "", default: true },
  { key: "Founder Title", group: "Founder", get: (l) => founder(l)?.title ?? "", default: true },
  { key: "Founder LinkedIn", group: "Founder", get: (l) => founder(l)?.linkedin ?? "", default: true },
  { key: "Founder Email", group: "Founder", get: (l) => founder(l)?.email ?? "", default: true },
  { key: "Founder Email Status", group: "Founder", get: (l) => (founder(l)?.email ? founder(l)?.email_status ?? "" : ""), default: true },
  { key: "Founder Email Source", group: "Founder", get: (l) => founder(l)?.email_source ?? "" },
  { key: "Founder Location", group: "Founder", get: (l) => founder(l)?.location ?? "" },
  { key: "Founder Summary", group: "Founder", get: (l) => founder(l)?.summary ?? "" },
  { key: "Founder Twitter", group: "Founder", get: (l) => founder(l)?.twitter ?? "" },
  {
    key: "Other Founders", group: "Founder",
    get: (l) => (l.profile?.founders ?? []).slice(1).map((o) => [o.name, o.title, o.email, o.linkedin].filter(Boolean).join(" | ")).join("\n"),
  },

  { key: "Domain", group: "Company", get: (l) => l.domain ?? "", default: true },
  { key: "Company LinkedIn", group: "Company", get: (l) => l.company_linkedin ?? "", default: true },
  { key: "Industry", group: "Company", get: (l) => company(l).industry ?? "" },
  { key: "Employees", group: "Company", get: (l) => company(l).employees ?? "" },
  { key: "Founded", group: "Company", get: (l) => company(l).founded ?? "" },
  { key: "HQ", group: "Company", get: (l) => company(l).location ?? "" },
  { key: "Funding", group: "Company", get: (l) => company(l).funding ?? "" },
  { key: "Description", group: "Company", get: (l) => company(l).description ?? "" },
  { key: "Twitter", group: "Company", get: (l) => company(l).twitter ?? "" },
  { key: "Facebook", group: "Company", get: (l) => company(l).facebook ?? "" },
  { key: "Instagram", group: "Company", get: (l) => company(l).instagram ?? "" },

  { key: "Company Emails", group: "Contacts", get: (l) => (l.profile?.generic_emails ?? []).map((g) => g.email).join(", "), default: true },
  { key: "Company Phone", group: "Contacts", get: (l) => company(l).phone ?? "", default: true },
  { key: "Contact Page", group: "Contacts", get: (l) => company(l).contact_page ?? "" },
  { key: "Email Pattern", group: "Contacts", get: (l) => l.profile?.email_pattern ?? "" },

  { key: "Enrich Status", group: "Status", get: (l) => l.status, default: true },
  { key: "Result", group: "Status", get: (l) => l.outcome ?? "" },
  { key: "Confidence", group: "Status", get: (l) => l.confidence ?? "", default: true },
  { key: "Domain Source", group: "Status", get: (l) => l.domain_source ?? "" },
  { key: "Enriched At", group: "Status", get: (l) => (l.enriched_at ? new Date(l.enriched_at).toISOString().slice(0, 16).replace("T", " ") : "") },
  { key: "Notes", group: "Status", get: (l) => [l.paused_reason, l.error, ...(l.profile?.notes ?? [])].filter(Boolean).join("; ") },
];

export interface ExportFilters {
  sheets?: string[];
  statuses?: string[];
  outcomes?: string[];
  /** Founder email status; "none" means no founder email. */
  emailStatuses?: string[];
  anyEmail?: boolean;
  minConfidence?: number;
  q?: string;
}

export function filtersToParams(f: ExportFilters, qs = new URLSearchParams()) {
  if (f.sheets?.length) qs.set("sheets", f.sheets.join("\u001f"));
  if (f.statuses?.length) qs.set("statuses", f.statuses.join(","));
  if (f.outcomes?.length) qs.set("outcomes", f.outcomes.join(","));
  if (f.emailStatuses?.length) qs.set("email", f.emailStatuses.join(","));
  if (f.anyEmail) qs.set("anyEmail", "1");
  if (f.minConfidence) qs.set("minConf", String(f.minConfidence));
  if (f.q?.trim()) qs.set("q", f.q.trim());
  return qs;
}

export function paramsToFilters(p: URLSearchParams): ExportFilters {
  const list = (k: string, sep = ",") => p.get(k)?.split(sep).filter(Boolean);
  return {
    sheets: list("sheets", "\u001f"),
    statuses: list("statuses"),
    outcomes: list("outcomes"),
    emailStatuses: list("email"),
    anyEmail: p.get("anyEmail") === "1",
    minConfidence: Number(p.get("minConf") ?? 0) || 0,
    q: p.get("q") ?? undefined,
  };
}
