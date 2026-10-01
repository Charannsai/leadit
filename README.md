# LeadEnrich

Upload a CSV/Excel list of companies → review every row → press **Enrich**. A background worker finds each company's website (if missing), founder (name, title, LinkedIn), founder email (verified), company LinkedIn, and general contact emails. Results stream into the table as they finish.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the keys.
3. In Supabase → **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql) once. All tables are prefixed `le_`, so it's safe in a project shared with other apps.
4. `npm run dev` → http://localhost:3000

## How a lead is enriched

Each step is saved as it finishes, so a paused or retried lead never pays twice for the same step. Paid responses are also cached by domain.

| Step | Free source first | Paid fallback |
|---|---|---|
| Website domain | Sheet column, any URL/company email in the row, Clearbit autocomplete | Firecrawl search + Groq picks the right result |
| Company profile | — | Apollo organization enrich (the only Apollo endpoint on the free plan) |
| Website crawl | Plain fetch of home + about/team/contact pages | Firecrawl scrape for JavaScript-only sites |
| Founder | Website team page (Groq reads it) | Firecrawl search of LinkedIn profiles + Groq verifies the match |
| Company LinkedIn | Apollo / website links | Firecrawl search |
| Founder email | Emails on the website or in the LinkedIn snippet | Hunter email finder → pattern guess + Hunter verify |
| Company contacts | Emails on the website | Hunter domain search (also finds executives when no founder was found) |

LinkedIn itself is never scraped. Profile URLs and titles come from search results.

## Credits

Monthly limits per service are set in **Credits & settings** (sidebar). When a limit is hit, leads that still need that service are **paused** with the reason shown. Press **Resume paused** once credits reset or you raise the limit. Rate limits (HTTP 429) send the lead back to the queue automatically.

## Background processing

`/api/worker` returns at once and processes the queue in the background with Next's `after()`. Each run handles leads for about 3 minutes, then starts the next run while work remains. Only one run is active at a time (a lock in `le_worker_state`). The dashboard's polling restarts the worker if it ever stops with work still queued.

## Deploying to Vercel

Add all variables from `.env.example` in the Vercel project settings. **Set `APP_PASSWORD`**, because without it anyone with the URL can see your leads. The worker route uses `maxDuration = 300`, which needs Fluid Compute (on by default for new projects).
