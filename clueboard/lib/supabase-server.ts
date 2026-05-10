import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-aware Supabase client for use in server components, route
 * handlers, and server actions. Reads/writes the session cookie so
 * `supabase.auth.getUser()` returns the current user.
 *
 * For non-auth read-only queries (loading the public clue pool), keep
 * using the simpler client in lib/supabase.ts — that one doesn't need
 * cookies and avoids per-request setup.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options as CookieOptions);
            }
          } catch {
            // Called from a Server Component — cookies can't be set there;
            // the proxy refreshes the session for those paths.
          }
        },
      },
    },
  );
}
