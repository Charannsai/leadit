import "server-only";
import { db } from "./db";

const DAY = 86_400_000;

/** Caches paid API responses by key so re-runs and duplicate companies don't spend credits twice. */
export async function cached<T>(key: string, ttlDays: number, fn: () => Promise<T>): Promise<T> {
  const { data } = await db().from("le_api_cache").select("value, created_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.created_at).getTime() < ttlDays * DAY) return data.value as T;
  const value = await fn();
  await db().from("le_api_cache").upsert({ key, value: value as never, created_at: new Date().toISOString() });
  return value;
}
