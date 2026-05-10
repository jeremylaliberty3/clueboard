import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import LoginButton from "./LoginButton";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/play";

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(next);

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-black text-gold-bright tracking-tight">
          Clueboard
        </Link>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto">
        <h1 className="font-serif font-black text-4xl text-gold-bright mb-4">
          Sign in
        </h1>
        <p className="text-white/80 mb-8">
          Save your scores, build a streak, and track your stats across devices. You can also keep playing without an account.
        </p>

        <LoginButton next={next} />

        <Link href="/play" className="mt-6 text-sm text-white/60 hover:text-white">
          Skip and play anonymously &rarr;
        </Link>

        <p className="text-xs text-white/40 mt-10 max-w-xs">
          Until our OAuth app is verified, Google may show a &ldquo;hasn&rsquo;t verified this app&rdquo; warning. Click <em>Continue</em> to proceed.
        </p>
      </section>
    </main>
  );
}
