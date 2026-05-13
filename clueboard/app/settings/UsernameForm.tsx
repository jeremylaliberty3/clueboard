"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertProfileAction } from "@/lib/actions";
import { validateUsername } from "@/lib/username";

export default function UsernameForm({ initial }: { initial: string }) {
  const [username, setUsername] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const formatError = validateUsername(username);
    if (formatError) {
      setError(formatError);
      return;
    }
    setStatus("saving");
    const result = await upsertProfileAction(username);
    if (!result.ok) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
    router.refresh();
    setTimeout(() => setStatus("idle"), 1500);
  };

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3 text-left">
      <label className="text-xs text-white/60 uppercase tracking-wide">Username</label>
      <input
        type="text"
        required
        minLength={3}
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
      />
      <p className="text-xs text-white/40 -mt-2">
        3–20 characters · letters, digits, underscores · must start with a letter
      </p>

      {error && <div className="text-wrong text-sm">{error}</div>}

      <button
        type="submit"
        disabled={status === "saving" || username === initial}
        className="mt-3 bg-gold-bright text-board font-bold px-6 py-3 rounded hover:brightness-110 disabled:opacity-60"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved!" : "Save"}
      </button>
    </form>
  );
}
