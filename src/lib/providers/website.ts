import "server-only";
import * as cheerio from "cheerio";
import { track } from "../agentLog";
import { BudgetError } from "../budget";
import { isDirectorySite } from "../domain";
import { scrape } from "./firecrawl";
import { BROWSER_UA } from "./http";

export interface SiteData {
  pages: string[];
  emails: string[];
  phones: string[];
  socials: { linkedin?: string; twitter?: string; facebook?: string; instagram?: string };
  /** linkedin.com/in links with the text around them, so names can be matched to profiles. */
  personLinks: { url: string; context: string }[];
  contactPage?: string;
  text: string;
  fetchedWith: "fetch" | "firecrawl" | "none";
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|sentry|wixpress|domain\.com|yourdomain|email\.com|@2x|u00|godaddy|cloudflare/i;
const SUBPAGE_RE = /\/(about|about-us|team|our-team|leadership|founders|company|who-we-are|people|contact|contact-us)\/?$/i;

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    return { html, finalUrl: res.url };
  } catch {
    return null;
  }
}

export function extractEmails(text: string): string[] {
  const cleaned = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = (cleaned.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/^mailto:/, ""));
  return [...new Set(found.filter((e) => !BAD_EMAIL.test(e) && e.length < 80))];
}

function parsePage(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const links: { href: string; text: string; context: string }[] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    let href = raw;
    try {
      href = new URL(raw, baseUrl).toString();
    } catch {}
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const context = $(el).closest("li, article, div").first().text().replace(/\s+/g, " ").trim().slice(0, 200);
    links.push({ href, text, context });
  });
  const mailtos = links.filter((l) => l.href.startsWith("mailto:")).map((l) => l.href.slice(7).split("?")[0]);
  const tels = links.filter((l) => l.href.startsWith("tel:")).map((l) => decodeURIComponent(l.href.slice(4)).trim());
  $("script, style, noscript, svg, iframe").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { links, mailtos, tels, text, html };
}

/**
 * Reads the homepage and up to 3 about/team/contact pages with a plain fetch (free).
 * Falls back to one Firecrawl scrape of the homepage if the site blocks us or needs JavaScript.
 */
export function crawlSite(domain: string): Promise<SiteData> {
  return track("website", "crawl", () => crawlRaw(domain), (s) => ({ message: `${s.pages.length} page(s), ${s.emails.length} email(s) via ${s.fetchedWith}`, detail: { pages: s.pages } }));
}

async function crawlRaw(domain: string): Promise<SiteData> {
  const out: SiteData = { pages: [], emails: [], phones: [], socials: {}, personLinks: [], text: "", fetchedWith: "none" };
  const home = (await fetchHtml(`https://${domain}`)) ?? (await fetchHtml(`https://www.${domain}`)) ?? (await fetchHtml(`http://${domain}`));

  const allLinks: { href: string; text: string; context: string }[] = [];
  const texts: string[] = [];
  const rawEmails: string[] = [];

  if (home) {
    out.fetchedWith = "fetch";
    const p = parsePage(home.html, home.finalUrl);
    out.pages.push(home.finalUrl);
    allLinks.push(...p.links);
    texts.push(p.text.slice(0, 4000));
    rawEmails.push(...p.mailtos, ...extractEmails(p.html));
    out.phones.push(...p.tels);

    const host = new URL(home.finalUrl).host;
    const subpages = [...new Set(p.links.map((l) => l.href.split("#")[0]).filter((h) => {
      try {
        const u = new URL(h);
        return u.host === host && SUBPAGE_RE.test(u.pathname);
      } catch {
        return false;
      }
    }))].slice(0, 3);

    const results = await Promise.all(subpages.map((u) => fetchHtml(u)));
    results.forEach((r, i) => {
      if (!r) return;
      const sp = parsePage(r.html, r.finalUrl);
      out.pages.push(r.finalUrl);
      allLinks.push(...sp.links);
      texts.push(sp.text.slice(0, 3000));
      rawEmails.push(...sp.mailtos, ...extractEmails(sp.html));
      out.phones.push(...sp.tels);
      if (/contact/i.test(subpages[i])) out.contactPage = r.finalUrl;
    });
  }

  if (!home || texts.join(" ").length < 300) {
    try {
      const s = await scrape(`https://${domain}`);
      if (s.markdown) {
        out.fetchedWith = "firecrawl";
        out.pages.push(`https://${domain}`);
        texts.push(s.markdown.slice(0, 6000));
        rawEmails.push(...extractEmails(s.markdown));
        allLinks.push(...s.links.map((href) => ({ href, text: "", context: "" })));
      }
    } catch (e) {
      if (!(e instanceof BudgetError)) console.warn("firecrawl scrape failed", domain, (e as Error).message);
    }
  }

  for (const l of allLinks) {
    const h = l.href.toLowerCase();
    if (h.includes("linkedin.com/company/") && !out.socials.linkedin) out.socials.linkedin = l.href.split("?")[0];
    else if (h.includes("linkedin.com/in/")) out.personLinks.push({ url: l.href.split("?")[0], context: l.context || l.text });
    else if ((h.includes("twitter.com/") || h.includes("//x.com/")) && !h.includes("/intent") && !h.includes("/share") && !out.socials.twitter) out.socials.twitter = l.href;
    else if (h.includes("facebook.com/") && !h.includes("sharer") && !out.socials.facebook) out.socials.facebook = l.href;
    else if (h.includes("instagram.com/") && !out.socials.instagram) out.socials.instagram = l.href;
    if (!out.contactPage && /\/contact/i.test(h) && !isDirectorySite(h)) out.contactPage = l.href;
  }

  out.emails = extractEmails(rawEmails.join(" "));
  out.phones = [...new Set(out.phones)].slice(0, 5);
  out.personLinks = dedupeBy(out.personLinks, (p) => p.url).slice(0, 20);
  out.text = texts.join("\n\n").slice(0, 9000);
  return out;
}

function dedupeBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}
