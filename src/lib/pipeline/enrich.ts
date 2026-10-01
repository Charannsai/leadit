import "server-only";
import { logJob } from "../agentLog";
import { BudgetError } from "../budget";
import { db, must } from "../db";
import { isDirectorySite, isGenericEmail, normalizeDomain, sameOrg } from "../domain";
import { getSettings } from "../settings";
import type { ContactEmail, EmailStatus, Founder, Lead, Profile } from "../types";
import { enrichOrganization } from "../providers/apollo";
import { suggestDomains } from "../providers/clearbit";
import { search, type SearchResult } from "../providers/firecrawl";
import { llmJson } from "../llm";
import { domainSearch, emailFinder, verifyEmail } from "../providers/hunter";
import { crawlSite, extractEmails, type SiteData } from "../providers/website";

type Level = "info" | "success" | "warn" | "error";

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail|zoho|yandex|gmx|rediffmail)\./i;
const FOUNDER_TITLE = /founder|co-?founder|ceo|chief executive|owner|managing director|\bmd\b|president|proprietor|partner/i;

class Ctx {
  profile: Profile;
  domain: string | null;
  companyName: string;
  site: SiteData | null = null;
  searchResults: SearchResult[] = [];
  blocked = new Set<string>();
  startedAt = performance.now();

  constructor(public lead: Lead) {
    this.profile = { ...(lead.profile ?? {}) };
    this.profile.done ??= {};
    this.profile.sources ??= {};
    this.profile.notes = [];
    this.domain = lead.domain;
    this.companyName = (lead.company_name ?? "").trim();
  }

  async log(message: string, level: Level = "info") {
    await db().from("le_lead_events").insert({ lead_id: this.lead.id, upload_id: this.lead.upload_id, level, message: `${this.label()} — ${message}` });
  }

  label() {
    return this.companyName || this.domain || `Row ${this.lead.row_index + 1}`;
  }

  async stage(name: string) {
    must(await db().from("le_leads").update({ stage: name, updated_at: new Date().toISOString() }).eq("id", this.lead.id));
  }

  async save() {
    must(await db().from("le_leads").update({ profile: this.profile, domain: this.domain, updated_at: new Date().toISOString() }).eq("id", this.lead.id));
  }
}

// ---------- steps ----------

async function resolveDomain(c: Ctx) {
  const fromSheet = normalizeDomain(c.lead.domain_input);
  if (fromSheet && !isDirectorySite(fromSheet)) {
    c.domain = fromSheet;
    c.profile.sources!.domain = "sheet";
    return;
  }

  // Any company email or website-looking value elsewhere in the row.
  for (const v of Object.values(c.lead.raw ?? {})) {
    const s = String(v);
    if (s.includes("@") && !FREE_MAIL.test(s)) {
      const d = normalizeDomain(s);
      if (d && !isDirectorySite(d)) {
        c.domain = d;
        c.profile.sources!.domain = "row email";
        return;
      }
    }
    if (/^(https?:\/\/|www\.)/i.test(s.trim())) {
      const d = normalizeDomain(s);
      if (d && !isDirectorySite(d)) {
        c.domain = d;
        c.profile.sources!.domain = "row url";
        return;
      }
    }
  }

  if (!c.companyName) return;

  const candidates: { domain: string; name?: string; source: string; snippet?: string }[] = [];
  for (const s of await suggestDomains(c.companyName)) candidates.push({ domain: s.domain, name: s.name, source: "clearbit" });

  const exact = candidates.find((x) => simplify(x.name ?? "") === simplify(c.companyName));
  if (exact) {
    c.domain = exact.domain;
    c.profile.sources!.domain = "clearbit";
    return;
  }

  // No exact name match: search the web and let the model pick.
  const q = `${c.companyName} ${c.lead.location ?? ""} official website`.replace(/\s+/g, " ");
  for (const r of await search(q, 5)) {
    const d = normalizeDomain(r.url);
    if (!d) continue;
    if (d.includes("linkedin.com") && r.url.includes("/company/") && !c.profile.company?.linkedin) {
      c.profile.company = { ...c.profile.company, linkedin: r.url.split("?")[0] };
    }
    if (!isDirectorySite(d) && !candidates.some((x) => x.domain === d)) candidates.push({ domain: d, name: r.title, source: "search", snippet: r.description });
  }
  c.profile.domain_candidates = candidates.slice(0, 8).map(({ domain, name, source }) => ({ domain, name, source }));
  if (!candidates.length) return;

  const pick = await llmJson<{ domain: string | null; reason?: string }>(
    "enrichment",
    "You match a company from a lead list to its official website domain. Only choose a candidate if it is clearly the same company. Prefer the company's own site over directories, news or marketplaces.",
    JSON.stringify({
      company: c.companyName,
      location: c.lead.location,
      row: trimRow(c.lead.raw),
      candidates,
      return: { domain: "one of the candidate domains, or null if none is clearly this company", reason: "short" },
    }),
  );
  const chosen = normalizeDomain(pick.domain);
  const match = candidates.find((x) => x.domain === chosen);
  if (match) {
    c.domain = match.domain;
    c.profile.sources!.domain = match.source;
  }
}

async function companyProfile(c: Ctx) {
  if (!c.domain) return;
  const org = await enrichOrganization(c.domain);
  if (org) {
    c.profile.company = { ...org, ...stripEmpty(c.profile.company ?? {}), linkedin: org.linkedin ?? c.profile.company?.linkedin };
    if (org.linkedin) c.profile.sources!.company_linkedin = "apollo";
    await c.log(`Company profile from Apollo${org.industry ? ` (${org.industry})` : ""}`);
  }
}

async function readWebsite(c: Ctx) {
  if (!c.domain) return;
  c.site = await crawlSite(c.domain);
  const s = c.site;
  const company = (c.profile.company ??= {});
  company.website ??= `https://${c.domain}`;
  if (!company.linkedin && s.socials.linkedin) {
    company.linkedin = s.socials.linkedin;
    c.profile.sources!.company_linkedin = "website";
  }
  company.twitter ??= s.socials.twitter;
  company.facebook ??= s.socials.facebook;
  company.instagram ??= s.socials.instagram;
  company.phone ??= s.phones[0];
  company.contact_page ??= s.contactPage;
  c.profile.website = { pages: s.pages, emails: s.emails, phones: s.phones, fetched_with: s.fetchedWith };
  if (s.fetchedWith === "none") await c.log("Website could not be read", "warn");
  else await c.log(`Read ${s.pages.length} page(s) of ${c.domain}, ${s.emails.length} email(s) found`);
}

async function findFounders(c: Ctx) {
  const founders: Founder[] = [];

  // 1. The company's own about/team pages (free).
  if (c.site && c.site.text.length > 200) {
    const res = await llmJson<{ description?: string; people: Founder[] }>(
      "enrichment",
      "You read a company's website text and list its founders and top executives (founder, co-founder, CEO, owner, managing director). Never invent people; only use names present in the text.",
      JSON.stringify({
        company: c.companyName,
        domain: c.domain,
        linkedin_links: c.site.personLinks,
        website_text: c.site.text,
        return: {
          description: "one-sentence description of what the company does, or null",
          people: [{ name: "full name", title: "as written", linkedin: "matching linkedin.com/in URL from linkedin_links, or null" }],
        },
      }),
    );
    if (res.description && !c.profile.company?.description) c.profile.company = { ...c.profile.company, description: res.description };
    for (const p of res.people ?? []) if (p?.name && FOUNDER_TITLE.test(p.title ?? "")) founders.push({ ...stripEmpty(p), name: p.name, source: "website" });
  }

  // 2. LinkedIn profiles via web search, unless the website already gave us a founder with a profile.
  if (!founders.some((f) => f.linkedin) && c.companyName) {
    const named = founders[0]?.name;
    const q = named
      ? `"${named}" ${c.companyName} site:linkedin.com/in`
      : `${c.companyName} ${c.domain ?? c.lead.location ?? ""} founder OR co-founder OR CEO site:linkedin.com/in`.replace(/\s+/g, " ");
    c.searchResults = (await search(q, 6)).filter((r) => r.url.includes("linkedin.com/in/"));

    if (c.searchResults.length) {
      const res = await llmJson<{ founders: Founder[] }>(
        "enrichment",
        "You identify the founders / CEO / owner of a specific company from LinkedIn search results. A person qualifies only if the title or snippet clearly ties them to THIS company in a founder, co-founder, CEO, owner or managing director role (current role preferred). Same-name companies elsewhere do not count. Never invent people or URLs.",
        JSON.stringify({
          company: c.companyName,
          domain: c.domain,
          location: c.lead.location,
          company_description: c.profile.company?.description,
          known_from_website: founders,
          results: c.searchResults,
          return: {
            founders: [{
              name: "full name", title: "role at this company", linkedin: "result URL", location: "if stated, else null",
              summary: "one line from the snippet about their background, or null", confidence: "0-100 that this person is a founder/CEO of this exact company",
            }],
          },
        }),
      );
      for (const f of res.founders ?? []) {
        if (!f?.name || Number(f.confidence ?? 0) < 50) continue;
        const existing = founders.find((x) => sameName(x.name, f.name));
        if (existing) Object.assign(existing, { ...stripEmpty(f), ...stripEmpty(existing), linkedin: existing.linkedin ?? f.linkedin, source: "website + linkedin" });
        else founders.push({ ...stripEmpty(f), name: f.name, confidence: Number(f.confidence), source: "linkedin search" });
      }
    }
  }

  // Emails sometimes appear right in the LinkedIn snippet.
  for (const f of founders) {
    const hit = c.searchResults.find((r) => r.url === f.linkedin);
    const email = hit && extractEmails(`${hit.title} ${hit.description}`).find((e) => !c.domain || sameOrg(e, c.domain));
    if (email && !f.email) Object.assign(f, { email, email_source: "linkedin", email_status: "unverified" as EmailStatus });
  }

  c.profile.founders = founders.slice(0, 3);
  if (founders.length) await c.log(`Founder: ${founders.map((f) => `${f.name}${f.title ? ` (${f.title})` : ""}`).join(", ")}`, "success");
  else await c.log("No founder found on website or LinkedIn", "warn");
}

async function companyLinkedin(c: Ctx) {
  if (c.profile.company?.linkedin || !c.companyName) return;
  const results = await search(`${c.companyName} ${c.domain ?? ""} site:linkedin.com/company`.trim(), 3);
  const want = simplify(c.companyName);
  const hit = results.find((r) => r.url.includes("linkedin.com/company/") && (simplify(r.title ?? "").includes(want) || simplify(r.url).includes(want)));
  if (hit) {
    c.profile.company = { ...c.profile.company, linkedin: hit.url.split("?")[0] };
    c.profile.sources!.company_linkedin = "linkedin search";
    await c.log("Found company LinkedIn page");
  }
}

async function founderEmail(c: Ctx) {
  const settings = await getSettings();
  const domain = c.domain;
  const founders = c.profile.founders ?? [];
  if (!domain || !founders.length) return;

  // Free first: match website emails to each founder's name.
  for (const f of founders) {
    if (f.email) continue;
    const e = (c.site?.emails ?? c.profile.website?.emails ?? []).find((x) => sameOrg(x, domain) && !isGenericEmail(x) && emailMatchesName(x, f.name));
    if (e) Object.assign(f, { email: e, email_source: "website", email_status: "unverified" as EmailStatus });
  }

  // Paid steps only for the primary founder.
  const f = founders[0];
  const [first, last] = splitName(f.name);

  if (!f.email && first && last) {
    const r = await emailFinder(domain, first, last);
    if (r.email) {
      Object.assign(f, { email: r.email, email_source: "hunter", email_status: r.status ?? "unknown" });
      f.linkedin ??= r.linkedin;
      f.twitter ??= r.twitter;
    }
  }

  if (!f.email && settings.guessEmails && first) {
    const pattern = c.profile.email_pattern;
    const guesses =
      pattern && (last || !/\{l(ast)?\}/.test(pattern))
        ? [`${applyPattern(pattern, first, last)}@${domain}`]
        : [`${first}@${domain}`, last ? `${first}.${last}@${domain}` : null];
    for (const g of guesses.filter(Boolean) as string[]) {
      const status = await verifyEmail(g);
      if (status === "valid" || status === "accept_all") {
        Object.assign(f, { email: g, email_source: "pattern guess", email_status: status });
        break;
      }
    }
  }

  if (f.email && settings.verifyEmails && (f.email_status === "unverified" || !f.email_status)) {
    f.email_status = await verifyEmail(f.email);
  }

  if (f.email) await c.log(`Founder email ${f.email} (${f.email_status}, via ${f.email_source})`, f.email_status === "valid" ? "success" : "info");
}

async function companyContacts(c: Ctx) {
  const domain = c.domain;
  const founderEmails = new Set((c.profile.founders ?? []).map((f) => f.email).filter(Boolean));
  const generic: ContactEmail[] = [];
  for (const e of c.site?.emails ?? c.profile.website?.emails ?? []) {
    if (founderEmails.has(e)) continue;
    if (domain && !sameOrg(e, domain)) continue;
    generic.push({ email: e, source: "website", status: "unverified", label: isGenericEmail(e) ? "general" : "person" });
  }

  const hasFounderEmail = (c.profile.founders ?? []).some((f) => f.email && f.email_status !== "invalid");
  if (domain && (!hasFounderEmail || (!c.profile.founders?.length && !generic.length))) {
    // Hunter's domain search finds both executives and general inboxes in one call.
    const ds = await domainSearch(domain);
    if (ds.pattern) c.profile.email_pattern = ds.pattern;
    c.profile.company = { ...c.profile.company, linkedin: c.profile.company?.linkedin ?? ds.linkedin ?? undefined, twitter: c.profile.company?.twitter ?? ds.twitter ?? undefined };

    const execs = ds.emails.filter((e) => e.type === "personal" && FOUNDER_TITLE.test(e.position ?? ""));
    for (const e of execs) {
      const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
      const existing = (c.profile.founders ?? []).find((f) => name && sameName(f.name, name));
      if (existing && !existing.email) Object.assign(existing, { email: e.value, email_source: "hunter", email_status: mapHunter(e.verification?.status) });
      else if (!existing && name && (c.profile.founders?.length ?? 0) < 3) {
        (c.profile.founders ??= []).push({ name, title: e.position, linkedin: e.linkedin ?? undefined, twitter: e.twitter ?? undefined, email: e.value, email_source: "hunter", email_status: mapHunter(e.verification?.status), confidence: e.confidence, source: "hunter" });
      }
    }
    for (const e of ds.emails) {
      if (founderEmails.has(e.value) || generic.some((g) => g.email === e.value) || execs.includes(e)) continue;
      if (e.type === "generic" || generic.length < 6) {
        generic.push({ email: e.value, source: "hunter", status: mapHunter(e.verification?.status), label: e.type === "generic" ? "general" : e.position || "person" });
      }
    }
    if (ds.emails.length) await c.log(`Hunter found ${ds.emails.length} email(s) on ${domain}`);
  }

  c.profile.generic_emails = generic.slice(0, 10);
}

// ---------- runner ----------

const STEPS: { name: string; label: string; run: (c: Ctx) => Promise<void>; volatile?: boolean }[] = [
  { name: "domain", label: "Finding website", run: resolveDomain },
  { name: "company", label: "Company profile", run: companyProfile },
  { name: "website", label: "Reading website", run: readWebsite, volatile: true },
  { name: "founders", label: "Finding founder", run: findFounders },
  { name: "linkedin", label: "Company LinkedIn", run: companyLinkedin },
  { name: "founder_email", label: "Finding founder email", run: founderEmail },
  { name: "contacts", label: "Company contacts", run: companyContacts },
];

export async function enrichLead(lead: Lead) {
  const c = new Ctx(lead);
  if (!Object.keys(c.profile.done!).length) await c.log("Started");

  for (const step of STEPS) {
    // The website crawl is free and isn't stored in full, so it always re-runs.
    if (c.profile.done![step.name] && !step.volatile) continue;
    await c.stage(step.label);
    try {
      await step.run(c);
      c.profile.done![step.name] = true;
    } catch (e) {
      if (e instanceof BudgetError) {
        c.blocked.add(e.provider);
        c.profile.notes!.push(`${step.label}: skipped, ${e.message}`);
        await c.log(`${step.label} skipped — ${e.message}`, "warn");
      } else {
        await c.save();
        throw e;
      }
    }
    await c.save();
  }

  await finish(c);
}

async function finish(c: Ctx) {
  const p = c.profile;
  const founder = p.founders?.[0];
  const generic = p.generic_emails ?? [];
  const status = founder?.email_status;

  let confidence = 0;
  if (founder?.email) confidence = status === "valid" ? 95 : status === "accept_all" ? 75 : status === "invalid" ? 30 : 60;
  else if (founder) confidence = founder.linkedin ? 45 : 35;
  else if (generic.length || p.company?.linkedin) confidence = 30;

  p.blocked = [...c.blocked];
  const needsMore = c.blocked.size > 0 && !(founder?.email && status !== "invalid");
  const outcome = founder ? "founder" : generic.length || p.company?.linkedin ? "company" : "none";

  must(await db().from("le_leads").update({
    status: needsMore ? "paused" : "done",
    paused_reason: needsMore ? `Waiting for ${[...c.blocked].map(providerName).join(", ")} credits` : null,
    stage: null,
    locked_until: null,
    domain: c.domain,
    domain_source: p.sources?.domain ?? null,
    company_linkedin: p.company?.linkedin ?? null,
    founder_name: founder?.name ?? null,
    founder_title: founder?.title ?? null,
    founder_linkedin: founder?.linkedin ?? null,
    founder_email: founder?.email ?? null,
    founder_email_status: founder?.email ? status ?? "unknown" : null,
    generic_emails: generic.map((g) => g.email),
    phone: p.company?.phone ?? null,
    outcome,
    confidence,
    profile: p,
    error: null,
    enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", c.lead.id));

  if (needsMore) await c.log(`Paused — waiting for ${[...c.blocked].map(providerName).join(", ")} credits`, "warn");
  else await c.log(outcome === "founder" ? "Done" : outcome === "company" ? "Done — company contacts only" : "Done — nothing found", outcome === "none" ? "warn" : "success");

  const summary = founder
    ? `Founder ${founder.name}${founder.email ? ` · ${founder.email} (${status})` : " · no email"}`
    : outcome === "company" ? `Company contacts only (${generic.length} email(s))` : "Nothing found";
  await logJob("enrich lead", needsMore ? "skipped" : "ok", c.startedAt, needsMore ? `Paused: waiting for ${[...c.blocked].map(providerName).join(", ")} credits` : summary, { domain: c.domain, outcome, confidence });
}

// ---------- helpers ----------

export function providerName(p: string) {
  return ({ hunter_search: "Hunter", hunter_verify: "Hunter verification", firecrawl: "Firecrawl", apollo: "Apollo", groq: "Groq" } as Record<string, string>)[p] ?? p;
}

function simplify(s: string) {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|company|gmbh|plc|technologies|technology|labs|group)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function splitName(name: string): [string, string] {
  const parts = name.replace(/\b(dr|mr|mrs|ms|prof)\.?\s+/gi, "").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/);
  return [parts[0]?.toLowerCase() ?? "", parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ""];
}

function sameName(a: string, b: string) {
  const [af, al] = splitName(a);
  const [bf, bl] = splitName(b);
  return af === bf && (al === bl || !al || !bl);
}

function emailMatchesName(email: string, name: string) {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const [first, last] = splitName(name);
  if (!first) return false;
  return local === first || local.startsWith(first) || (!!last && (local.includes(last) || local === first[0] + last));
}

function applyPattern(pattern: string, first: string, last: string) {
  return pattern.replace("{first}", first).replace("{last}", last).replace("{f}", first[0] ?? "").replace("{l}", last[0] ?? "");
}

function mapHunter(s?: string): EmailStatus {
  return s === "valid" ? "valid" : s === "invalid" ? "invalid" : s === "accept_all" ? "accept_all" : "unknown";
}

function trimRow(raw: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(raw ?? {}).slice(0, 12).map(([k, v]) => [k, String(v).slice(0, 120)]));
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Partial<T>;
}
