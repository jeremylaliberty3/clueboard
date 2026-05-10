"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SignOutButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const signOut = async () => {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  return (
    <button
      onClick={signOut}
      disabled={loading}
      className="text-white/70 hover:text-white border border-white/20 px-3 py-1.5 rounded disabled:opacity-50"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
