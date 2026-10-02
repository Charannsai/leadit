import "server-only";
import { track } from "../agentLog";
import { db } from "../db";
import { getKey } from "../keys";
import type { OutreachSettings } from "../settings";
import type { Attachment } from "./types";

const BUCKET = "le-attachments";

async function key() {
  const k = await getKey("resend");
  if (!k) throw new Error("No Resend API key (Settings → API keys)");
  return k;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Body + signature + opt-out line, as plain text and simple HTML. */
export function composeEmail(body: string, sender: OutreachSettings) {
  const parts = [body.trim(), sender.signature.trim(), sender.optOutLine.trim()].filter(Boolean);
  const text = parts.join("\n\n");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">` +
    parts.map((p, i) => `<p style="margin:0 0 14px${i === parts.length - 1 && sender.optOutLine ? ";color:#888;font-size:12px" : ""}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") +
    `</div>`;
  return { text, html };
}

const attachmentCache = new Map<string, { at: number; content: string }>();

async function loadAttachments(list: Attachment[]) {
  return Promise.all(
    list.map(async (a) => {
      const hit = attachmentCache.get(a.path);
      if (hit && Date.now() - hit.at < 10 * 60_000) return { filename: a.name, content: hit.content };
      const { data, error } = await db().storage.from(BUCKET).download(a.path);
      if (error || !data) throw new Error(`Attachment ${a.name} could not be read: ${error?.message}`);
      const content = Buffer.from(await data.arrayBuffer()).toString("base64");
      attachmentCache.set(a.path, { at: Date.now(), content });
      return { filename: a.name, content };
    }),
  );
}

export const NO_SENDER = "No sender email set. Add one in Settings → Outreach.";

export class SendError extends Error {
  constructor(message: string, public permanent: boolean, public retryAfterSec = 0) {
    super(message);
  }
}

/** Sends one email through Resend. Returns the Resend email id. */
export function sendEmail(opts: { to: string; subject: string; body: string; attachments: Attachment[]; sender: OutreachSettings; idempotencyKey: string }) {
  return track("resend", "send", () => sendRaw(opts), (id) => ({ message: `To ${opts.to}`, detail: { resend_id: id, attachments: opts.attachments.length } }));
}

async function sendRaw(opts: { to: string; subject: string; body: string; attachments: Attachment[]; sender: OutreachSettings; idempotencyKey: string }) {
  if (!opts.sender.fromEmail) throw new SendError(NO_SENDER, false, 600);
  const { text, html } = composeEmail(opts.body, opts.sender);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await key()}`,
      "Content-Type": "application/json",
      // Resend drops a repeat with the same key, so a retried job can't double-send.
      "Idempotency-Key": opts.idempotencyKey,
    },
    body: JSON.stringify({
      from: `${opts.sender.fromName} <${opts.sender.fromEmail}>`,
      to: [opts.to],
      reply_to: opts.sender.replyTo || opts.sender.fromEmail,
      subject: opts.subject,
      text,
      html,
      attachments: opts.attachments.length ? await loadAttachments(opts.attachments) : undefined,
      headers: { "List-Unsubscribe": `<mailto:${opts.sender.replyTo || opts.sender.fromEmail}?subject=unsubscribe>` },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (res.ok && json.id) return json.id;
  if (res.status === 429) throw new SendError("Resend rate limit", false, Number(res.headers.get("retry-after")) || 60);
  // 4xx other than 429 won't succeed on retry (bad address, unverified domain, ...).
  throw new SendError(`Resend ${res.status}: ${json.message ?? json.name ?? "error"}`, res.status >= 400 && res.status < 500);
}

/** Latest delivery event for a sent email (delivered, bounced, complained, ...). */
export function emailEvent(id: string): Promise<string | null> {
  return track("resend", "status", () => emailEventRaw(id), (ev) => ({ message: ev ?? "no event" }));
}

async function emailEventRaw(id: string): Promise<string | null> {
  const res = await fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${await key()}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { last_event?: string };
  return j.last_event ?? null;
}

export async function signedUpload(name: string) {
  const safe = name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, url: data.signedUrl };
}
