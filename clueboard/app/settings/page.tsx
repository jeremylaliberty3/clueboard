import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import SignOutButton from "@/components/SignOutButton";
import UsernameForm from "./UsernameForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=/settings");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const initial = (profile?.username as string | undefined) ?? "";

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-black text-gold-bright tracking-tight">
          Clueboard
        </Link>
        <SignOutButton />
      </header>

      <section className="flex-1 flex flex-col items-center justify-start px-6 max-w-md mx-auto w-full pt-8">
        <h1 className="font-serif font-black text-4xl text-gold-bright mb-2 text-center">
          Settings
        </h1>
        <p className="text-white/60 text-sm mb-8 text-center">
          Signed in as {data.user.email}
        </p>

        <UsernameForm initial={initial} />

        <Link href="/play" className="mt-6 text-sm text-white/60 hover:text-white">
          &larr; Back to today&rsquo;s board
        </Link>
      </section>
    </main>
  );
}
