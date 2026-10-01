import "server-only";

/** Starts a worker run in a separate function invocation (returns as soon as it's accepted). */
export async function kickWorker(origin: string) {
  try {
    await fetch(`${origin}/api/worker`, {
      method: "POST",
      headers: { "x-worker-secret": process.env.WORKER_SECRET ?? "" },
      // Generous: in dev the worker route may need compiling first. A lost kick is also
      // recovered by ensureWorker() on the next dashboard poll.
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (e) {
    console.warn("kickWorker failed", (e as Error).message);
  }
}
