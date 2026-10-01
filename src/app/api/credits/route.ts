import { usageSummary } from "@/lib/budget";
import { getKey } from "@/lib/keys";
import { ensureWorker } from "@/lib/watchdog";

export const dynamic = "force-dynamic";

let cache: { at: number; value: unknown } | null = null;

/**
 * Credit usage tracked by the app this month, plus live remaining credits straight from
 * Hunter and Firecrawl (both account endpoints are free). ?live=0 skips the provider calls.
 */
export async function GET(req: Request) {
  // The sidebar polls this on every page, which makes it the app-wide "is the worker alive?" check.
  await ensureWorker(new URL(req.url).origin);
  const usage = await usageSummary();
  if (new URL(req.url).searchParams.get("live") === "0") return Response.json({ usage });
  if (cache && Date.now() - cache.at < 60_000) return Response.json({ usage, ...(cache.value as object) });

  const [hunterKey, firecrawlKey] = await Promise.all([getKey("hunter"), getKey("firecrawl")]);
  const [hunter, firecrawl] = await Promise.all([
    hunterKey
      ? fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(hunterKey)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
          .then((r) => r.json())
          .then((j) => ({
            plan: j.data?.plan_name ?? null,
            searches: j.data?.requests?.searches ?? null,
            verifications: j.data?.requests?.verifications ?? null,
            reset: j.data?.reset_date ?? null,
          }))
          .catch(() => null)
      : null,
    firecrawlKey
      ? fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${firecrawlKey}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) })
          .then((r) => r.json())
          .then((j) => ({ remaining: j.data?.remaining_credits ?? null, plan: j.data?.plan_credits ?? null, reset: j.data?.billing_period_end ?? null }))
          .catch(() => null)
      : null,
  ]);

  const value = { hunter, firecrawl };
  cache = { at: Date.now(), value };
  return Response.json({ usage, ...value });
}
