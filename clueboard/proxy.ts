import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 Proxy (formerly Middleware): refreshes the Supabase auth
 * session cookie on every navigation. Without this, server components
 * that call `supabase.auth.getUser()` will see stale or missing
 * sessions when the access token expires.
 */
export async function proxy(request: NextRequest) {
  // Recover from a Supabase redirect-allow-list misconfig: if an OAuth
  // `code` lands anywhere other than /auth/callback, rewrite the request
  // there so the handler can exchange it. Without this, a misconfigured
  // Site URL silently lands the user on `/` with the code stranded in
  // the query string and no session cookies set.
  const pathname = request.nextUrl.pathname;
  const code = request.nextUrl.searchParams.get("code");
  if (code && pathname !== "/auth/callback" && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    url.searchParams.set("code", code);
    if (!url.searchParams.has("next")) url.searchParams.set("next", "/play");
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching getUser() refreshes the session if needed.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Skip static assets, image optimizer, favicon — only auth-relevant paths.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
