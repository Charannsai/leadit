# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.
Report them privately through [GitHub security advisories](https://github.com/Charannsai/leadit/security/advisories/new). We'll acknowledge within a few days and keep you updated until it's fixed.

Include what you found, how to reproduce it, and the impact you expect.

## Keeping your own install safe

Leadit handles API keys and personal contact data, so a few defaults matter:

- **Set `APP_PASSWORD`** on any deployment reachable from the internet. Without it the dashboard, including Settings → API keys, is open to anyone with the URL.
- **The Supabase service role key must stay server-side.** It's only read in API routes; never expose it with a `NEXT_PUBLIC_` prefix.
- All tables have Row Level Security on with no policies, so the public `anon` key can't read them. Don't add permissive policies.
- Keep `.env.local` out of git (it's in `.gitignore`). If a key is ever committed or shared, rotate it at the provider and update it in Settings → API keys.
- Set a long random `WORKER_SECRET` and `CRON_SECRET`.

## Supported versions

Security fixes go to the latest release on `main`.
