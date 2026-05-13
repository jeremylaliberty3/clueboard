"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function ResetForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/play");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3 text-left">
      <label className="text-xs text-white/60 uppercase tracking-wide">New password</label>
      <input
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="At least 8 characters"
      />
      <label className="text-xs text-white/60 uppercase tracking-wide mt-2">Confirm new password</label>
      <input
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="Re-enter password"
      />

      {error && <div className="text-wrong text-sm">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-3 bg-gold-bright text-board font-bold px-6 py-3 rounded hover:brightness-110 disabled:opacity-60"
      >
        {submitting ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
