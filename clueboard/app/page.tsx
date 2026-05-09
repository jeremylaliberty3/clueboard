import Link from "next/link";

export default function Landing() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <div className="font-serif text-2xl font-black text-gold-bright tracking-tight">
          Clueboard
        </div>
        <nav className="text-sm text-white/70">
          <Link href="/about" className="hover:text-white">About</Link>
        </nav>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-3xl mx-auto">
        <h1 className="font-serif font-black text-5xl sm:text-6xl text-gold-bright leading-tight mb-6">
          A daily trivia puzzle.<br />One board, one shot, every day.
        </h1>
        <p className="font-serif text-2xl text-white/80 mb-10 max-w-xl leading-snug">
          Six categories. Thirty clues. One Final Clue. Type your answers, build a score, and share your result. New board every day at midnight Eastern.
        </p>
        <Link
          href="/play"
          className="inline-block bg-gold-bright text-board font-bold text-lg px-8 py-4 rounded-lg hover:brightness-110 transition shadow-lg"
        >
          Play today&apos;s board
        </Link>
        <p className="text-sm text-white/50 mt-6">No sign-in required.</p>
      </section>

      <footer className="px-6 py-8 text-xs text-white/50 text-center max-w-3xl mx-auto">
        <p>
          Clues sourced from real Jeopardy! episodes via the public{" "}
          <a
            className="underline hover:text-white"
            href="https://github.com/jwolle1/jeopardy_clue_dataset"
            target="_blank"
            rel="noreferrer"
          >
            jwolle1 dataset
          </a>
          . Clueboard is not affiliated with, endorsed by, or sponsored by Sony Pictures Television or Jeopardy Productions, Inc.
        </p>
        <p className="mt-3">
          <Link href="/about" className="hover:text-white">About</Link>
        </p>
      </footer>
    </main>
  );
}
