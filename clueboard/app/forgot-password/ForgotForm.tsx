"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = getSupabaseBrowserClient();
    // The link in the email lands on /auth/callback with type=recovery,
    // which exchanges the code for a session and then redirects to
    // /reset-password where the user picks a new password.
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="text-white/85 text-center">
        <p className="mb-3">
          If an account exists for <span className="text-gold-bright">{email}</span>, a password reset link is on its way.
        </p>
        <p className="text-sm text-white/60">
          Check your inbox (and spam folder) for a message from Clueboard.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3 text-left">
      <label className="text-xs text-white/60 uppercase tracking-wide">Email</label>
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="you@example.com"
      />

      {error && <div className="text-wrong text-sm">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-3 bg-gold-bright text-board font-bold px-6 py-3 rounded hover:brightness-110 disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}
