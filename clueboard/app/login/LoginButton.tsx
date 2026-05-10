"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginButton({ next }: { next: string }) {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      console.error(error);
      setLoading(false);
    }
    // On success, the browser is redirected to Google; no further work here.
  };

  return (
    <button
      onClick={signIn}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 bg-white text-board font-bold px-6 py-3 rounded-lg hover:brightness-95 disabled:opacity-60 transition shadow"
    >
      <GoogleG />
      {loading ? "Redirecting…" : "Sign in with Google"}
    </button>
  );
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.55 5.55 0 0 1-2.4 3.64v3.03h3.88c2.27-2.09 3.54-5.17 3.54-8.91Z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.12A12 12 0 0 0 12 24Z"/>
      <path fill="#FBBC05" d="M5.27 14.26a7.21 7.21 0 0 1 0-4.52V6.62H1.27a12 12 0 0 0 0 10.76l4-3.12Z"/>
      <path fill="#EA4335" d="M12 4.78c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.12C6.22 6.89 8.87 4.78 12 4.78Z"/>
    </svg>
  );
}
