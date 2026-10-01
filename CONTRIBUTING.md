# Contributing to Leadit

Thanks for helping! Bug reports, docs fixes, new providers and UI polish are all welcome.

## Getting set up

1. Fork and clone the repo, then `npm install`.
2. Create a free Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
3. `cp .env.example .env.local` and fill in at least `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and one LLM key (`GROQ_API_KEY` or `GEMINI_API_KEY`).
4. `npm run dev` and open http://localhost:3000. Import [`samples/sample-leads.xlsx`](samples/sample-leads.xlsx) to have something to work with.

> Use test data and your own API keys. Never commit `.env.local`, real lead lists, or screenshots with real names or emails.

## Before you open a PR

```bash
npm run lint
npx tsc --noEmit
npm run build
```

CI runs the same three checks.

- **Keep PRs focused.** One fix or feature per PR is much easier to review.
- **Database changes** go in a new numbered file in `supabase/` (e.g. `005_your_change.sql`) *and* are appended to `schema.sql`, so fresh installs and upgrades both work. Prefix new objects with `le_`.
- **New external APIs** go in `src/lib/providers/`. Wrap every network call in `track()` from `src/lib/agentLog.ts` so it shows up in the Agents tab, and respect budgets via `ensureBudget()` / `recordUsage()` when the API has credits.
- **UI** follows the existing style: Tailwind, the tokens in `globals.css`, `motion` for animation, and the components in `src/components/ui.tsx`.
- **Explain the why** in the PR description, and add a screenshot or GIF for UI changes (with any real data blurred).

## Ideas for first contributions

- Additional enrichment providers (Snov, Dropcontact, Prospeo…)
- More LLM providers for the agents (OpenAI, Anthropic, Ollama)
- CRM exports (HubSpot, Pipedrive)
- Tests for `src/lib/columns.ts`, `src/lib/domain.ts` and the scheduling logic in `src/lib/outreach/engine.ts`
- Docs: self-hosting guides, provider setup walkthroughs

Look for issues labelled [`good first issue`](https://github.com/Charannsai/leadit/labels/good%20first%20issue) or [`help wanted`](https://github.com/Charannsai/leadit/labels/help%20wanted).

## Reporting bugs

Use the [bug report template](https://github.com/Charannsai/leadit/issues/new?template=bug_report.yml). Include steps to reproduce, what you expected, and any errors from the browser console or the **Settings → Agents → Logs** tab, with keys and personal data removed.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE) and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
