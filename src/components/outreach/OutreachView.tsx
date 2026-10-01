"use client";

import { motion } from "motion/react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { STATUS_META, TARGETS, type Campaign, type OutreachItem, type Target } from "@/lib/outreach/types";
import { PageHeader, useApp } from "../AppShell";
import { Button, Meter, PixelLoader, cx } from "../ui";
import { CampaignWizard } from "./CampaignWizard";
import { fmt } from "./CampaignView";
import { OutreachDrawer } from "./OutreachDrawer";
import { ItemEditor, OStatus, TargetIcon, TargetLabel } from "./shared";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "linkedin", label: "LinkedIn tasks" },
  { id: "tracking", label: "Tracking" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function OutreachView() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "overview") as Tab;
  const [wizard, setWizard] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(params.get("lead"));
  const [bump, setBump] = useState(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Outreach"
        subtitle="Email campaigns, LinkedIn tasks, and every lead's outreach in one place"
        actions={
          <Button variant="primary" onClick={() => setWizard(true)}>
            <Plus size={14} /> New campaign
          </Button>
        }
      />
      <div className="border-b border-line px-6">
        <div className="-mb-px flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => router.replace(`/outreach?tab=${t.id}`)} className={cx("relative px-3 pb-2.5 pt-1 text-[13px]", tab === t.id ? "text-ink" : "text-muted hover:text-ink-2")}>
              {t.label}
              {tab === t.id && <motion.span layoutId="outreach-tab" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink" />}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && <OverviewTab onOpenLead={setLeadId} onNew={() => setWizard(true)} />}
        {tab === "campaigns" && <CampaignsTab onNew={() => setWizard(true)} />}
        {tab === "linkedin" && <LinkedInTab key={bump} onOpenLead={setLeadId} />}
        {tab === "tracking" && <TrackingTab key={bump} onOpenLead={setLeadId} />}
      </div>

      <CampaignWizard open={wizard} onClose={() => setWizard(false)} />
      <OutreachDrawer leadId={leadId} onClose={() => setLeadId(null)} onChanged={() => setBump((b) => b + 1)} />
    </div>
  );
}

// ---------------- Overview ----------------

interface Stats {
  email: { sent24h: number; dailyLimit: number; nextSendAt: string | null; from: string };
  linkedin: { invitesToday: number; dailyLimit: number };
  byTarget: Record<string, Record<string, number>>;
  recent: (OutreachItem & { lead?: { company_name: string | null } })[];
}

function OverviewTab({ onOpenLead, onNew }: { onOpenLead: (id: string) => void; onNew: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    const load = () => api<Stats>("/api/outreach/stats").then(setS).catch(() => {});
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!s)
    return (
      <div className="flex justify-center py-20">
        <PixelLoader className="scale-150" />
      </div>
    );

  const sum = (t: string, keys: string[]) => keys.reduce((a, k) => a + (s.byTarget[t]?.[k] ?? 0), 0);
  const emailSent = sum("founder_email", ["sent", "delivered", "bounced", "replied"]) + sum("company_email", ["sent", "delivered", "bounced", "replied"]);
  const replies = Object.values(s.byTarget).reduce((a, m) => a + (m.replied ?? 0), 0);
  const bounced = sum("founder_email", ["bounced"]) + sum("company_email", ["bounced"]);
  const contacted = Object.values(s.byTarget).reduce((a, m) => a + ["sent", "delivered", "bounced", "invited", "connected", "messaged", "followed", "replied"].reduce((b, k) => b + (m[k] ?? 0), 0), 0);
  const nothing = !Object.keys(s.byTarget).length;

  return (
    <div className="space-y-4 px-6 py-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
        <div className="bg-white px-4 py-3.5">
          <div className="text-[11.5px] text-muted">Emails · last 24h</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight">
            {s.email.sent24h}
            <span className="text-[14px] font-normal text-muted">/{s.email.dailyLimit}</span>
          </div>
          <Meter className="mt-1.5" value={s.email.sent24h} max={s.email.dailyLimit} />
        </div>
        <Kpi label="Emails sent" value={emailSent} note={s.email.nextSendAt ? `Next ${fmt(s.email.nextSendAt)}` : "Nothing queued"} />
        <Kpi label="Replies" value={replies} note={contacted ? `${Math.round((replies / contacted) * 100)}% of contacted` : "—"} />
        <Kpi label="Bounced" value={bounced} note={emailSent ? `${Math.round((bounced / emailSent) * 100)}% of sent` : "—"} />
      </div>

      {nothing && (
        <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
          <div className="text-[15px] font-semibold">Start your first campaign</div>
          <div className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">Pick who to reach and write one brief. Every lead gets its own draft, you review them, then approve them all at once. Emails go out from {s.email.from}.</div>
          <Button variant="primary" className="mt-4" onClick={onNew}>
            <Plus size={14} /> New campaign
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TARGETS.map((t) => {
          const m = s.byTarget[t.id] ?? {};
          const rows: [string, number][] = (t.channel === "email" ? ["draft", "scheduled", "sent", "delivered", "replied", "bounced"] : t.id === "founder_linkedin" ? ["draft", "todo", "invited", "connected", "messaged", "replied"] : ["draft", "todo", "followed", "messaged", "replied"]).map((k) => [k, m[k] ?? 0]);
          return (
            <div key={t.id} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
                  <TargetIcon target={t.id} /> {t.label}
                </span>
                {t.id === "founder_linkedin" && (
                  <span className="text-[11px] tabular-nums text-muted">
                    {s.linkedin.invitesToday}/{s.linkedin.dailyLimit} today
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1.5">
                {rows.map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between text-[12px]">
                    <span className="text-ink-2">{STATUS_META[k]?.label}</span>
                    <span className={cx("tabular-nums", n ? "font-medium text-ink" : "text-muted")}>{n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <h2 className="text-[13px] font-semibold">Recent outreach</h2>
          <span className="text-[11.5px] text-muted">From {s.email.from}</span>
        </div>
        {s.recent.length === 0 ? (
          <div className="px-4 pb-5 text-[12.5px] text-muted">Nothing sent yet.</div>
        ) : (
          <ol className="divide-y divide-line">
            {s.recent.map((r) => (
              <li key={r.id}>
                <button onClick={() => onOpenLead(r.lead_id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px] hover:bg-panel/50">
                  <TargetIcon target={r.target} />
                  <span className="w-52 shrink-0 truncate font-medium">{r.lead?.company_name}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.subject ?? r.recipient_name ?? r.recipient}</span>
                  <OStatus status={r.status} />
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted">{timeAgo(r.updated_at)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight">{value.toLocaleString()}</div>
      {note && <div className="text-[11px] text-muted">{note}</div>}
    </div>
  );
}

// ---------------- Campaigns ----------------

function CampaignsTab({ onNew }: { onNew: () => void }) {
  const [list, setList] = useState<Campaign[] | null>(null);
  useEffect(() => {
    const load = () => api<Campaign[]>("/api/outreach/campaigns").then(setList).catch(() => setList([]));
    load();
    const t = setInterval(() => !document.hidden && load(), 10_000);
    return () => clearInterval(t);
  }, []);
  if (!list)
    return (
      <div className="flex justify-center py-20">
        <PixelLoader className="scale-150" />
      </div>
    );
  if (!list.length)
    return (
      <div className="px-6 py-16 text-center">
        <div className="text-[14px] font-semibold">No campaigns yet</div>
        <Button variant="primary" className="mt-3" onClick={onNew}>
          <Plus size={14} /> New campaign
        </Button>
      </div>
    );

  return (
    <div className="px-6 py-5">
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="px-4 py-2 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 text-right font-medium">To review</th>
              <th className="px-3 py-2 text-right font-medium">Sent</th>
              <th className="px-3 py-2 text-right font-medium">Replied</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const n = c.counts ?? {};
              const total = Object.values(n).reduce((a, b) => a + b, 0);
              const out = ["sent", "delivered", "bounced", "invited", "connected", "messaged", "followed", "replied"].reduce((a, k) => a + (n[k] ?? 0), 0);
              const done = out + (n.skipped ?? 0) + (n.failed ?? 0);
              return (
                <tr key={c.id} className="group border-t border-line hover:bg-panel/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/outreach/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-[11px] text-muted">
                      {timeAgo(c.created_at)} · {c.status === "generating" ? <span className="shimmer-text font-medium">writing drafts</span> : c.status}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-ink-2">
                      <TargetIcon target={c.target} /> <TargetLabel target={c.target} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-28 overflow-hidden rounded-full bg-panel-2">
                        <div className={cx("h-full rounded-full bg-ink", c.status === "sending" && "progress-live")} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-muted">
                        {done}/{total}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{(n.draft ?? 0) + (n.generating ?? 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{out}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n.replied ?? 0}</td>
                  <td className="pr-3">
                    <Link href={`/outreach/${c.id}`} className="text-muted opacity-0 group-hover:opacity-100" aria-label="Open">
                      <ArrowUpRight size={14} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- LinkedIn tasks ----------------

const LI_STEPS = [
  { status: "todo", label: "To do", hint: "Open the profile, send the invite with the note (or follow the page), then mark it." },
  { status: "invited", label: "Invite sent", hint: "Waiting for them to accept. Mark accepted ones, then send the follow-up message." },
  { status: "connected", label: "Connected", hint: "Send the follow-up message, then mark it." },
  { status: "followed", label: "Page followed", hint: "Message the page if it accepts messages." },
  { status: "messaged", label: "Messaged", hint: "Mark the ones that replied." },
];

function LinkedInTab({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [status, setStatus] = useState("todo");
  const [data, setData] = useState<{ items: (OutreachItem & { lead?: { company_name: string | null; location: string | null }; campaign?: { name: string } | null })[]; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(() => api<NonNullable<typeof data>>(`/api/outreach/linkedin?status=${status}`).then(setData).catch(() => {}), [status]);
  useEffect(() => {
    setData(null);
    load();
    api<Stats>("/api/outreach/stats").then(setStats).catch(() => {});
  }, [load]);

  const step = LI_STEPS.find((s) => s.status === status)!;
  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-panel p-0.5">
          {LI_STEPS.map((s) => (
            <button key={s.status} onClick={() => setStatus(s.status)} className={cx("rounded-md px-2.5 py-1 text-[12px]", status === s.status ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted hover:text-ink-2")}>
              {s.label}
            </button>
          ))}
        </div>
        {stats && (
          <div className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            Invites today <span className="font-semibold tabular-nums text-ink">{stats.linkedin.invitesToday}</span>/{stats.linkedin.dailyLimit}
            <Meter className="w-24" value={stats.linkedin.invitesToday} max={stats.linkedin.dailyLimit} />
          </div>
        )}
      </div>
      <div className="mb-4 rounded-xl bg-panel px-4 py-2.5 text-[12.5px] text-ink-2">{step.hint} LinkedIn is never automated, so your account stays safe.</div>

      {!data ? (
        <div className="flex justify-center py-16">
          <PixelLoader className="scale-150" />
        </div>
      ) : data.items.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-muted">Nothing here. LinkedIn campaigns add tasks once you approve their drafts.</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.items.map((i) => (
            <div key={i.id} className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <button onClick={() => onOpenLead(i.lead_id)} className="min-w-0 text-left">
                  <div className="truncate text-[13.5px] font-semibold hover:underline">{i.lead?.company_name}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    {i.target === "founder_linkedin" ? i.recipient_name ?? "Founder" : "Company page"} · {i.campaign?.name ?? "One-off"}
                  </div>
                </button>
                <OStatus status={i.status} />
              </div>
              <ItemEditor
                item={i}
                compact
                onChange={(u) => {
                  if (u.status !== status) setData((d) => (d ? { items: d.items.filter((x) => x.id !== u.id), total: d.total - 1 } : d));
                  else setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : d));
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Tracking ----------------

interface TrackRow {
  id: string;
  company_name: string | null;
  domain: string | null;
  founder_name: string | null;
  founder_email: string | null;
  founder_email_status: string | null;
  founder_linkedin: string | null;
  company_linkedin: string | null;
  generic_emails: string[];
  outreach: Record<string, string>;
  updated_at: string;
}

const TRACK_STATUS = [
  ["none", "Not started"],
  ["draft", "Draft"],
  ["scheduled", "Queued"],
  ["todo", "To do"],
  ["sent", "Sent"],
  ["delivered", "Delivered"],
  ["invited", "Invited"],
  ["messaged", "Messaged"],
  ["replied", "Replied"],
  ["bounced", "Bounced"],
] as const;

function TrackingTab({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const { uploads } = useApp();
  const [uploadId, setUploadId] = useState<string>("");
  const [channel, setChannel] = useState<Target | "">("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [touched, setTouched] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: TrackRow[]; total: number } | null>(null);

  useEffect(() => {
    if (!uploadId && uploads?.[0]) setUploadId(uploads[0].id);
  }, [uploads, uploadId]);
  useEffect(() => setPage(0), [uploadId, channel, statuses, touched, q]);

  useEffect(() => {
    if (!uploadId) return;
    const qs = new URLSearchParams({ upload: uploadId, page: String(page), size: "100", status: "done" });
    if (channel && statuses.length) {
      qs.set("oc", channel);
      qs.set("os", statuses.join(","));
    }
    if (touched && !(channel && statuses.includes("none"))) qs.set("touched", "1");
    if (q.trim()) qs.set("q", q.trim());
    const t = setTimeout(() => api<{ rows: TrackRow[]; total: number }>(`/api/leads?${qs}`).then(setData).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [uploadId, channel, statuses, touched, q, page]);

  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={uploadId} onChange={(e) => setUploadId(e.target.value)} className="h-8 rounded-lg border border-line-strong bg-white px-2 text-[12.5px] outline-none focus:border-ink">
          {uploads?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.filename}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-48 rounded-lg border border-line-strong pl-8 pr-2 text-[12.5px] outline-none focus:border-ink" />
        </div>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Target | "")} className="h-8 rounded-lg border border-line-strong bg-white px-2 text-[12.5px] outline-none focus:border-ink">
          <option value="">Any channel</option>
          {TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {channel && (
          <div className="flex flex-wrap gap-1">
            {TRACK_STATUS.map(([k, label]) => {
              const on = statuses.includes(k);
              return (
                <button key={k} onClick={() => setStatuses((s) => (on ? s.filter((x) => x !== k) : [...s, k]))} className={cx("h-7 rounded-lg border px-2 text-[11.5px]", on ? "border-ink bg-ink text-white" : "border-line-strong text-ink-2")}>
                  {label}
                </button>
              );
            })}
          </div>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={touched} onChange={(e) => setTouched(e.target.checked)} className="accent-[#1f1f1f]" />
          Only leads with outreach
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Founder</th>
              {TARGETS.map((t) => (
                <th key={t.id} className="px-2 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    <TargetIcon target={t.id} size={11} /> {t.id.startsWith("founder") ? "Founder" : "Company"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} onClick={() => onOpenLead(r.id)} className="cursor-pointer border-t border-line hover:bg-panel/50">
                <td className="px-4 py-2">
                  <div className="max-w-[240px] truncate font-medium">{r.company_name}</div>
                  <div className="truncate font-mono text-[11px] text-muted">{r.domain}</div>
                </td>
                <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">{r.founder_name ?? "—"}</td>
                {TARGETS.map((t) => {
                  const has = t.id === "founder_email" ? !!r.founder_email : t.id === "company_email" ? !!r.generic_emails?.length : t.id === "founder_linkedin" ? !!r.founder_linkedin : !!r.company_linkedin;
                  const s = r.outreach?.[t.id];
                  return <td key={t.id} className="px-2 py-2">{s ? <OStatus status={s} /> : <span className={cx("text-[11.5px]", has ? "text-muted" : "text-line-strong")}>{has ? "Not started" : "—"}</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <div className="py-12 text-center text-[12.5px] text-muted">{touched ? "No outreach yet for this upload. Untick 'Only leads with outreach' to see everyone." : "No leads match."}</div>}
        {!data && (
          <div className="flex justify-center py-12">
            <PixelLoader className="scale-150" />
          </div>
        )}
      </div>
      {data && data.total > 100 && (
        <div className="mt-2 flex items-center justify-end gap-1 text-[12px] text-muted">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} />
          </Button>
          {page + 1} / {Math.ceil(data.total / 100)}
          <Button size="sm" variant="ghost" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
      <div className="mt-3">
        <ChannelLegend />
      </div>
    </div>
  );
}

function ChannelLegend() {
  return <div className="text-[11.5px] text-muted">Click a lead to see every message on every channel, write a one-off message, or mark a reply.</div>;
}
