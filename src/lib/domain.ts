// Shared by client and server.

const NOT_COMPANY_SITES = [
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "crunchbase.com", "wikipedia.org", "bloomberg.com", "glassdoor.com", "indeed.com",
  "zoominfo.com", "apollo.io", "rocketreach.co", "yelp.com", "tracxn.com", "pitchbook.com",
  "angel.co", "wellfound.com", "github.com", "medium.com", "google.com", "apple.com/app",
  "play.google.com", "g2.com", "capterra.com", "owler.com", "dnb.com", "signalhire.com",
  "craft.co", "cbinsights.com", "ambitionbox.com", "justdial.com", "indiamart.com",
  "gov.uk", "opencorporates.com", "fca.org.uk", "endole.co.uk", "companycheck.co.uk", "bing.com",
  "duckduckgo.com", "yell.com", "bbb.org", "mapquest.com", "manta.com", "bizapedia.com", "yellowpages.com",
];

/** "https://www.Acme.io/about?x" → "acme.io". Returns null if it doesn't look like a domain. */
export function normalizeDomain(input: unknown): string | null {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\d?\./, "");
  s = s.split(/[/?#\s]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+$/.test(s)) return null; // no bare IPs
  if (s.endsWith(".local") || s.endsWith(".internal") || s.endsWith(".localhost")) return null;
  return s;
}

export function isDirectorySite(domain: string): boolean {
  return NOT_COMPANY_SITES.some((d) => domain === d || domain.endsWith("." + d));
}

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/** True if the email belongs to the company domain (including subdomains). */
export function sameOrg(email: string, domain: string): boolean {
  const d = emailDomain(email);
  return d === domain || d.endsWith("." + domain);
}

const GENERIC_LOCALS = [
  "info", "hello", "hi", "contact", "contactus", "sales", "support", "help", "team", "office",
  "admin", "enquiries", "enquiry", "inquiries", "inquiry", "business", "partnerships", "partners",
  "marketing", "press", "media", "pr", "careers", "jobs", "hr", "billing", "accounts", "general",
  "mail", "connect", "founders", "ceo", "bd", "biz", "care", "service", "customerservice",
];

export function isGenericEmail(email: string): boolean {
  const local = email.split("@")[0].toLowerCase();
  return GENERIC_LOCALS.includes(local) || /^(no-?reply|donotreply)/.test(local);
}
