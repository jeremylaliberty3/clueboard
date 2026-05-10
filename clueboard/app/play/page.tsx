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
  const displayName = user
    ? ((user.user_metadata?.full_name as string | undefined) ??
       (user.user_metadata?.name as string | undefined) ??
       user.email?.split("@")[0] ??
       "Player")
    : null;

  return <PlayClient board={board} displayName={displayName} />;
}
