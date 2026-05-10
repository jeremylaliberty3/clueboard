import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * OAuth callback handler. Supabase's hosted auth redirects users back
 * here after Google sign-in completes; we exchange the `code` for a
 * session and then redirect to wherever they were headed.
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
