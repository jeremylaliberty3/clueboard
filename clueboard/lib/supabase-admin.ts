import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS — only used by the dev-only
 * /admin board builder so we can overwrite future daily_boards rows.
 * Throws (not returns null) in production so any accidental import is
 * caught immediately.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (process.env.NODE_ENV === "production") {
    throw new Error("getSupabaseAdmin must never be called in production.");
  }
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  }
  _client = createClient(url, key.trim(), { auth: { persistSession: false } });
  return _client;
}
