import Link from "next/link";
import AuthButton from "@/components/AuthButton";

export const dynamic = "force-dynamic";

export default function AboutPage() {
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
      <article className="flex-1 px-4 sm:px-6 py-10 max-w-2xl mx-auto w-full prose prose-invert">
        <h1 className="font-serif text-4xl font-black text-gold-bright mb-4">
          About Clueboard
        </h1>
        <p className="text-white/85 mb-4">
          Clueboard is a daily trivia puzzle. Every day, all players see the same board of six categories and thirty clues, plus one Final Clue. You type free-form answers; the score updates as you go. Wrong answers subtract their value, just like in real trivia. Share your final score as an emoji grid when you finish.
        </p>
        <p className="text-white/85 mb-4">
          A new board appears every day at midnight US Eastern.
        </p>
        <h2 className="font-serif text-2xl font-black text-gold-bright mt-8 mb-3">
          How clues are written
        </h2>
        <p className="text-white/85 mb-4">
          Clueboard&rsquo;s clues are original, written specifically for this site by Anthropic&rsquo;s Claude AI in a classic declarative trivia voice. Each clue is grounded in a verified factual question/answer pair drawn from two freely-licensed public trivia datasets:{" "}
          <a className="underline" target="_blank" rel="noreferrer" href="https://opentdb.com">Open Trivia Database</a>{" "}
          (CC BY-SA 4.0) and{" "}
          <a className="underline" target="_blank" rel="noreferrer" href="https://the-trivia-api.com">The Trivia API</a>{" "}
          (CC BY 4.0). The factual content belongs to those source datasets and their original contributors; the rewritten clue text is original to Clueboard.
        </p>
        <p className="text-white/85 mb-4">
          Clueboard is an independent project. It is not affiliated with, endorsed by, or sponsored by Sony Pictures Television or Jeopardy Productions, Inc. &ldquo;Jeopardy!&rdquo; and related marks are the property of their respective owners.
        </p>
        <p className="text-white/60 text-sm mt-8">
          MVP build &mdash; sign-in, cross-device stats, and a bigger clue bank are coming soon.
        </p>
      </article>
    </main>
  );
}
