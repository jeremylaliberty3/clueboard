import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Auth callback handler. Used for password-reset links (Supabase emails
 * a tokenized URL that lands here); exchanges the `code` for a session
 * and redirects to wherever the email link asked for via `?next=`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/play";
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(errorDescription)}`, origin),
    );
  }

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Same-origin redirect to the post-login landing page.
      const safeNext = next.startsWith("/") ? next : "/play";
      return NextResponse.redirect(new URL(safeNext, origin));
    }
    return NextResponse.redirect(
      new URL(`/login?err=${encodeURIComponent(error.message)}`, origin),
    );
  }

  return NextResponse.redirect(new URL("/login", origin));
}
