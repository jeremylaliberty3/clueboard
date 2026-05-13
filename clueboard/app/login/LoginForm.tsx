"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }
    router.push(next);
    router.refresh();
  };

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
      <label className="text-xs text-white/60 uppercase tracking-wide mt-2">Password</label>
      <input
        type="password"
        autoComplete="current-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="At least 8 characters"
      />

      {error && <div className="text-wrong text-sm">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-3 bg-gold-bright text-board font-bold px-6 py-3 rounded hover:brightness-110 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div className="mt-4 flex flex-col items-center gap-3">
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="inline-block px-6 py-2.5 border-2 border-gold-bright text-gold-bright font-bold rounded hover:bg-gold-bright/10"
        >
          Create account
        </Link>
        <Link href="/forgot-password" className="text-sm text-white/70 hover:text-white underline">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
