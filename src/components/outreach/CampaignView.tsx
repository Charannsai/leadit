"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CalendarClock, ChevronDown, Paperclip, Pause, Play, Send, SkipForward, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import type { Campaign, OutreachItem } from "@/lib/outreach/types";
import { Button, PixelLoader, cx } from "../ui";
import { ItemEditor, OStatus, TargetIcon, TargetLabel } from "./shared";

type Item = OutreachItem & { lead?: { company_name: string | null; domain: string | null; founder_title: string | null; location: string | null } };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "To review", match: ["draft", "generating", "paused"] },
  { key: "queued", label: "Queued", match: ["scheduled", "sending", "todo"] },
  { key: "out", label: "Sent", match: ["sent", "delivered", "invited", "connected", "messaged", "followed", "replied"] },
  { key: "problem", label: "Problems", match: ["failed", "bounced"] },
  { key: "skipped", label: "Skipped", match: ["skipped"] },
];

export function CampaignView({ id }: { id: string }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const sig = useRef("");

  const load = useCallback(async () => {
    const r = await api<{ campaign: Campaign; items: Item[] }>(`/api/outreach/campaigns/${id}`);
    const s = r.campaign.status + r.items.map((i) => i.id + i.updated_at).join();
    if (s === sig.current) return;
    sig.current = s;
    setCampaign(r.campaign);
    setItems(r.items);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // Refresh quickly only while something is about to change: drafts being written, or an
  // email going out within the next few minutes. A send scheduled for tomorrow doesn't count.
  const soon = Date.now() + 3 * 60_000;
  const live = items.some((i) => i.status === "generating" || i.status === "sending" || (i.status === "scheduled" && !!i.scheduled_at && Date.parse(i.scheduled_at) < soon));
  useEffect(() => {
    const t = setInterval(() => !document.hidden && load().catch(() => {}), live ? 4000 : 20_000);
    return () => clearInterval(t);
  }, [live, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return f?.match ? items.filter((i) => f.match!.includes(i.status)) : items;
  }, [items, filter]);
  const selected = items.find((i) => i.id === selectedId) ?? shown[0] ?? null;

  async function act(action: "approve" | "unschedule" | "regenerate" | "skip" | "pause_drafting" | "resume_drafting", onlyChecked: boolean) {
    setBusy(action);
    try {
      const r = await api<{ scheduled?: number; count?: number; firstAt?: string; lastAt?: string }>(`/api/outreach/campaigns/${id}`, {
        method: "POST",
        body: JSON.stringify({ action, ids: onlyChecked ? [...checked] : undefined }),
      });
      if (action === "approve" && r.scheduled)
        setToast(`${r.scheduled} emails queued. First goes out ${fmt(r.firstAt!)}, last ${fmt(r.lastAt!)}.`);
      else if (action === "approve") setToast(`${r.count ?? 0} added to LinkedIn tasks`);
      else if (action === "pause_drafting") setToast(`Drafting paused. ${r.count ?? 0} drafts left to write.`);
      else if (action === "resume_drafting") setToast(`Drafting resumed for the ${r.count ?? 0} remaining leads`);
      else setToast(`${r.count ?? r.scheduled ?? 0} updated`);
      setChecked(new Set());
      sig.current = "";
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this campaign and its unsent drafts?")) return;
    try {
      await api(`/api/outreach/campaigns/${id}`, { method: "DELETE" });
      router.push("/outreach?tab=campaigns");
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  if (error) return <div className="p-8 text-[13px] text-[#b4403b]">{error}</div>;
  if (!campaign)
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelLoader className="scale-150" />
      </div>
    );

  const isEmail = campaign.channel === "email";
  const drafts = counts.draft ?? 0;
  const writing = counts.generating ?? 0;
  const paused = counts.paused ?? 0;
  const total = items.length;
  const done = total - writing - paused;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="border-b border-line px-6 pb-4 pt-4">
        <Link href="/outreach?tab=campaigns" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
          <ArrowLeft size={12} /> Campaigns
        </Link>
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-semibold tracking-tight">{campaign.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <TargetIcon target={campaign.target} /> <TargetLabel target={campaign.target} />
              </span>
              <span>· {total.toLocaleString()} leads</span>
              {campaign.tone && <span>· {campaign.tone}</span>}
              {campaign.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  · <Paperclip size={11} /> {campaign.attachments.map((a) => a.name).join(", ")}
                </span>
              )}
              <button onClick={() => setShowBrief((v) => !v)} className="inline-flex items-center gap-0.5 hover:text-ink">
                · Brief <ChevronDown size={12} className={cx("transition-transform", showBrief && "rotate-180")} />
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={remove} title="Delete campaign">
              <Trash2 size={13} />
            </Button>
            {paused > 0 && writing === 0 && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#946215]">
              <Pause size={12} /> Drafting paused · {done}/{total} written
            </span>
          )}
          {writing > 0 && (
              <Button onClick={() => act("pause_drafting", false)} disabled={!!busy}>
                {busy === "pause_drafting" ? <PixelLoader /> : <Pause size={13} />} Pause drafting
              </Button>
            )}
            {paused > 0 && (
              <Button onClick={() => act("resume_drafting", false)} disabled={!!busy}>
                {busy === "resume_drafting" ? <PixelLoader /> : <Play size={13} />} Resume drafting · {paused.toLocaleString()} left
              </Button>
            )}
            {(counts.scheduled ?? 0) > 0 && (
              <Button onClick={() => act("unschedule", false)} disabled={!!busy}>
                <Undo2 size={13} /> Pause sending
              </Button>
            )}
            <Button variant="primary" onClick={() => act("approve", false)} disabled={!!busy || !drafts}>
              {busy === "approve" ? <PixelLoader className="[&>span]:bg-white" /> : <Send size={13} />}
              {isEmail ? `Approve & send ${drafts ? drafts.toLocaleString() : "all"}` : `Add ${drafts ? drafts.toLocaleString() : "all"} to LinkedIn tasks`}
            </Button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {showBrief && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 whitespace-pre-wrap rounded-xl bg-panel px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
                {campaign.brief}
                {campaign.cta && <div className="mt-2 text-muted">Call to action: {campaign.cta}</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* progress */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          {writing > 0 && (
            <span className="inline-flex items-center gap-2">
              <PixelLoader /> <span className="shimmer-text font-medium">Writing drafts · {done}/{total}</span>
            </span>
          )}
          {[
            ["draft", "To review"],
            ["scheduled", "Queued"],
            ["todo", "LinkedIn to-do"],
            ["sent", "Sent"],
            ["delivered", "Delivered"],
            ["invited", "Invites sent"],
            ["messaged", "Messaged"],
            ["replied", "Replied"],
            ["bounced", "Bounced"],
            ["failed", "Failed"],
            ["skipped", "Skipped"],
          ]
            .filter(([k]) => counts[k])
            .map(([k, label]) => (
              <span key={k} className="text-muted">
                {label} <span className="font-semibold tabular-nums text-ink">{counts[k].toLocaleString()}</span>
              </span>
            ))}
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-panel-2">
          <div className={cx("h-full rounded-full bg-ink transition-[width] duration-700", live && "progress-live")} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[42%] min-w-[340px] flex-col border-r border-line">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2">
            {FILTERS.map((f) => {
              const n = f.match ? f.match.reduce((a, s) => a + (counts[s] ?? 0), 0) : total;
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} className={cx("whitespace-nowrap rounded-md px-2.5 py-1 text-[12px]", filter === f.key ? "bg-panel-2 text-ink" : "text-muted hover:text-ink-2")}>
                  {f.label} <span className="tabular-nums text-muted">{n}</span>
                </button>
              );
            })}
          </div>
          {checked.size > 0 && (
            <div className="flex items-center gap-1.5 border-b border-line bg-panel/60 px-3 py-1.5 text-[12px]">
              <span className="text-ink-2">{checked.size} selected</span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => act("regenerate", true)} disabled={!!busy}>
                  Rewrite
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act("skip", true)} disabled={!!busy}>
                  <SkipForward size={12} /> Skip
                </Button>
                <Button size="sm" variant="primary" onClick={() => act("approve", true)} disabled={!!busy}>
                  {isEmail ? "Approve & send" : "Add to tasks"}
                </Button>
              </div>
            </div>
          )}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {shown.map((i) => (
              <div
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={cx("flex cursor-pointer gap-2.5 border-b border-line px-3 py-2.5", selected?.id === i.id ? "bg-panel" : "hover:bg-panel/50")}
              >
                <input
                  type="checkbox"
                  checked={checked.has(i.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() =>
                    setChecked((s) => {
                      const n = new Set(s);
                      if (n.has(i.id)) n.delete(i.id);
                      else n.add(i.id);
                      return n;
                    })
                  }
                  className="mt-1 accent-[#1f1f1f]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium">{i.lead?.company_name ?? "—"}</span>
                    <OStatus status={i.status} />
                  </div>
                  <div className="truncate text-[11.5px] text-muted">{i.recipient_name ? `${i.recipient_name} · ` : ""}{i.recipient}</div>
                  {i.status !== "generating" && (
                    <div className="mt-0.5 truncate text-[12px] text-ink-2">{i.subject ?? i.note ?? i.body?.slice(0, 90)}</div>
                  )}
                  {i.status === "scheduled" && i.scheduled_at && (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#3b5fb4]">
                      <CalendarClock size={11} /> {fmt(i.scheduled_at)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!shown.length && <div className="py-12 text-center text-[12.5px] text-muted">Nothing here.</div>}
          </div>
        </div>

        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold">{selected.lead?.company_name}</div>
                  <div className="text-[12px] text-muted">
                    {selected.lead?.domain}
                    {selected.lead?.location ? ` · ${selected.lead.location}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <OStatus status={selected.status} />
                  {selected.sent_at && <span className="text-[11px] text-muted">Sent {timeAgo(selected.sent_at)}</span>}
                  {selected.status === "scheduled" && selected.scheduled_at && <span className="text-[11px] text-muted">Goes out {fmt(selected.scheduled_at)}</span>}
                </div>
              </div>
              <ItemEditor
                item={selected}
                onChange={(u) => {
                  setItems((list) => list.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
                  sig.current = "";
                }}
              />
            </motion.div>
          ) : (
            <div className="py-20 text-center text-[13px] text-muted">Select a message.</div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} className="fixed bottom-5 left-1/2 z-[60] max-w-xl -translate-x-1/2 rounded-xl bg-accent px-4 py-2.5 text-[13px] text-white shadow-lg">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function fmt(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(Date.now() + 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `today ${time}` : tomorrow ? `tomorrow ${time}` : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}
