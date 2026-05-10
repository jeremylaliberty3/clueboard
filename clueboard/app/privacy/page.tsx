import Link from "next/link";
import AuthButton from "@/components/AuthButton";

export const metadata = {
  title: "Privacy Policy — Clueboard",
};

const LAST_UPDATED = "May 10, 2026";

export default function PrivacyPage() {
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
          <AuthButton next="/play" />
        </div>
      </header>

      <article className="flex-1 px-4 sm:px-6 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-serif text-4xl font-black text-gold-bright mb-2">
          Privacy Policy
        </h1>
        <p className="text-white/50 text-sm mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-6 text-white/85 leading-relaxed">
          <p>
            Clueboard (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a daily trivia game at clueboard.app. This policy explains what we collect, why, and what your choices are. The short version: we collect the minimum needed to make the game work; we don&rsquo;t sell or share data; and you can delete your account anytime by emailing us.
          </p>

          <Section title="What we collect">
            <p>
              <strong className="text-white">Anonymous play (no account):</strong>{" "}
              Your in-progress game state and play history are stored in your browser&rsquo;s localStorage only. We don&rsquo;t see them; they never leave your device. We do collect basic server logs (IP address, request timestamp, browser user-agent) for security and troubleshooting; these logs are retained for up to 30 days.
            </p>
            <p>
              <strong className="text-white">Signed-in play (Google account):</strong>{" "}
              When you sign in with Google, we store your account&rsquo;s display name, email address, and a stable user ID issued by our authentication provider. We also store your game results — date, score, answer correctness — so we can show you stats and streaks across devices. We do <em>not</em> request, see, or store your Google password.
            </p>
          </Section>

          <Section title="How we use it">
            <ul className="list-disc pl-6 space-y-1">
              <li>To run the game (load the daily board, score answers, save your progress).</li>
              <li>To show your personal stats and history on the Profile page.</li>
              <li>To improve the game (anonymous, aggregate metrics like &ldquo;average score per day&rdquo;).</li>
              <li>To respond if you contact us.</li>
            </ul>
            <p>
              We do <strong>not</strong> sell or rent your information, use it for advertising, or share it with marketing partners.
            </p>
          </Section>

          <Section title="Service providers we use">
            <p>
              We rely on a few third-party services to operate Clueboard. They process limited data on our behalf:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong className="text-white">Supabase</strong> &mdash; hosts our database (your account row and game results) and handles authentication. <a className="underline" target="_blank" rel="noreferrer" href="https://supabase.com/privacy">supabase.com/privacy</a></li>
              <li><strong className="text-white">Vercel</strong> &mdash; hosts the website and serves the app. <a className="underline" target="_blank" rel="noreferrer" href="https://vercel.com/legal/privacy-policy">vercel.com/legal/privacy-policy</a></li>
              <li><strong className="text-white">Cloudflare</strong> &mdash; provides our domain DNS. <a className="underline" target="_blank" rel="noreferrer" href="https://www.cloudflare.com/privacypolicy/">cloudflare.com/privacypolicy</a></li>
              <li><strong className="text-white">Google</strong> &mdash; provides the Sign-in with Google flow. <a className="underline" target="_blank" rel="noreferrer" href="https://policies.google.com/privacy">policies.google.com/privacy</a></li>
              <li><strong className="text-white">Anthropic</strong> &mdash; we use Anthropic&rsquo;s Claude AI to generate trivia clues from publicly-licensed datasets. Anthropic does not receive any of your personal data. <a className="underline" target="_blank" rel="noreferrer" href="https://www.anthropic.com/legal/privacy">anthropic.com/legal/privacy</a></li>
            </ul>
          </Section>

          <Section title="Cookies">
            <p>
              We set one functional cookie when you sign in: a Supabase session cookie that keeps you logged in. We do not use advertising or analytics cookies. If you prefer, you can play anonymously without setting any cookies.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              Account and game-history data is retained as long as your account exists. You can request deletion at any time (see below); we&rsquo;ll permanently remove your account and game history within 30 days.
            </p>
          </Section>

          <Section title="Your choices">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong className="text-white">Delete your account.</strong> Email us at the address below and we&rsquo;ll remove your account and all associated game data.</li>
              <li><strong className="text-white">Sign out.</strong> Click &ldquo;Sign out&rdquo; in the header. This clears the session cookie. Your account data stays in our database until you delete it.</li>
              <li><strong className="text-white">Play anonymously.</strong> You can use Clueboard without signing in. In that case nothing is sent to our servers other than the basic logs above.</li>
            </ul>
          </Section>

          <Section title="Children">
            <p>
              Clueboard is intended for users 13 and older. We don&rsquo;t knowingly collect data from children under 13.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We may update this policy as the project evolves. The &ldquo;Last updated&rdquo; date at the top will reflect any change. Material changes will also be flagged in the app.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For privacy questions or to request account deletion, email{" "}
              <a className="underline" href="mailto:jeremy.laliberty3@gmail.com">jeremy.laliberty3@gmail.com</a>.
            </p>
          </Section>

          <p className="text-xs text-white/40 italic mt-12">
            This policy is written in plain language for clarity; it is not legal advice. If you operate Clueboard commercially or expand its data practices, you should have a lawyer review.
          </p>
        </div>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl font-black text-gold-bright mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
