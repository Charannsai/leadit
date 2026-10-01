-- Run once in Supabase → SQL Editor (after 003_outreach.sql).

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
