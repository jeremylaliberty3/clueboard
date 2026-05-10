import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import AnonProfile from "@/components/AnonProfile";
import SignedInProfile, { type DBSession } from "@/components/SignedInProfile";
import AuthButton from "@/components/AuthButton";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  let sessions: DBSession[] = [];
  let displayName = "";
  if (user) {
    displayName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email?.split("@")[0] ??
      "Player";

    const { data: rows } = await supabase
      .from("game_sessions")
      .select("date, final_score, final_correct, final_wager")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("date", { ascending: true });
    sessions = (rows ?? []) as DBSession[];
  }

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-white/10">
        <Link href="/" className="font-serif text-xl font-black text-gold-bright">
          Clueboard
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/play" className="text-sm text-white/70 hover:text-white">
            Play today &rarr;
          </Link>
          <AuthButton next="/profile" />
        </div>
      </header>

      {user ? (
        <SignedInProfile sessions={sessions} displayName={displayName} />
      ) : (
        <AnonProfile />
      )}
    </main>
  );
}
