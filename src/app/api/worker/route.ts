import { after } from "next/server";
import { kickWorker } from "@/lib/kick";
import { runWorker } from "@/lib/worker";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Accepts the request immediately and processes the queue in the background.
// When the run ends with work left, it starts the next run, so the queue keeps draining.
export async function POST(req: Request) {
  return start(req);
}

// Vercel Cron calls GET (see vercel.json), so emails pushed to the next day still go out
// when nobody has the app open.
export async function GET(req: Request) {
  return start(req);
}

function start(req: Request) {
  const origin = new URL(req.url).origin;
  after(async () => {
    try {
      const r = await runWorker();
      if (!r.more) return;
      // A run that found nothing claimable (everything waiting on a rate limit or a send time)
      // pauses before handing over, so runs never restart in a tight loop.
      if (r.processed === 0) await new Promise((res) => setTimeout(res, 15_000));
      await kickWorker(origin);
    } catch (e) {
      console.error("worker run failed", e);
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}
