import "server-only";
import { db } from "../db";
import type { ExportFilters } from "../exportColumns";
import { applyFilters } from "../leadQuery";
import type { CampaignTarget } from "./types";

export interface Audience {
  uploadId: string;
  filters: ExportFilters;
  target: CampaignTarget;
  /** Leave out leads already contacted on this channel. */
  excludeContacted: boolean;
  /** Exactly these leads (e.g. rows ticked on the Leads page). Filters still apply. */
  ids?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

const notContacted = (key: string) => `outreach->>${key}.is.null,outreach->>${key}.in.(skipped,failed)`;

/** Leads that match the filters AND have something to contact on the chosen target. */
export function audienceQuery(a: Audience, select: string, opts?: { count?: "exact"; head?: boolean }): Query {
  let q: Query = db().from("le_leads").select(select, opts).eq("upload_id", a.uploadId);
  if (a.ids?.length) q = q.in("id", a.ids);
  q = applyFilters(q, a.filters ?? {});

  switch (a.target) {
    case "founder_email":
      q = q.not("founder_email", "is", null).or("founder_email_status.is.null,founder_email_status.neq.invalid");
      break;
    case "company_email":
      q = q.neq("generic_emails", "{}");
      break;
    case "best_email":
      q = q.or("founder_email.not.is.null,generic_emails.neq.{}");
      break;
    case "founder_linkedin":
      q = q.not("founder_linkedin", "is", null);
      break;
    case "company_linkedin":
      q = q.not("company_linkedin", "is", null);
      break;
  }

  if (a.excludeContacted) {
    if (a.target === "best_email") q = q.or(notContacted("founder_email")).or(notContacted("company_email"));
    else q = q.or(notContacted(a.target));
  }
  return q;
}
