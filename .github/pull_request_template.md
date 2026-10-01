## What and why

<!-- What does this change, and what problem does it solve? Link the issue: Closes #123 -->

## How I tested it

<!-- Steps, and screenshots/GIFs for UI changes (blur any real data). -->

## Checklist

- [ ] `npm run lint`, `npx tsc --noEmit` and `npm run build` pass
- [ ] Database changes are in a new `supabase/00X_*.sql` file **and** appended to `schema.sql`
- [ ] New external API calls are wrapped in `track()` (and use budgets if the API has credits)
- [ ] No keys, `.env.local` or real lead data committed
