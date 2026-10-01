"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Building2, Check, RefreshCw, Sparkles, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { ExportFilters } from "@/lib/exportColumns";
import { TONES, type Attachment, type CampaignTarget } from "@/lib/outreach/types";
import { useApp } from "../AppShell";
import { Button, EmailStatus, LinkedInIcon, Modal, PixelLoader, Toggle, cx } from "../ui";
import { AttachmentPicker, ChannelStrip } from "./shared";

const TARGET_OPTIONS: { id: CampaignTarget; title: string; hint: string; icon: "mail" | "in"; who: "person" | "company" | "best" }[] = [
  { id: "best_email", title: "Best email", hint: "Founder's email, or the company inbox when there isn't one", icon: "mail", who: "best" },
  { id: "founder_email", title: "Founder email", hint: "Only leads with a founder email", icon: "mail", who: "person" },
  { id: "company_email", title: "Company email", hint: "info@, hello@, sales@ … inboxes", icon: "mail", who: "company" },
  { id: "founder_linkedin", title: "Founder LinkedIn", hint: "Connection note + follow-up message, sent by you", icon: "in", who: "person" },
  { id: "company_linkedin", title: "Company page", hint: "Follow the page and message it if it accepts messages", icon: "in", who: "company" },
];

const EMAIL_OPTS = [["valid", "Verified"], ["accept_all", "Catch-all"], ["unknown", "Unknown"], ["unverified", "Unverified"]] as const;
const OUTCOME_OPTS = [["founder", "Founder found"], ["company", "Company contacts only"]] as const;

interface SampleLead {
  id: string;
  company_name: string | null;
  domain: string | null;
  founder_name: string | null;
  founder_title: string | null;
  founder_email: string | null;
  founder_email_status: string | null;
  generic_emails: string[];
  founder_linkedin: string | null;
  company_linkedin: string | null;
  outreach: Record<string, string>;
}

interface Preview {
  lead: { company_name: string | null; domain: string | null };
  recipient: { name: string | null; address: string };
  draft: { subject: string | null; body: string; note: string | null };
  signature: string;
  optOutLine: string;
}

export function CampaignWizard({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: { uploadId?: string; ids?: string[]; target?: CampaignTarget } }) {
  const router = useRouter();
  const { uploads } = useApp();
  const [step, setStep] = useState(0);
  const [uploadId, setUploadId] = useState<string>("");
  const [ids, setIds] = useState<string[] | undefined>();
  const [target, setTarget] = useState<CampaignTarget>("best_email");
  const [filters, setFilters] = useState<ExportFilters>({ statuses: ["done"] });
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [sample, setSample] = useState<SampleLead[]>([]);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [cta, setCta] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setUploadId(initial?.uploadId ?? uploads?.[0]?.id ?? "");
    setIds(initial?.ids);
    setTarget(initial?.target ?? "best_email");
    setFilters(initial?.ids ? {} : { statuses: ["done"] });
    setPreview(null);
    setError(null);
  }, [open, initial, uploads]);

  const upload = uploads?.find((u) => u.id === uploadId);
  const isEmail = !target.endsWith("linkedin");
  const audience = useMemo(() => ({ uploadId, filters, excludeContacted, ids }), [uploadId, filters, excludeContacted, ids]);

  useEffect(() => {
    if (!open || !uploadId) return;
    setCount(null);
    const t = setTimeout(() => {
      api<{ count: number; sample: SampleLead[] }>("/api/outreach/audience", { method: "POST", body: JSON.stringify({ ...audience, target }) })
        .then((r) => {
          setCount(r.count);
          setSample(r.sample);
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [open, audience, target, uploadId]);

  async function writeSample(skip: number) {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await api<Preview>("/api/outreach/preview", { method: "POST", body: JSON.stringify({ audience, target, brief, tone, cta, attachmentNames: attachments.map((a) => a.name), skip }) }));
      setPreviewIdx(skip);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const r = await api<{ id: string; created: number }>("/api/outreach/campaigns", {
        method: "POST",
        body: JSON.stringify({ name: name || defaultName, target, brief, tone, cta, attachments: isEmail ? attachments : [], audience }),
      });
      onClose();
      router.push(`/outreach/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const toggleIn = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const defaultName = `${TARGET_OPTIONS.find((t) => t.id === target)?.title} · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const steps = ["Who", "Message", "Confirm"];

  return (
    <Modal open={open} onClose={() => !busy && onClose()} width={1000} title="New outreach campaign">
      {/* stepper */}
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", i < step ? "bg-ink text-white" : i === step ? "border border-ink text-ink" : "border border-line-strong text-muted")}>
              {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cx("text-[12.5px]", i === step ? "font-medium text-ink" : "text-muted")}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-line-strong" />}
          </div>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
            {step === 0 && (
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5">
                  <Field label="Reach out through">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {TARGET_OPTIONS.map((t) => (
                        <button key={t.id} onClick={() => setTarget(t.id)} className={cx("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", target === t.id ? "border-ink bg-white shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-line-strong")}>
                          <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", t.icon === "in" ? "bg-[#eef3fd] text-[#0a66c2]" : "bg-panel-2 text-ink-2")}>
                            {t.icon === "in" ? <LinkedInIcon size={13} /> : t.who === "company" ? <Building2 size={14} /> : <User size={14} />}
                          </span>
                          <span>
                            <span className="block text-[13px] font-medium">{t.title}</span>
                            <span className="block text-[11.5px] leading-snug text-muted">{t.hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="From upload">
                    <select value={uploadId} onChange={(e) => (setUploadId(e.target.value), setIds(undefined))} className="h-8 w-full rounded-lg border border-line-strong bg-white px-2 text-[13px] outline-none focus:border-ink">
                      {uploads?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.filename} · {u.total_rows.toLocaleString()} rows
                        </option>
                      ))}
                    </select>
                    {ids && (
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
                        Only the {ids.length} rows you selected on the Leads page.
                        <button className="text-muted underline hover:text-ink" onClick={() => setIds(undefined)}>
                          Use filters instead
                        </button>
                      </div>
                    )}
                  </Field>

                  {upload && upload.sheets.length > 1 && (
                    <Field label="Sheets" hint={filters.sheets?.length ? undefined : "All"}>
                      <Chips options={upload.sheets.map((s) => [s.name, s.name] as const)} value={filters.sheets} onToggle={(v) => setFilters({ ...filters, sheets: toggleIn(filters.sheets, v) })} />
                    </Field>
                  )}
                  <div className="grid gap-5 sm:grid-cols-2">
                    {isEmail && target !== "company_email" && (
                      <Field label="Founder email quality" hint={filters.emailStatuses?.length ? undefined : "Any"}>
                        <Chips options={EMAIL_OPTS} value={filters.emailStatuses} onToggle={(v) => setFilters({ ...filters, emailStatuses: toggleIn(filters.emailStatuses, v) })} />
                      </Field>
                    )}
                    <Field label="Result" hint={filters.outcomes?.length ? undefined : "Any"}>
                      <Chips options={OUTCOME_OPTS} value={filters.outcomes} onToggle={(v) => setFilters({ ...filters, outcomes: toggleIn(filters.outcomes, v) })} />
                    </Field>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label={`Minimum confidence · ${filters.minConfidence ?? 0}`}>
                      <input type="range" min={0} max={95} step={5} value={filters.minConfidence ?? 0} onChange={(e) => setFilters({ ...filters, minConfidence: Number(e.target.value) })} className="w-full accent-[#1f1f1f]" />
                    </Field>
                    <Field label="Company, domain or founder contains">
                      <input value={filters.q ?? ""} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="h-8 w-full rounded-lg border border-line-strong px-2.5 text-[13px] outline-none focus:border-ink" />
                    </Field>
                  </div>
                  <div className="rounded-xl border border-line px-3">
                    <Toggle checked={excludeContacted} onChange={setExcludeContacted} label="Skip leads already contacted (or drafted) on this channel" />
                  </div>
                </div>

                {/* audience preview */}
                <div className="rounded-xl border border-line bg-panel/40 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Audience</span>
                    <span className="text-[20px] font-semibold tabular-nums">{count === null ? <PixelLoader /> : count.toLocaleString()}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted">leads will get a personalised draft{count && count > 2000 ? " (first 2,000 per campaign)" : ""}</div>
                  <div className="mt-3 space-y-1.5">
                    {sample.map((l) => (
                      <div key={l.id} className="rounded-lg border border-line bg-white px-2.5 py-2">
                        <div className="truncate text-[12.5px] font-medium">{l.company_name}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[11.5px] text-muted">
                            {target.endsWith("linkedin") ? (target === "founder_linkedin" ? l.founder_name : l.company_linkedin?.replace(/^https?:\/\/(www\.)?/, "")) : target === "company_email" ? l.generic_emails?.[0] : l.founder_email ?? l.generic_emails?.[0]}
                          </span>
                          {target !== "company_email" && l.founder_email && isEmail && <EmailStatus status={l.founder_email_status} />}
                        </div>
                        <div className="mt-1.5">
                          <ChannelStrip outreach={l.outreach} />
                        </div>
                      </div>
                    ))}
                    {count === 0 && <div className="py-6 text-center text-[12px] text-muted">No leads match. Try loosening the filters.</div>}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_400px]">
                <div className="space-y-4">
                  <Field label="Campaign name">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-ink" />
                  </Field>
                  <Field label="What is this outreach for?" hint="The AI writes every message from this">
                    <textarea
                      autoFocus
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      rows={7}
                      placeholder={"e.g. We build AI voice agents that answer and qualify inbound calls for insurance brokers 24/7. Offer a free 2-week pilot. Mention that brokers usually lose after-hours leads."}
                      className="w-full resize-y rounded-lg border border-line-strong px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-ink"
                    />
                  </Field>
                  <Field label="Tone">
                    <div className="flex flex-wrap gap-1.5">
                      {TONES.map((t) => (
                        <button key={t} onClick={() => setTone(t)} className={cx("h-7 rounded-lg border px-2.5 text-[12px]", tone === t ? "border-ink bg-ink text-white" : "border-line-strong text-ink-2 hover:border-ink-2")}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Call to action" hint="Optional">
                    <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. a 15-minute call next week" className="h-9 w-full rounded-lg border border-line-strong px-3 text-[13px] outline-none focus:border-ink" />
                  </Field>
                  {isEmail && (
                    <Field label="Attachments" hint="Sent with every email">
                      <AttachmentPicker value={attachments} onChange={setAttachments} />
                    </Field>
                  )}
                </div>

                <div className="rounded-xl border border-line bg-panel/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Sample draft</span>
                    {preview && (
                      <Button size="sm" variant="ghost" onClick={() => writeSample(previewIdx + 1)} disabled={!!busy || !brief.trim()}>
                        <RefreshCw size={12} /> Another lead
                      </Button>
                    )}
                  </div>
                  {busy === "preview" ? (
                    <div className="flex items-center gap-2 py-10 text-[12.5px]">
                      <PixelLoader /> <span className="shimmer-text font-medium">Writing a sample…</span>
                    </div>
                  ) : preview ? (
                    <div className="space-y-2 rounded-lg border border-line bg-white p-3 text-[12.5px]">
                      <div className="text-[11.5px] text-muted">
                        {preview.lead.company_name} · {preview.recipient.name ?? preview.recipient.address}
                      </div>
                      {preview.draft.subject && <div className="font-semibold">{preview.draft.subject}</div>}
                      {preview.draft.note && (
                        <div className="rounded-md bg-panel px-2 py-1.5 text-[12px]">
                          <span className="text-[10.5px] uppercase tracking-wide text-muted">Connection note</span>
                          <div className="mt-0.5">{preview.draft.note}</div>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap leading-relaxed text-ink-2">{preview.draft.body}</div>
                      {isEmail && <div className="whitespace-pre-wrap border-t border-line pt-2 text-[11.5px] text-muted">{[preview.signature, preview.optOutLine].filter(Boolean).join("\n\n")}</div>}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <div className="text-[12.5px] text-muted">See what one message looks like before generating all of them.</div>
                      <Button className="mt-3" onClick={() => writeSample(0)} disabled={!brief.trim() || !count}>
                        <Sparkles size={13} /> Write a sample
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mx-auto max-w-xl space-y-4 p-8">
                <div className="text-center">
                  <div className="text-[28px] font-semibold tabular-nums tracking-tight">{Math.min(count ?? 0, 2000).toLocaleString()}</div>
                  <div className="text-[13px] text-muted">personalised {isEmail ? "emails" : "LinkedIn messages"} will be written</div>
                </div>
                <div className="divide-y divide-line rounded-xl border border-line text-[12.5px]">
                  <Summary k="Campaign" v={name || defaultName} />
                  <Summary k="Channel" v={TARGET_OPTIONS.find((t) => t.id === target)?.title ?? target} />
                  <Summary k="Upload" v={upload?.filename ?? ""} />
                  <Summary k="Tone" v={tone} />
                  {cta && <Summary k="Call to action" v={cta} />}
                  {isEmail && <Summary k="Attachments" v={attachments.length ? attachments.map((a) => a.name).join(", ") : "None"} />}
                </div>
                <div className="rounded-xl bg-panel px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
                  {isEmail
                    ? "Nothing is sent yet. Once the drafts are written you review them, then press Approve & send. They go out one at a time within your daily limit."
                    : "Nothing is sent automatically. The drafts become LinkedIn tasks: open the profile, paste the note, and mark each step as you go."}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        {error && <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#b4403b]">{error}</span>}
        <div className="ml-auto flex gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={!!busy}>
              <ArrowLeft size={13} /> Back
            </Button>
          )}
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 ? !count : !brief.trim()}>
              Next <ArrowRight size={13} />
            </Button>
          ) : (
            <Button variant="primary" onClick={create} disabled={!!busy}>
              {busy === "create" ? <PixelLoader className="[&>span]:bg-white" /> : <Sparkles size={13} />} Generate drafts
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Chips({ options, value, onToggle }: { options: readonly (readonly [string, string])[]; value?: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => {
        const on = value?.includes(v);
        return (
          <button key={v} onClick={() => onToggle(v)} className={cx("inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[12px]", on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink-2 hover:border-ink-2")}>
            {on && <Check size={11} strokeWidth={3} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 px-4 py-2">
      <span className="w-32 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 flex-1 text-ink">{v}</span>
    </div>
  );
}
