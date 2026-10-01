import "server-only";
import { RateLimitError } from "../budget";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class HttpError extends Error {
  constructor(public status: number, public body: unknown, provider: string) {
    super(`${provider} HTTP ${status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  }
}

/** JSON fetch with a timeout. 429s become RateLimitError so the worker can back off. */
export async function fetchJson<T>(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after")) || 60;
    throw Object.assign(new RateLimitError(provider, retry), { body });
  }
  if (!res.ok) throw new HttpError(res.status, body, provider);
  return body as T;
}
