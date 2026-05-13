import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import ResetForm from "./ResetForm";

export const dynamic = "force-dynamic";

// User lands here after clicking the reset link in their email. The
// /auth/callback handler already exchanged the token for a session, so
// we expect to find a signed-in user here. If not, the link expired or
// was tampered with — punt them back to /forgot-password.
export default async function ResetPasswordPage() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/forgot-password");

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-black text-gold-bright tracking-tight">
          Clueboard
        </Link>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto w-full">
        <h1 className="font-serif font-black text-4xl text-gold-bright mb-4">
          Set a new password
        </h1>
        <p className="text-white/80 mb-8">
          Choose a new password for <span className="text-gold-bright">{data.user.email}</span>.
        </p>

        <ResetForm />
      </section>
    </main>
  );
}
