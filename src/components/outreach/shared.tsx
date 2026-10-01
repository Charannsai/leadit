"use client";

import { Check, Copy, ExternalLink, Mail, Paperclip, RotateCcw, Send, SkipForward, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { STATUS_META, TARGETS, type Attachment, type OutreachItem, type Target } from "@/lib/outreach/types";
import { Button, LinkedInIcon, Pill, PixelLoader, cx } from "../ui";

export function OStatus({ status }: { status?: string | null }) {
  if (!status) return <span className="text-[12px] text-line-strong">—</span>;
  if (status === "generating")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px]">
        <PixelLoader /> <span className="shimmer-text font-medium">Writing…</span>
      </span>
    );
  const m = STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Pill tone={m.tone} dot>
      {m.label}
    </Pill>
  );
}

export function TargetIcon({ target, size = 12 }: { target: Target | string; size?: number }) {
  return target.endsWith("linkedin") ? <LinkedInIcon size={size} /> : <Mail size={size} />;
}

export function TargetLabel({ target }: { target: string }) {
  if (target === "best_email") return <>Founder email, else company email</>;
  return <>{TARGETS.find((t) => t.id === target)?.label ?? target}</>;
}

/** The four channels of one lead as compact pills (used in tables). */
export function ChannelStrip({ outreach, available }: { outreach: Record<string, string> | null | undefined; available?: Partial<Record<Target, boolean>> }) {
  return (
    <div className="flex items-center gap-1">
      {TARGETS.map((t) => {
        const s = outreach?.[t.id];
        const has = available ? available[t.id] : true;
        const m = s ? STATUS_META[s] : null;
        const tone = m?.tone ?? "neutral";
        return (
          <span
            key={t.id}
            title={`${t.label}: ${m?.label ?? (has ? "not started" : "nothing to contact")}`}
            className={cx(
              "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px]",
              !s && (has ? "border border-dashed border-line-strong text-muted" : "text-line-strong"),
              s && tone === "green" && "bg-[#ecf7ef] text-[#2f7a45]",
              s && tone === "dark" && "bg-accent text-white",
              s && tone === "blue" && "bg-[#eef3fd] text-[#3b5fb4]",
              s && tone === "amber" && "bg-[#fdf4e3] text-[#946215]",
              s && tone === "red" && "bg-[#fdeeee] text-[#b4403b]",
              s && tone === "violet" && "bg-[#f3effd] text-[#6a48b4]",
              s && tone === "neutral" && "bg-panel-2 text-ink-2",
            )}
          >
            <TargetIcon target={t.id} size={10} />
            {t.id.startsWith("founder") ? "F" : "C"}
          </span>
        );
      })}
    </div>
  );
}

export function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {label ?? (done ? "Copied" : "Copy")}
    </Button>
  );
}

/** Uploads files straight to Supabase Storage through a one-time URL. */
export function AttachmentPicker({ value, onChange }: { value: Attachment[]; onChange: (a: Attachment[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList) {
    setBusy(true);
    setError(null);
    const added: Attachment[] = [];
    try {
      for (const f of Array.from(files)) {
        const { url, path } = await api<{ url: string; path: string }>("/api/outreach/attachments", { method: "POST", body: JSON.stringify({ name: f.name, size: f.size }) });
        const res = await fetch(url, { method: "PUT", body: f, headers: { "Content-Type": f.type || "application/octet-stream", "x-upsert": "false" } });
        if (!res.ok) throw new Error(`Upload of ${f.name} failed (${res.status})`);
        added.push({ name: f.name, path, size: f.size, type: f.type });
      }
      onChange([...value, ...added]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const total = value.reduce((n, a) => n + a.size, 0);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((a) => (
          <span key={a.path} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel/60 pl-2 pr-1 text-[12px]">
            <Paperclip size={11} className="text-muted" />
            <span className="max-w-[180px] truncate">{a.name}</span>
            <span className="text-[10.5px] text-muted">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
            <button onClick={() => onChange(value.filter((x) => x.path !== a.path))} className="rounded p-0.5 text-muted hover:text-ink" aria-label={`Remove ${a.name}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <PixelLoader /> : <Paperclip size={12} />} Attach files
        </Button>
        {total > 0 && <span className="text-[11px] text-muted">{(total / 1024 / 1024).toFixed(1)} MB total · max 10 MB each</span>}
      </div>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => e.target.files && add(e.target.files).finally(() => (e.target.value = ""))} />
      {error && <div className="mt-1.5 text-[12px] text-[#b4403b]">{error}</div>}
    </div>
  );
}

/**
 * Shows and edits one outreach message, with the actions that fit its channel and status.
 * Saves text on blur. onChange receives the updated item from the server.
 */
export function ItemEditor({ item, onChange, compact }: { item: OutreachItem; onChange: (i: OutreachItem) => void; compact?: boolean }) {
  const [subject, setSubject] = useState(item.subject ?? "");
  const [body, setBody] = useState(item.body ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState(item.id + item.updated_at);

  // Pick up server-side changes (e.g. a regenerated draft) unless the user is mid-edit.
  if (lastId !== item.id + item.updated_at && busy === null) {
    setLastId(item.id + item.updated_at);
    setSubject(item.subject ?? "");
    setBody(item.body ?? "");
    setNote(item.note ?? "");
  }

  const editable = ["draft", "todo", "scheduled", "failed"].includes(item.status);
  const isEmail = item.channel === "email";

  async function run(label: string, fn: () => Promise<OutreachItem>) {
    setBusy(label);
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const save = () => {
    if (subject === (item.subject ?? "") && body === (item.body ?? "") && note === (item.note ?? "")) return;
    run("save", () => api(`/api/outreach/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ subject, body, note }) }));
  };
  const setStatus = (status: string) => run(status, () => api(`/api/outreach/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }));
  const action = (a: "send" | "regenerate") => run(a, () => api(`/api/outreach/items/${item.id}`, { method: "POST", body: JSON.stringify({ action: a }) }));

  if (item.status === "generating")
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-[13px]">
        <PixelLoader /> <span className="shimmer-text font-medium">Writing a personalised draft…</span>
      </div>
    );

  if (item.status === "paused")
    return (
      <div className="rounded-xl border border-dashed border-[#ecd9b0] bg-[#fdf9f0] px-4 py-6 text-[13px] text-[#946215]">
        Drafting is paused for this campaign. Press <b className="font-medium">Resume drafting</b> and this draft gets written next.
      </div>
    );

  const field = "w-full rounded-lg border border-line-strong bg-white px-3 text-[13px] leading-relaxed outline-none focus:border-ink disabled:border-line disabled:bg-panel/40 disabled:text-ink-2";

  return (
    <div className="space-y-3">
      {isEmail ? (
        <>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="w-14 shrink-0">To</span>
            <span className="truncate font-mono text-[12px] text-ink">{item.recipient}</span>
            {item.recipient_name && <span className="truncate">· {item.recipient_name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[12px] text-muted">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={save} disabled={!editable} className={cx(field, "h-9")} />
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} disabled={!editable} rows={compact ? 8 : 11} className={cx(field, "resize-y py-2.5")} />
          <div className="text-[11px] text-muted">Your signature and opt-out line are added below the body when it&apos;s sent.</div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <a href={item.recipient ?? "#"} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#0a66c2] hover:underline">
              <LinkedInIcon size={12} />
              <span className="truncate">{item.recipient_name ?? item.recipient?.replace(/^https?:\/\/(www\.)?/, "")}</span>
              <ExternalLink size={11} />
            </a>
          </div>
          {item.target === "founder_linkedin" && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] font-medium text-ink-2">1 · Connection note</span>
                <span className={cx("text-[11px] tabular-nums", note.length > 300 ? "text-[#b4403b]" : "text-muted")}>{note.length}/300</span>
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} disabled={!editable && item.status !== "todo"} rows={3} className={cx(field, "resize-y py-2")} />
              <div className="mt-1 flex justify-end">
                <CopyBtn text={note} label="Copy note" />
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-2">{item.target === "founder_linkedin" ? "2 · Message after they accept" : "Message to the page"}</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} disabled={!editable && !["todo", "invited", "connected"].includes(item.status)} rows={compact ? 6 : 8} className={cx(field, "resize-y py-2.5")} />
            <div className="mt-1 flex justify-end">
              <CopyBtn text={body} label="Copy message" />
            </div>
          </div>
        </>
      )}

      {item.error && item.status === "failed" && <div className="rounded-lg bg-[#fdeeee] px-3 py-2 text-[12px] text-[#b4403b]">{item.error}</div>}
      {error && <div className="rounded-lg bg-[#fdeeee] px-3 py-2 text-[12px] text-[#b4403b]">{error}</div>}

      <div className="flex flex-wrap items-center gap-1.5">
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => action("regenerate")} disabled={!!busy}>
            <RotateCcw size={12} /> Rewrite
          </Button>
        )}
        {editable && item.status !== "todo" && (
          <Button size="sm" variant="ghost" onClick={() => setStatus("skipped")} disabled={!!busy}>
            <SkipForward size={12} /> Skip
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {isEmail && ["draft", "failed", "scheduled"].includes(item.status) && (
            <Button size="sm" variant="primary" onClick={() => action("send")} disabled={!!busy}>
              {busy === "send" ? <PixelLoader className="[&>span]:bg-white" /> : <Send size={12} />} Send now
            </Button>
          )}
          {!isEmail && <LinkedInActions item={item} busy={busy} setStatus={setStatus} />}
          {["sent", "delivered", "invited", "connected", "messaged", "followed"].includes(item.status) && (
            <Button size="sm" onClick={() => setStatus("replied")} disabled={!!busy}>
              <Check size={12} /> They replied
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkedInActions({ item, busy, setStatus }: { item: OutreachItem; busy: string | null; setStatus: (s: string) => void }) {
  const open = () => item.recipient && window.open(item.recipient, "_blank", "noopener");
  const b = (label: string, status: string, primary = false) => (
    <Button size="sm" variant={primary ? "primary" : "secondary"} onClick={() => setStatus(status)} disabled={!!busy}>
      {label}
    </Button>
  );
  const founder = item.target === "founder_linkedin";
  return (
    <>
      <Button size="sm" variant="ghost" onClick={open}>
        <ExternalLink size={12} /> Open
      </Button>
      {item.status === "draft" && b("Add to tasks", "todo", true)}
      {item.status === "todo" && (founder ? b("Invite sent", "invited", true) : <>{b("Followed", "followed")}{b("Message sent", "messaged", true)}</>)}
      {item.status === "invited" && b("They accepted", "connected", true)}
      {item.status === "connected" && b("Message sent", "messaged", true)}
      {item.status === "followed" && b("Message sent", "messaged", true)}
    </>
  );
}
