import "server-only";
import { track } from "../agentLog";
import { ensureBudget, markExhausted, recordUsage, BudgetError } from "../budget";
import { cached } from "../cache";
import { getKey } from "../keys";
import type { CompanyProfile } from "../types";
import { fetchJson, HttpError } from "./http";

interface ApolloOrg {
  name?: string;
  website_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  phone?: string;
  primary_phone?: { number?: string };
  founded_year?: number;
  logo_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  short_description?: string;
  city?: string;
  state?: string;
  country?: string;
  keywords?: string[];
  total_funding_printed?: string;
  latest_funding_stage?: string;
}

/**
 * Company profile by domain. This is the only Apollo endpoint the free plan allows
 * (person search / match are blocked). Returns null when Apollo has no record.
 */
export async function enrichOrganization(domain: string): Promise<CompanyProfile | null> {
  const key = await getKey("apollo");
  if (!key) return null;
  return cached(`apollo:org:${domain}`, 90, () => track("apollo", "org-enrich", async () => {
    await ensureBudget("apollo");
    let res: { organization?: ApolloOrg };
    try {
      res = await fetchJson("apollo", `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
        headers: { "x-api-key": key, "Cache-Control": "no-cache" },
      });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 402 || e.status === 422 || e.status === 403)) {
        const msg = JSON.stringify(e.body);
        if (/credit|quota|insufficient|not included|INACCESSIBLE/i.test(msg)) {
          await markExhausted("apollo");
          throw new BudgetError("apollo");
        }
      }
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
    await recordUsage("apollo");
    const o = res.organization;
    if (!o?.name) return null;
    const funding = [o.latest_funding_stage, o.total_funding_printed && `${o.total_funding_printed} raised`].filter(Boolean).join(" · ");
    return {
      name: o.name,
      website: o.website_url ?? undefined,
      linkedin: o.linkedin_url ?? undefined,
      twitter: o.twitter_url ?? undefined,
      facebook: o.facebook_url ?? undefined,
      phone: o.primary_phone?.number ?? o.phone ?? undefined,
      founded: o.founded_year ?? undefined,
      logo: o.logo_url ?? undefined,
      industry: o.industry ?? undefined,
      employees: o.estimated_num_employees ?? undefined,
      description: o.short_description ?? undefined,
      location: [o.city, o.state, o.country].filter(Boolean).join(", ") || undefined,
      keywords: o.keywords?.slice(0, 12),
      funding: funding || undefined,
    };
  }));
}
