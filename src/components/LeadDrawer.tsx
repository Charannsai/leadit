"use client";

import { motion } from "motion/react";
import { Building2, Check, Copy, ExternalLink, Globe, Mail, MapPin, Maximize2, Minimize2, Phone, RotateCcw, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import type { Founder, Lead, LeadEvent } from "@/lib/types";
import { Button, Drawer, EmailStatus, LinkedInIcon, Pill, PixelLoader, StatusPill, XIcon, cx } from "./ui";

export function LeadDrawer({ id, onClose, onRerun }: { id: string | null; onClose: () => void; onRerun: (id: string) => void }) {
  const [data, setData] = useState<{ lead: Lead; events: LeadEvent[] } | null>(null);
  const [bump, setBump] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!id) return setData(null);
    let stop = false;
    let live = true;
    const load = () =>
      api<{ lead: Lead; events: LeadEvent[] }>(`/api/leads/${id}`)
        .then((d) => {
          if (stop) return;
          live = d.lead?.status === "queued" || d.lead?.status === "processing";
          setData(d);
        })
        .catch(() => {});
    load();
    // Keep refreshing only while this lead is being worked on.
    const t = setInterval(() => live && !document.hidden && load(), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, bump]);

  const lead = data?.lead?.id === id ? data.lead : null;
  const p = lead?.profile ?? {};
  const c = p.company ?? {};

  return (
    <Drawer open={!!id} onClose={onClose} expanded={expanded}>
      {!lead ? (
        <div className="flex h-60 items-center justify-center">
          <PixelLoader className="scale-150" />
        </div>
      ) : (
        <div className="pb-6">
          {/* header */}
          <div className={cx("sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-white/95 py-4", expanded ? "px-8" : "px-5")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel">
              {c.logo ? <img src={c.logo} alt="" className="h-full w-full object-cover" /> : <Building2 size={17} className="text-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{lead.company_name || c.name || lead.domain || "Untitled"}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                {lead.domain ? (
                  <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="font-mono hover:text-ink">
                    {lead.domain}
                  </a>
                ) : (
                  <span>No domain</span>
                )}
                {lead.domain_source && <span>· via {lead.domain_source}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => {
                  onRerun(lead.id);
                  setTimeout(() => setBump((b) => b + 1), 800);
                }} disabled={lead.status === "processing" || lead.status === "queued"} title="Run enrichment again">
                <RotateCcw size={13} /> Re-run
              </Button>
              {lead.status === "done" && (
                <Link href={`/outreach?tab=tracking&lead=${lead.id}`} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-ink-2 hover:bg-panel-2 hover:text-ink" title="Outreach for this lead">
                  <Send size={13} /> Outreach
                </Link>
              )}
              <button onClick={() => setExpanded((v) => !v)} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" title={expanded ? "Back to side panel" : "Open full screen"} aria-label={expanded ? "Collapse" : "Expand"}>
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className={cx("space-y-6 pt-4", expanded ? "mx-auto max-w-6xl px-8 pt-6" : "px-5")}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={lead.status} stage={lead.stage} />
              {lead.confidence != null && lead.status === "done" && <Pill>Confidence {lead.confidence}</Pill>}
              {lead.paused_reason && <Pill tone="amber">{lead.paused_reason}</Pill>}
            </div>
            {lead.error && <div className="rounded-lg bg-[#fdeeee] px-3 py-2 text-[12px] text-[#b4403b]">{lead.error}</div>}

            <div className={expanded ? "grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : "space-y-6"}>
            <div className="space-y-6">
            {/* founders */}
            <Section title="Founder">
              {(p.founders ?? []).length === 0 ? (
                <Empty>{lead.status === "done" ? "No founder found — see company contacts below." : "Not found yet."}</Empty>
              ) : (
                <div className={expanded ? "grid gap-3 md:grid-cols-2" : "space-y-2"}>
                  {(p.founders ?? []).map((f, i) => (
                    <FounderCard key={f.name + i} f={f} primary={i === 0} />
                  ))}
                </div>
              )}
            </Section>

            {/* company */}
            <Section title="Company">
              {c.description && <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{c.description}</p>}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {c.industry && <Pill tone="violet">{c.industry}</Pill>}
                {c.employees && <Pill tone="blue">{String(c.employees)} employees</Pill>}
                {c.founded && <Pill>Founded {String(c.founded)}</Pill>}
                {c.funding && <Pill tone="green">{c.funding}</Pill>}
              </div>
              <div className="divide-y divide-line rounded-xl border border-line">
                <Row icon={<Globe size={13} />} label="Website" value={c.website ?? (lead.domain ? `https://${lead.domain}` : undefined)} href />
                <Row icon={<LinkedInIcon size={12} />} label="LinkedIn" value={c.linkedin} href />
                <Row icon={<XIcon size={11} />} label="Twitter / X" value={c.twitter} href />
                <Row icon={<Phone size={13} />} label="Phone" value={c.phone} copy />
                <Row icon={<MapPin size={13} />} label="HQ" value={c.location ?? lead.location ?? undefined} />
                <Row icon={<Mail size={13} />} label="Contact page" value={c.contact_page} href />
                {p.email_pattern && <Row icon={<Mail size={13} />} label="Email pattern" value={`${p.email_pattern}@${lead.domain}`} />}
              </div>
            </Section>
            </div>

            <div className="space-y-6">
            <Section title="Company emails">
              {(p.generic_emails ?? []).length === 0 ? (
                <Empty>None found.</Empty>
              ) : (
                <div className="divide-y divide-line rounded-xl border border-line">
                  {(p.generic_emails ?? []).map((g) => (
                    <div key={g.email} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate font-mono">{g.email}</span>
                      {g.label && <span className="text-[11px] text-muted">{g.label}</span>}
                      <EmailStatus status={g.status} />
                      <CopyButton text={g.email} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Original row">
              <div className="divide-y divide-line rounded-xl border border-line">
                {Object.entries(lead.raw ?? {}).map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-3 py-1.5 text-[12px]">
                    <span className="w-36 shrink-0 truncate text-muted">{k}</span>
                    <span className="min-w-0 flex-1 break-words text-ink-2">{String(v)}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Activity">
              {(data?.events ?? []).length === 0 ? (
                <Empty>Nothing yet. Press Enrich to start.</Empty>
              ) : (
                <ol className="relative ml-1.5 border-l border-line">
                  {data!.events.map((e) => (
                    <motion.li key={e.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="relative pb-2.5 pl-4 text-[12px]">
                      <span
                        className={cx(
                          "absolute -left-[4.5px] top-[5px] h-2 w-2 rounded-full border-2 border-white",
                          e.level === "success" ? "bg-[#3a9a5b]" : e.level === "warn" ? "bg-[#d39a2c]" : e.level === "error" ? "bg-[#c4554f]" : "bg-line-strong",
                        )}
                      />
                      <span className="text-ink-2">{e.message.split(" — ").slice(1).join(" — ") || e.message}</span>
                      <span className="ml-2 text-[11px] text-muted">{timeAgo(e.at)}</span>
                    </motion.li>
                  ))}
                </ol>
              )}
            </Section>
            </div>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function FounderCard({ f, primary }: { f: Founder; primary: boolean }) {
  return (
    <div className={cx("rounded-xl border p-3", primary ? "border-line-strong bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]" : "border-line bg-panel/40")}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[12px] font-semibold text-ink-2">
          {f.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold">{f.name}</span>
            {f.linkedin && (
              <a href={f.linkedin} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:opacity-80" title="LinkedIn">
                <LinkedInIcon size={13} />
              </a>
            )}
            {f.twitter && (
              <a href={f.twitter.startsWith("http") ? f.twitter : `https://x.com/${f.twitter}`} target="_blank" rel="noreferrer" className="text-ink hover:opacity-70">
                <XIcon size={11} />
              </a>
            )}
          </div>
          <div className="text-[12px] text-muted">
            {f.title || "Founder"}
            {f.location ? ` · ${f.location}` : ""}
          </div>
          {f.summary && <div className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{f.summary}</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px]">
        <Mail size={13} className="shrink-0 text-muted" />
        {f.email ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono">{f.email}</span>
            <EmailStatus status={f.email_status} />
            <CopyButton text={f.email} />
          </>
        ) : (
          <span className="text-muted">No email found</span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-muted">
        Found via {f.source ?? "—"}
        {f.email_source ? ` · email via ${f.email_source}` : ""}
        {f.confidence ? ` · ${f.confidence}% match` : ""}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-3 text-[12.5px] text-muted">{children}</div>;
}

function Row({ icon, label, value, href, copy }: { icon: React.ReactNode; label: string; value?: string; href?: boolean; copy?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
      <span className="text-muted">{icon}</span>
      <span className="w-24 shrink-0 text-muted">{label}</span>
      {href ? (
        <a href={value} target="_blank" rel="noreferrer" className="group flex min-w-0 flex-1 items-center gap-1 truncate text-ink hover:underline">
          <span className="truncate">{value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
          <ExternalLink size={11} className="shrink-0 opacity-0 group-hover:opacity-60" />
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate">{value}</span>
      )}
      {copy && <CopyButton text={value} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded p-1 text-muted hover:bg-white hover:text-ink"
      title="Copy"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
