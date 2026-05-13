import { getDailyBoard } from "@/lib/board";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import PlayClient from "@/components/PlayClient";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const [board, supabase] = await Promise.all([
    getDailyBoard(),
    getSupabaseServerClient(),
  ]);
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("user_id", user.id)
      .maybeSingle();
    displayName = (profile?.username as string | undefined) ??
      user.email?.split("@")[0] ??
      "Player";
  }

  return <PlayClient board={board} displayName={displayName} />;
}
