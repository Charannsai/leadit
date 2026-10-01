-- LeadEnrich schema. Run once in Supabase → SQL Editor.
-- All objects are prefixed le_ so they can share a Supabase project with other apps.
-- Every table has RLS on with no policies: only the server (service role key) can read/write.

create extension if not exists pgcrypto;

create table if not exists le_uploads (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  sheets jsonb not null default '[]',
  total_rows int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists le_leads (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references le_uploads(id) on delete cascade,
  sheet text not null,
  row_index int not null,
  raw jsonb not null default '{}',
  company_name text,
  domain_input text,
  location text,

  -- queue: new | queued | processing | done | failed | paused
  status text not null default 'new',
  stage text,
  paused_reason text,
  attempts int not null default 0,
  locked_until timestamptz,
  queued_at timestamptz,

  -- results (flat columns for the table; full detail in profile)
  domain text,
  domain_source text,
  company_linkedin text,
  founder_name text,
  founder_title text,
  founder_linkedin text,
  founder_email text,
  founder_email_status text,
  generic_emails text[] not null default '{}',
  phone text,
  outcome text, -- founder | company | none
  confidence int,
  profile jsonb not null default '{}',
  error text,
  enriched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists le_leads_upload_idx on le_leads (upload_id, sheet, row_index);
create index if not exists le_leads_queue_idx on le_leads (status, queued_at);
create index if not exists le_leads_company_trgm on le_leads using btree (lower(company_name));

create table if not exists le_lead_events (
  id bigserial primary key,
  lead_id uuid references le_leads(id) on delete cascade,
  upload_id uuid references le_uploads(id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info', -- info | success | warn | error
  message text not null
);
create index if not exists le_lead_events_at_idx on le_lead_events (upload_id, at desc);
create index if not exists le_lead_events_lead_idx on le_lead_events (lead_id, at);

create table if not exists le_api_cache (
  key text primary key,
  value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists le_provider_usage (
  provider text not null,
  period text not null, -- YYYY-MM
  used numeric not null default 0,
  exhausted boolean not null default false,
  primary key (provider, period)
);

create table if not exists le_settings (
  id int primary key default 1,
  data jsonb not null default '{}'
);
insert into le_settings (id, data) values (1, '{}') on conflict do nothing;

create table if not exists le_worker_state (
  id int primary key default 1,
  run_id text,
  heartbeat_at timestamptz
);
insert into le_worker_state (id) values (1) on conflict do nothing;

alter table le_uploads enable row level security;
alter table le_leads enable row level security;
alter table le_lead_events enable row level security;
alter table le_api_cache enable row level security;
alter table le_provider_usage enable row level security;
alter table le_settings enable row level security;
alter table le_worker_state enable row level security;

-- Claim up to p_limit leads for processing. Expired leases are reclaimed;
-- leads that already failed 3 attempts are marked failed instead.
create or replace function le_claim_leads(p_limit int, p_lease_seconds int)
returns setof le_leads
language plpgsql
as $$
begin
  update le_leads
     set status = 'failed', error = coalesce(error, 'Gave up after 3 attempts'),
         locked_until = null, updated_at = now()
   where status = 'processing' and locked_until < now() and attempts >= 3;

  return query
  update le_leads l
     set status = 'processing',
         locked_until = now() + make_interval(secs => p_lease_seconds),
         attempts = l.attempts + 1,
         updated_at = now()
   where l.id in (
     select id from le_leads
      where (status = 'queued' and (queued_at is null or queued_at <= now()))
         or (status = 'processing' and locked_until < now())
      order by queued_at nulls first, row_index
      limit p_limit
      for update skip locked
   )
  returning l.*;
end $$;

-- Only one worker loop runs at a time. Returns true if p_run_id holds the lock.
create or replace function le_acquire_worker(p_run_id text, p_ttl_seconds int)
returns boolean
language plpgsql
as $$
declare ok boolean;
begin
  update le_worker_state
     set run_id = p_run_id, heartbeat_at = now()
   where id = 1
     and (run_id is null or run_id = p_run_id
          or heartbeat_at is null
          or heartbeat_at < now() - make_interval(secs => p_ttl_seconds))
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function le_release_worker(p_run_id text)
returns void
language sql
as $$
  update le_worker_state set run_id = null where id = 1 and run_id = p_run_id;
$$;

create or replace function le_add_usage(p_provider text, p_period text, p_amount numeric)
returns numeric
language sql
as $$
  insert into le_provider_usage (provider, period, used) values (p_provider, p_period, p_amount)
  on conflict (provider, period) do update set used = le_provider_usage.used + excluded.used
  returning used;
$$;

create or replace function le_lead_counts(p_upload uuid default null, p_sheet text default null)
returns table (status text, n bigint)
language sql
stable
as $$
  select status, count(*) from le_leads
   where (p_upload is null or upload_id = p_upload)
     and (p_sheet is null or sheet = p_sheet)
   group by status;
$$;

-- Queue leads for enrichment. p_scope: new | failed | paused | all (all = everything not running)
create or replace function le_queue_leads(p_upload uuid, p_sheet text, p_scope text, p_ids uuid[])
returns int
language plpgsql
as $$
declare n int;
begin
  update le_leads
     set status = 'queued', queued_at = now(), attempts = 0, error = null,
         paused_reason = null, stage = null, updated_at = now(),
         -- a re-run of a finished lead starts fresh; failed/paused ones keep finished steps
         profile = case when status = 'done' then '{}'::jsonb else profile end
   where upload_id = p_upload
     and (p_sheet is null or sheet = p_sheet)
     and (p_ids is null or id = any(p_ids))
     and status <> 'processing' and status <> 'queued'
     and (p_scope = 'all' or status = p_scope or p_ids is not null);
  get diagnostics n = row_count;
  return n;
end $$;

-- API keys managed from Settings → API keys. A key here overrides the one in .env.local.
create table if not exists le_api_keys (
  provider text primary key,
  key text not null,
  updated_at timestamptz not null default now()
);
alter table le_api_keys enable row level security;

-- Everything the Overview page shows, in one call.
create or replace function le_overview()
returns json
language sql
stable
as $$
  select json_build_object(
    'status', (select coalesce(json_object_agg(status, n), '{}') from (select status, count(*) n from le_leads group by status) s),
    'outcome', (select coalesce(json_object_agg(coalesce(outcome, 'pending'), n), '{}') from (select outcome, count(*) n from le_leads group by outcome) s),
    'email_status', (select coalesce(json_object_agg(coalesce(founder_email_status, 'unknown'), n), '{}')
                       from (select founder_email_status, count(*) n from le_leads where founder_email is not null group by founder_email_status) s),
    'founders', (select count(*) from le_leads where founder_name is not null),
    'founder_linkedin', (select count(*) from le_leads where founder_linkedin is not null),
    'company_linkedin', (select count(*) from le_leads where company_linkedin is not null),
    'domains', (select count(*) from le_leads where domain is not null),
    'uploads', (select coalesce(json_agg(u), '[]') from (
        select up.id, up.filename, up.total_rows, up.created_at,
               count(l.id) filter (where l.status in ('done', 'failed', 'paused')) as finished,
               count(l.id) filter (where l.status in ('queued', 'processing')) as in_flight,
               count(l.id) filter (where l.founder_email is not null) as emails,
               count(l.id) filter (where l.founder_name is not null) as founders
          from le_uploads up
          left join le_leads l on l.upload_id = up.id
         group by up.id
         order by up.created_at desc
         limit 8) u),
    'daily', (select coalesce(json_agg(d order by d.day), '[]') from (
        select (enriched_at at time zone 'utc')::date as day,
               count(*) as enriched,
               count(*) filter (where founder_email is not null) as emails
          from le_leads
         where enriched_at > now() - interval '14 days'
         group by 1) d)
  );
$$;

-- Per-lead outreach status for each channel, kept in sync by le_set_outreach():
-- { "founder_email": "sent", "company_linkedin": "todo", ... }
alter table le_leads add column if not exists outreach jsonb not null default '{}';

create table if not exists le_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null,            -- email | linkedin
  target text not null,             -- founder_email | company_email | best_email | founder_linkedin | company_linkedin
  brief text not null,
  tone text,
  cta text,
  attachments jsonb not null default '[]', -- [{ name, path, size, type }]
  status text not null default 'generating', -- generating | review | sending | done
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table le_campaigns enable row level security;

create table if not exists le_outreach (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references le_campaigns(id) on delete cascade,
  lead_id uuid not null references le_leads(id) on delete cascade,
  upload_id uuid references le_uploads(id) on delete cascade,
  channel text not null,            -- email | linkedin
  target text not null,             -- founder_email | company_email | founder_linkedin | company_linkedin
  recipient_name text,
  recipient text,                   -- email address or LinkedIn URL
  subject text,
  body text,                        -- email body, or LinkedIn follow-up message / page message
  note text,                        -- LinkedIn connection note
  -- email:    generating | draft | scheduled | sending | sent | delivered | bounced | failed | replied | skipped
  -- linkedin: generating | draft | todo | invited | connected | messaged | followed | replied | skipped
  status text not null default 'generating',
  attempts int not null default 0,
  locked_until timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  provider_id text,                 -- Resend email id
  last_event text,
  synced_at timestamptz,
  error text,
  history jsonb not null default '[]', -- [{ at, status, note }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists le_outreach_campaign_idx on le_outreach (campaign_id, status);
create index if not exists le_outreach_lead_idx on le_outreach (lead_id, created_at desc);
create index if not exists le_outreach_queue_idx on le_outreach (status, scheduled_at);
create index if not exists le_outreach_sent_idx on le_outreach (channel, sent_at);
alter table le_outreach enable row level security;

-- Sets a lead's status for one channel, never moving it backwards
-- (a new draft doesn't hide that the founder was already emailed).
create or replace function le_set_outreach(p_lead uuid, p_target text, p_status text, p_force boolean default false)
returns void
language plpgsql
as $$
declare
  rank_of jsonb := '{"skipped":0,"generating":1,"paused":1,"draft":1,"todo":2,"scheduled":2,"sending":2,"failed":2,
                     "sent":3,"delivered":3,"bounced":3,"invited":3,"followed":3,"connected":4,"messaged":5,"replied":6}';
  v_current text;
begin
  select outreach->>p_target into v_current from le_leads where id = p_lead;
  if p_force or v_current is null
     or coalesce((rank_of->>p_status)::int, 0) >= coalesce((rank_of->>v_current)::int, 0)
     or (p_status = 'bounced')
     -- skipping / redrafting an unsent message can step back, but never below a real send
     or (p_status in ('skipped', 'draft', 'generating', 'paused') and v_current in ('generating', 'paused', 'draft', 'todo', 'scheduled', 'sending', 'failed', 'skipped')) then
    update le_leads set outreach = jsonb_set(outreach, array[p_target], to_jsonb(p_status), true) where id = p_lead;
  end if;
end $$;

-- Claim outreach jobs for the worker: drafts to write, and emails whose send time has come.
create or replace function le_claim_outreach(p_limit int, p_lease_seconds int)
returns setof le_outreach
language plpgsql
as $$
begin
  return query
  update le_outreach o
     set locked_until = now() + make_interval(secs => p_lease_seconds),
         attempts = o.attempts + 1,
         updated_at = now()
   where o.id in (
     select id from le_outreach
      where (locked_until is null or locked_until < now())
        and (status = 'generating' or (status = 'scheduled' and scheduled_at <= now()))
      order by (status = 'scheduled') desc, scheduled_at nulls last, created_at
      limit p_limit
      for update skip locked
   )
  returning o.*;
end $$;

-- Outreach counts per campaign, in one call.
create or replace function le_campaign_counts()
returns table (campaign_id uuid, status text, n bigint)
language sql
stable
as $$
  select campaign_id, status, count(*) from le_outreach where campaign_id is not null group by campaign_id, status;
$$;

-- Private bucket for campaign attachments.
insert into storage.buckets (id, name, public) values ('le-attachments', 'le-attachments', false)
on conflict (id) do nothing;

-- One row per external API call (kind = 'call') and per finished job (kind = 'job').
create table if not exists le_agent_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  agent text not null,          -- enrichment | drafting | sending | delivery
  kind text not null,           -- call | job
  provider text not null,       -- groq, gemini, firecrawl, hunter, apollo, clearbit, website, resend, job
  action text not null,         -- e.g. search, scrape, email-finder, generate, send
  status text not null,         -- ok | error | rate_limited | skipped
  latency_ms int,
  tokens_in int,
  tokens_out int,
  lead_id uuid,
  outreach_id uuid,
  campaign_id uuid,
  label text,                   -- company name being worked on
  message text,
  detail jsonb
);
create index if not exists le_agent_logs_at_idx on le_agent_logs (at desc);
create index if not exists le_agent_logs_agent_idx on le_agent_logs (agent, at desc);
create index if not exists le_agent_logs_status_idx on le_agent_logs (status, at desc) where status <> 'ok';
alter table le_agent_logs enable row level security;

-- Per agent / provider / action totals since a point in time, for the API breakdown.
create or replace function le_agent_breakdown(p_since timestamptz)
returns table (
  agent text, kind text, provider text, action text,
  calls bigint, errors bigint, rate_limited bigint, skipped bigint,
  avg_ms numeric, p95_ms numeric, tokens_in bigint, tokens_out bigint, last_at timestamptz
)
language sql
stable
as $$
  select agent, kind, provider, action,
         count(*),
         count(*) filter (where status = 'error'),
         count(*) filter (where status = 'rate_limited'),
         count(*) filter (where status = 'skipped'),
         round(avg(latency_ms)),
         round((percentile_cont(0.95) within group (order by latency_ms))::numeric),
         coalesce(sum(tokens_in), 0),
         coalesce(sum(tokens_out), 0),
         max(at)
    from le_agent_logs
   where at >= p_since
   group by agent, kind, provider, action
   order by agent, kind, count(*) desc;
$$;
