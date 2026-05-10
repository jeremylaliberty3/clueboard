import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import SignOutButton from "./SignOutButton";

/**
 * Tiny header widget: "Sign in" link when anonymous, display name +
 * sign-out trigger when signed in. Server component — re-renders on
 * navigation so the auth state stays fresh.
 */
export default async function AuthButton({ next = "/play" }: { next?: string }) {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="text-sm text-white/70 hover:text-white border border-white/20 px-3 py-1.5 rounded"
      >
        Sign in
      </Link>
    );
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Player";

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-white/70 hidden sm:inline">{displayName}</span>
      <SignOutButton />
    </div>
  );
}
