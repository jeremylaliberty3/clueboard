"use client";

import { useEffect } from "react";

export default function HowToPlayModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const scrollY = window.scrollY;
    const original = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = original.position;
      document.body.style.top = original.top;
      document.body.style.width = original.width;
      document.body.style.overflow = original.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center p-2 sm:p-4 z-50">
      <div className="relative bg-board border-2 border-gold rounded-lg max-w-2xl w-full p-5 sm:p-8 shadow-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-gold-bright hover:bg-white/10 hover:text-white text-xl leading-none"
        >
          &times;
        </button>
        <div className="text-center mb-6">
          <h2 className="font-serif font-black text-3xl sm:text-4xl text-gold-bright">
            How to play
          </h2>
          <p className="text-white/60 text-sm mt-2">
            One board. One shot. Same clues for every player today.
          </p>
        </div>

        <ol className="space-y-4 text-white/85 text-sm sm:text-base">
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">1.</span>
            <span>
              The board has <span className="text-gold-bright font-bold">6 categories</span> with{" "}
              <span className="text-gold-bright font-bold">5 clues each</span> — 30 clues in all, plus one{" "}
              <span className="text-gold-bright font-bold">Final Clue</span> at the end.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">2.</span>
            <span>
              Tap any clue to open it, then type your answer. Spelling is forgiving;
              you don&rsquo;t need to phrase it as a question.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">3.</span>
            <span>
              A <span className="text-correct font-bold">correct</span> answer{" "}
              <span className="text-correct font-bold italic">adds</span>{" "}
              the clue&rsquo;s value to your score. A{" "}
              <span className="text-wrong font-bold">wrong</span> answer{" "}
              <span className="text-wrong font-bold italic">subtracts</span> it.{" "}
              <span className="text-gold-bright font-bold">Skipping</span>
              <span className="text-white"> a regular clue </span>
              <span className="text-gold-bright font-bold italic">
                doesn&rsquo;t cost you points, but you won&rsquo;t be able to access the clue again.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">4.</span>
            <span>
              One hidden clue is the <span className="text-gold-bright font-bold">Daily Double</span>. You wager up to your
              current score (or up to $1,000 if your score is zero or below) before seeing it.
              Win the wager, or lose it — <span className="text-wrong font-bold">skipping costs the wager too.</span>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">5.</span>
            <span>
              After all 30 clues, you&rsquo;ll see the <span className="text-gold-bright font-bold">Final Clue</span>{" "}
              category and choose a wager (0 up to your score) before the clue is revealed.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-gold-bright font-bold">6.</span>
            <span>
              At the end, share your result as an emoji grid. A new board appears every day at midnight US Eastern.
            </span>
          </li>
        </ol>

        <div className="mt-7 rounded border border-white/15 bg-white/5 px-4 py-3 text-xs text-white/70">
          <span className="text-gold-bright font-bold">Tip:</span> sign in to save your score, sync across devices,
          and track your stats over time.
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={onClose}
            className="px-8 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110"
          >
            Got it — start playing
          </button>
        </div>
      </div>
    </div>
  );
}
