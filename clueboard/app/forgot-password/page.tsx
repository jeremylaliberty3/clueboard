import Link from "next/link";
import ForgotForm from "./ForgotForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl font-black text-gold-bright tracking-tight">
          Clueboard
        </Link>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-md mx-auto w-full">
        <h1 className="font-serif font-black text-4xl text-gold-bright mb-4">
          Forgot password
        </h1>
        <p className="text-white/80 mb-8">
          Enter the email on your account and we&rsquo;ll send you a link to set a new password.
        </p>

        <ForgotForm />

        <Link href="/login" className="mt-6 text-sm text-white/60 hover:text-white">
          &larr; Back to sign in
        </Link>
      </section>
    </main>
  );
}
