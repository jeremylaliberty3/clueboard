"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { checkUsernameAction } from "@/lib/actions";
import { validateUsername } from "@/lib/username";

export default function SignupForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const usernameError = validateUsername(username);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);

    // Pre-flight check so we don't sign someone up only to fail on the
    // profile insert. Race conditions are still possible; the final
    // upsert is the source of truth.
    const avail = await checkUsernameAction(username);
    if (!avail.ok) {
      setError(avail.error);
      setSubmitting(false);
      return;
    }
    if (!avail.available) {
      setError("That username is taken.");
      setSubmitting(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email, password,
    });
    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }
    const newUserId = signUpData.user?.id;
    if (!newUserId) {
      setError("Signup succeeded but no user id returned. Try signing in.");
      setSubmitting(false);
      return;
    }
    // If "Confirm email" is enabled in Supabase, signUp returns a user
    // but no session — we can't insert the profile yet (RLS needs
    // auth.uid()). Tell the user to confirm and come back, instead of
    // bouncing them to /settings.
    if (!signUpData.session) {
      setError(
        "Account created. Check your email to confirm your address, then sign in to finish setting up your username.",
      );
      setSubmitting(false);
      return;
    }

    // Insert the profile from the browser client — it already has the
    // session, whereas a server action would see no cookies until the
    // next request.
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({ user_id: newUserId, username: username.trim() });
    if (profileError) {
      const msg =
        profileError.code === "23505"
          ? "That username was just taken — pick another on the settings page."
          : profileError.message;
      setError(msg);
      setSubmitting(false);
      router.push("/settings");
      router.refresh();
      return;
    }

    router.push(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3 text-left">
      <label className="text-xs text-white/60 uppercase tracking-wide">Username</label>
      <input
        type="text"
        autoComplete="username"
        required
        minLength={3}
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="trivia_titan"
      />
      <p className="text-xs text-white/40 -mt-2">
        3–20 characters · letters, digits, underscores · must start with a letter
      </p>

      <label className="text-xs text-white/60 uppercase tracking-wide mt-2">Email</label>
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
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
        placeholder="At least 8 characters"
      />
      <label className="text-xs text-white/60 uppercase tracking-wide mt-2">Confirm password</label>
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
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <div className="text-sm mt-2 text-center">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-white/70 hover:text-white underline">
          Already have an account? Sign in
        </Link>
      </div>
    </form>
  );
}
