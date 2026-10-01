-- Run once in Supabase → SQL Editor (after schema.sql).

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
