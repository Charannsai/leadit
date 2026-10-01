export type LeadStatus = "new" | "queued" | "processing" | "done" | "failed" | "paused";

export type EmailStatus = "valid" | "accept_all" | "invalid" | "unknown" | "unverified";

export interface Founder {
  name: string;
  title?: string;
  linkedin?: string;
  twitter?: string;
  location?: string;
  summary?: string;
  email?: string;
  email_status?: EmailStatus;
  email_source?: string;
  confidence?: number;
  source?: string;
}

export interface ContactEmail {
  email: string;
  source: string;
  status?: EmailStatus;
  label?: string;
}

export interface CompanyProfile {
  name?: string;
  website?: string;
  description?: string;
  industry?: string;
  employees?: number | string;
  founded?: number | string;
  location?: string;
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  phone?: string;
  logo?: string;
  funding?: string;
  keywords?: string[];
  contact_page?: string;
}

export interface Profile {
  done?: Record<string, boolean>;
  domain_candidates?: { domain: string; name?: string; source: string }[];
  company?: CompanyProfile;
  website?: {
    pages?: string[];
    emails?: string[];
    phones?: string[];
    people?: { name: string; title?: string; linkedin?: string }[];
    text?: string;
    fetched_with?: string;
  };
  founders?: Founder[];
  generic_emails?: ContactEmail[];
  email_pattern?: string;
  sources?: Record<string, string>;
  blocked?: string[];
  notes?: string[];
}

export interface Lead {
  id: string;
  upload_id: string;
  sheet: string;
  row_index: number;
  raw: Record<string, unknown>;
  company_name: string | null;
  domain_input: string | null;
  location: string | null;
  status: LeadStatus;
  stage: string | null;
  paused_reason: string | null;
  attempts: number;
  domain: string | null;
  domain_source: string | null;
  company_linkedin: string | null;
  founder_name: string | null;
  founder_title: string | null;
  founder_linkedin: string | null;
  founder_email: string | null;
  founder_email_status: string | null;
  generic_emails: string[];
  phone: string | null;
  outcome: string | null;
  confidence: number | null;
  profile: Profile;
  error: string | null;
  enriched_at: string | null;
  updated_at: string;
  /** Outreach status per channel, e.g. { founder_email: "sent" }. */
  outreach?: Record<string, string>;
}

export interface SheetMeta {
  name: string;
  rows: number;
  columns: string[];
  mapping: ColumnMapping;
}

export interface ColumnMapping {
  company?: string;
  website?: string;
  location?: string;
}

export interface Upload {
  id: string;
  filename: string;
  sheets: SheetMeta[];
  total_rows: number;
  created_at: string;
}

export interface LeadEvent {
  id: number;
  lead_id: string | null;
  at: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
}
