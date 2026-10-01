// Shared by server and browser.

export type Channel = "email" | "linkedin";
/** Where a message goes. best_email is only a campaign choice: founder email, else company email. */
export type Target = "founder_email" | "company_email" | "founder_linkedin" | "company_linkedin";
export type CampaignTarget = Target | "best_email";

export const TARGETS: { id: Target; channel: Channel; label: string; short: string }[] = [
  { id: "founder_email", channel: "email", label: "Founder email", short: "Founder ✉" },
  { id: "company_email", channel: "email", label: "Company email", short: "Company ✉" },
  { id: "founder_linkedin", channel: "linkedin", label: "Founder LinkedIn", short: "Founder in" },
  { id: "company_linkedin", channel: "linkedin", label: "Company LinkedIn page", short: "Company in" },
];

export const channelOf = (t: CampaignTarget): Channel => (t.endsWith("linkedin") ? "linkedin" : "email");

export type OutreachStatus =
  | "generating" | "paused" | "draft" | "scheduled" | "sending" | "sent" | "delivered" | "bounced" | "failed"
  | "todo" | "invited" | "connected" | "messaged" | "followed" | "replied" | "skipped";

export interface OutreachItem {
  id: string;
  campaign_id: string | null;
  lead_id: string;
  upload_id: string | null;
  channel: Channel;
  target: Target;
  recipient_name: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  note: string | null;
  status: OutreachStatus;
  attempts: number;
  scheduled_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
  provider_id: string | null;
  last_event: string | null;
  error: string | null;
  history: { at: string; status: string; note?: string }[];
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  target: CampaignTarget;
  brief: string;
  tone: string | null;
  cta: string | null;
  attachments: Attachment[];
  status: "generating" | "paused" | "review" | "sending" | "done";
  created_at: string;
  updated_at: string;
  counts?: Record<string, number>;
}

/** Label and pill tone for each status. */
export const STATUS_META: Record<string, { label: string; tone: "neutral" | "dark" | "green" | "amber" | "red" | "blue" | "violet" }> = {
  generating: { label: "Writing", tone: "neutral" },
  paused: { label: "Drafting paused", tone: "amber" },
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  sending: { label: "Sending", tone: "blue" },
  sent: { label: "Sent", tone: "dark" },
  delivered: { label: "Delivered", tone: "green" },
  bounced: { label: "Bounced", tone: "red" },
  failed: { label: "Failed", tone: "red" },
  todo: { label: "To do", tone: "amber" },
  invited: { label: "Invite sent", tone: "dark" },
  connected: { label: "Connected", tone: "blue" },
  messaged: { label: "Messaged", tone: "violet" },
  followed: { label: "Followed", tone: "dark" },
  replied: { label: "Replied", tone: "green" },
  skipped: { label: "Skipped", tone: "neutral" },
};

/** Statuses that count as "reached out" on a channel. */
export const CONTACTED = ["sent", "delivered", "bounced", "invited", "connected", "messaged", "followed", "replied"];

export const TONES = ["Friendly", "Direct", "Formal", "Casual", "Consultative"];
