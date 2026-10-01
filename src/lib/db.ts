import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) {
    if (/schema cache|does not exist/i.test(res.error.message) && /le_/.test(res.error.message))
      throw new Error("Database isn't set up yet: run supabase/schema.sql in the Supabase SQL Editor.");
    throw new Error(res.error.message);
  }
  return res.data;
}
