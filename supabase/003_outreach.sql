-- Run once in Supabase → SQL Editor (after 002_keys_overview.sql).

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
  -- paused = drafting paused for this item (resumes as generating)
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
