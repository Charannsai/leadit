import "server-only";
import type { ExportFilters } from "./exportColumns";

// Shared lead filters for exports and outreach audiences.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

export function applyFilters(q: Query, f: ExportFilters): Query {
  if (f.sheets?.length) q = q.in("sheet", f.sheets);
  if (f.statuses?.length) q = q.in("status", f.statuses);
  if (f.outcomes?.length) q = q.in("outcome", f.outcomes);
  if (f.emailStatuses?.length) {
    const statuses = f.emailStatuses.filter((s) => s !== "none");
    const parts = [];
    if (statuses.length) parts.push(`founder_email_status.in.(${statuses.join(",")})`);
    if (f.emailStatuses.includes("none")) parts.push("founder_email.is.null");
    q = q.or(parts.join(","));
  }
  if (f.anyEmail) q = q.or("founder_email.not.is.null,generic_emails.neq.{}");
  if (f.minConfidence) q = q.gte("confidence", f.minConfidence);
  if (f.q) {
    const s = f.q.replace(/[%,()]/g, " ");
    q = q.or(`company_name.ilike.%${s}%,domain.ilike.%${s}%,founder_name.ilike.%${s}%`);
  }
  return q;
}
