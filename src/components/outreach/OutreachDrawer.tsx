"use client";

import { AnimatePresence, motion } from "motion/react";
import { Building2, ChevronDown, Maximize2, Minimize2, PenLine, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { TARGETS, TONES, type Attachment, type OutreachItem, type Target } from "@/lib/outreach/types";
import type { Lead } from "@/lib/types";
import { Button, Drawer, EmailStatus, PixelLoader, cx } from "../ui";
import { AttachmentPicker, ChannelStrip, ItemEditor, OStatus, TargetIcon } from "./shared";

type Item = OutreachItem & { campaign?: { name: string } | null };

const BRIEF_KEY = "le:last-brief";

function recipientOf(lead: Lead, t: Target): string | null {
  if (t === "founder_email") return lead.founder_email && lead.founder_email_status !== "invalid" ? lead.founder_email : null;
  if (t === "company_email") return lead.generic_emails?.[0] ?? null;
  if (t === "founder_linkedin") return lead.founder_linkedin;
  return lead.company_linkedin;
}

export function OutreachDrawer({ leadId, onClose, onChanged }: { leadId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<{ lead: Lead; items: Item[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [composeFor, setComposeFor] = useState<Target | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!leadId) return;
    const d = await api<{ lead: Lead; items: Item[] }>(`/api/outreach/lead/${leadId}`);
    setData(d);
    return d;
  }, [leadId]);

  useEffect(() => {
    setData(null);
    setComposeFor(null);
    if (!leadId) return;
    load()
      .then((d) => d && setOpen(new Set(d.items.slice(0, 1).map((i) => i.id))))
      .catch(() => {});
  }, [leadId, load]);

  const live = data?.items.some((i) => ["generating", "scheduled", "sending"].includes(i.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => !document.hidden && load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [live, load]);

  const lead = data?.lead.id === leadId ? data.lead : null;
  const update = (u: OutreachItem) => {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === u.id ? { ...i, ...u } : i)) } : d));
    load().catch(() => {});
    onChanged?.();
  };

  return (
    <Drawer open={!!leadId} onClose={onClose} expanded={expanded}>
      {!lead ? (
        <div className="flex h-60 items-center justify-center">
          <PixelLoader className="scale-150" />
        </div>
      ) : (
        <div className="pb-8">
          <div className={cx("sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-white/95 py-4", expanded ? "px-8" : "px-5")}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel">
              {lead.profile?.company?.logo ? <img src={lead.profile.company.logo} alt="" className="h-full w-full object-cover" /> : <Building2 size={17} className="text-muted" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{lead.company_name ?? lead.domain}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">
                {lead.domain ?? "No domain"}
                {lead.founder_name ? ` · ${lead.founder_name}${lead.founder_title ? `, ${lead.founder_title}` : ""}` : ""}
              </div>
              <div className="mt-2">
                <ChannelStrip outreach={lead.outreach as Record<string, string>} available={Object.fromEntries(TARGETS.map((t) => [t.id, !!recipientOf(lead, t.id)]))} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setExpanded((v) => !v)} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" title={expanded ? "Back to side panel" : "Open full screen"} aria-label={expanded ? "Collapse" : "Expand"}>
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className={cx("space-y-6 pt-5", expanded ? "mx-auto max-w-6xl px-8" : "px-5")}>
            {/* channels */}
            <section>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Channels</div>
              <div className={cx("grid gap-2", expanded ? "grid-cols-4" : "grid-cols-2")}>
                {TARGETS.map((t) => {
                  const to = recipientOf(lead, t.id);
                  const status = (lead.outreach as Record<string, string>)?.[t.id];
                  const latest = data!.items.find((i) => i.target === t.id);
                  return (
                    <div key={t.id} className={cx("flex flex-col rounded-xl border p-3", composeFor === t.id ? "border-ink" : "border-line", !to && "bg-panel/40")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium">
                          <TargetIcon target={t.id} /> {t.label}
                        </span>
                        <OStatus status={status} />
                      </div>
                      <div className="mt-1 truncate text-[11.5px] text-muted" title={to ?? undefined}>
                        {to ? to.replace(/^https?:\/\/(www\.)?/, "") : "Nothing to contact"}
                      </div>
                      {t.id === "founder_email" && lead.founder_email && (
                        <div className="mt-1">
                          <EmailStatus status={lead.founder_email_status} />
                        </div>
                      )}
                      {latest && <div className="mt-1.5 truncate text-[11.5px] text-ink-2">{latest.subject ?? latest.note ?? latest.body?.slice(0, 60)}</div>}
                      <div className="mt-auto pt-2">
                        {to && (
                          <Button size="sm" variant={composeFor === t.id ? "primary" : "secondary"} onClick={() => setComposeFor(composeFor === t.id ? null : t.id)}>
                            <PenLine size={12} /> {latest ? "New message" : "Write"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <AnimatePresence initial={false}>
              {composeFor && (
                <motion.section key={composeFor} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <Composer
                    lead={lead}
                    target={composeFor}
                    onCreated={(item) => {
                      setComposeFor(null);
                      setData((d) => (d ? { ...d, items: [item, ...d.items] } : d));
                      setOpen((s) => new Set([...s, item.id]));
                      load().catch(() => {});
                      onChanged?.();
                    }}
                  />
                </motion.section>
              )}
            </AnimatePresence>

            {/* history */}
            <section>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Messages · {data!.items.length}</div>
              {data!.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted">No outreach yet. Pick a channel above to write the first message.</div>
              ) : (
                <div className="space-y-2">
                  {data!.items.map((i) => {
                    const isOpen = open.has(i.id);
                    const when = i.sent_at ?? i.scheduled_at ?? i.created_at;
                    return (
                      <div key={i.id} className="overflow-hidden rounded-xl border border-line">
                        <button
                          onClick={() => setOpen((s) => {
                            const n = new Set(s);
                            if (n.has(i.id)) n.delete(i.id);
                            else n.add(i.id);
                            return n;
                          })}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel/50"
                        >
                          <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", i.channel === "linkedin" ? "bg-[#eef3fd] text-[#0a66c2]" : "bg-panel-2 text-ink-2")}>
                            <TargetIcon target={i.target} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">{i.subject ?? (i.channel === "linkedin" ? TARGETS.find((t) => t.id === i.target)?.label : "Email")}</span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {i.campaign?.name ?? "One-off"} · {i.recipient_name ?? i.recipient?.replace(/^https?:\/\/(www\.)?/, "")} · {timeAgo(when)}
                            </span>
                          </span>
                          <OStatus status={i.status} />
                          <ChevronDown size={14} className={cx("shrink-0 text-muted transition-transform", isOpen && "rotate-180")} />
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                              <div className={cx("border-t border-line p-4", expanded && "grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]")}>
                                <ItemEditor item={i} onChange={update} compact={!expanded} />
                                <Timeline item={i} className={expanded ? "" : "mt-4"} />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Timeline({ item, className }: { item: OutreachItem; className?: string }) {
  const steps = (item.history ?? []).filter((h) => h.status !== "brief");
  return (
    <div className={className}>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">Timeline</div>
      <ol className="relative ml-1.5 border-l border-line">
        {steps.map((h, idx) => (
          <li key={idx} className="relative pb-2 pl-4 text-[12px]">
            <span className="absolute -left-[4.5px] top-[5px] h-2 w-2 rounded-full border-2 border-white bg-line-strong" />
            <OStatus status={h.status} />
            {h.note && <span className="ml-1.5 text-ink-2">{h.note}</span>}
            <div className="text-[11px] text-muted">{new Date(h.at).toLocaleString()}</div>
          </li>
        ))}
        {item.last_event && item.last_event !== "sent" && (
          <li className="relative pl-4 text-[11.5px] text-muted">
            <span className="absolute -left-[4.5px] top-[5px] h-2 w-2 rounded-full border-2 border-white bg-line-strong" />
            Resend: {item.last_event.replace(/_/g, " ")}
          </li>
        )}
      </ol>
    </div>
  );
}

function Composer({ lead, target, onCreated }: { lead: Lead; target: Target; onCreated: (i: Item) => void }) {
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [cta, setCta] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEmail = !target.endsWith("linkedin");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BRIEF_KEY) ?? "{}");
      if (saved.brief) setBrief(saved.brief);
      if (saved.tone) setTone(saved.tone);
      if (saved.cta) setCta(saved.cta);
    } catch {}
  }, []);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify({ brief, tone, cta }));
    } catch {}
    try {
      onCreated(await api<Item>("/api/outreach/compose", { method: "POST", body: JSON.stringify({ leadId: lead.id, target, brief, tone, cta, attachments }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/80 bg-panel/30 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
        <TargetIcon target={target} /> New {TARGETS.find((t) => t.id === target)?.label.toLowerCase()} for {lead.company_name}
      </div>
      <textarea
        autoFocus
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={4}
        placeholder="What is this outreach for? The AI writes the message from this and what we know about the company."
        className="w-full resize-y rounded-lg border border-line-strong bg-white px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-ink"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {TONES.map((t) => (
          <button key={t} onClick={() => setTone(t)} className={cx("h-7 rounded-lg border px-2.5 text-[12px]", tone === t ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink-2")}>
            {t}
          </button>
        ))}
        <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Call to action (optional)" className="h-7 min-w-[200px] flex-1 rounded-lg border border-line-strong bg-white px-2.5 text-[12px] outline-none focus:border-ink" />
      </div>
      {isEmail && (
        <div className="mt-2">
          <AttachmentPicker value={attachments} onChange={setAttachments} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[12px] text-[#b4403b]">{error}</span>
        <Button variant="primary" onClick={write} disabled={busy || !brief.trim()}>
          {busy ? <PixelLoader className="[&>span]:bg-white" /> : <Sparkles size={13} />} Write draft
        </Button>
      </div>
    </div>
  );
}
