"use client";

import { useEffect, useRef, useState } from "react";
import type { ClueForClient } from "@/lib/types";

type SubmitResult = { correct: boolean; correctAnswer: string; error?: string };
type SkipResult = { correctAnswer: string };

export default function ClueModal({
  clue, currentScore, onClose, onSubmit, onSkip,
}: {
  clue: ClueForClient;
  /** Player's current score. Determines the Daily Double wager cap. */
  currentScore: number;
  onClose: () => void;
  onSubmit: (answer: string, wager?: number) => Promise<SubmitResult>;
  onSkip: (wager?: number) => Promise<SkipResult>;
}) {
  const isDD = !!clue.isDailyDouble;
  // For Daily Double, max wager is the higher of current score and $1000
  // (per the rule "if balance below 1000, can wager up to 1000").
  const maxWager = isDD ? Math.max(currentScore, 1000) : 0;

  // For DD, locked-in wager (null until the player commits).
  const [wager, setWager] = useState<number | null>(null);
  // The text input for the wager (string so user can edit freely).
  const [wagerInput, setWagerInput] = useState<string>(
    isDD ? String(Math.min(1000, maxWager)) : "",
  );

  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Lock body scroll while the modal is open. When the soft keyboard
  // opens on mobile, the underlying document would otherwise scroll
  // (Safari/Chrome auto-scroll the focused input into view), leaving
  // the page at a different position when the modal closes. Freezing
  // the body and snapping it back on unmount keeps the player's place.
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
  const [result, setResult] = useState<
    | { kind: "correct"; delta: number }
    | { kind: "wrong"; delta: number; correctAnswer: string }
    | { kind: "skipped"; delta: number; correctAnswer: string }
    | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wagerInputRef = useRef<HTMLInputElement>(null);
  // The scrollable inner box of the modal. We snap it to scrollTop=0
  // on mount and phase change so the clue text is always visible from
  // the top, regardless of where the browser might have auto-scrolled
  // it to chase the focused input.
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Focus the wager input on open for DD, otherwise the answer input.
  // `preventScroll: true` tells the browser to focus without scrolling
  // any ancestor containers — without it, the modal's overflow-y-auto
  // box would scroll the input into view and push the clue out of sight.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    if (isDD && wager === null) wagerInputRef.current?.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [isDD, wager]);

  // After a result is shown, auto-close.
  useEffect(() => {
    if (!result) return;
    const ms = result.kind === "correct" ? 1100 : 1400;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [result, onClose]);

  // Escape close is intentionally removed — once a clue is open you must
  // either Skip or Submit. No bailout.

  const lockWager = () => {
    const n = parseInt(wagerInput, 10);
    if (isNaN(n) || n < 0 || n > maxWager) return;
    setWager(n);
  };

  // For DD, the score-affecting magnitude is the wager. For regular, it's
  // the clue's dollar value.
  const stakes = isDD ? (wager ?? 0) : (clue.value ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || result) return;
    setSubmitting(true);
    const r = await onSubmit(answer, isDD ? wager ?? 0 : undefined);
    setSubmitting(false);
    setResult(r.correct
      ? { kind: "correct", delta: stakes }
      : { kind: "wrong", delta: -stakes, correctAnswer: r.correctAnswer });
  };

  const skip = async () => {
    if (submitting || result) return;
    setSubmitting(true);
    const r = await onSkip(isDD ? wager ?? 0 : undefined);
    setSubmitting(false);
    // Daily Double skip applies the wager penalty; regular skip is free.
    const delta = isDD ? -stakes : 0;
    setResult({ kind: "skipped", delta, correctAnswer: r.correctAnswer });
  };

  // ── DD wager phase ──────────────────────────────────────────
  if (isDD && wager === null) {
    const n = parseInt(wagerInput, 10);
    const valid = !isNaN(n) && n >= 0 && n <= maxWager;
    return (
      <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
        <div ref={scrollerRef} className="bg-board border-2 border-gold rounded-lg max-w-2xl w-full p-4 sm:p-10 shadow-2xl text-center max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <div className="text-gold-bright uppercase text-sm font-bold tracking-wide mb-2">
            {clue.category} · ${clue.value}
          </div>
          <div className="font-serif font-black text-5xl sm:text-6xl text-gold-bright my-6">
            Daily Double!
          </div>
          <p className="text-white/80 mb-4">
            Wager between $0 and{" "}
            <span className="text-gold-bright font-bold">
              ${maxWager.toLocaleString()}
            </span>.
          </p>
          <p className="text-xs text-white/50 mb-6">
            A correct answer wins the wager; an incorrect answer (or skip) loses it.
          </p>
          <input
            ref={wagerInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // preventDefault so the Enter keypress can't continue to
                // submit the answer-phase form that gets rendered on the
                // next tick when we setWager().
                e.preventDefault();
                if (valid) lockWager();
              }
            }}
            className="w-44 mx-auto block text-center text-3xl font-bold px-4 py-3 rounded bg-white/10 border border-white/20 text-gold-bright focus:outline-none focus:border-gold-bright"
          />
          <button
            disabled={!valid}
            onClick={lockWager}
            className="mt-6 px-8 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110 disabled:opacity-50"
          >
            Lock in wager
          </button>
        </div>
      </div>
    );
  }

  // ── Regular / DD answer phase ───────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
      <div ref={scrollerRef} className="bg-board border-2 border-gold rounded-lg max-w-2xl w-full p-4 sm:p-10 shadow-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between text-gold-bright text-sm font-bold mb-2 sm:mb-4">
          <span className="uppercase tracking-wide">
            {clue.category}
            {isDD && (
              <span className="ml-2 text-gold-bright/80">· Daily Double · Wager ${stakes.toLocaleString()}</span>
            )}
          </span>
          {!isDD && <span>${clue.value}</span>}
        </div>
        <p className="font-serif font-bold text-xl sm:text-3xl text-white/95 text-center leading-snug py-3 sm:py-8">
          {clue.clue}
        </p>
        {!result ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input
              ref={inputRef}
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer…"
              className="w-full px-4 py-3 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
              disabled={submitting}
            />
            <div className="flex flex-wrap gap-2 justify-end items-center">
              <button
                type="button"
                onClick={skip}
                disabled={submitting}
                className={`px-4 py-2 text-sm border rounded ${
                  isDD
                    ? "text-wrong border-wrong/40 hover:bg-wrong/10"
                    : "text-white/70 hover:text-white border-white/15"
                }`}
              >
                {isDD
                  ? `Skip (−$${stakes.toLocaleString()})`
                  : "Skip (no penalty)"}
              </button>
              <button
                type="submit"
                disabled={submitting || !answer.trim()}
                className="px-6 py-2 bg-gold text-board font-bold rounded hover:brightness-110 disabled:opacity-50"
              >
                {submitting ? "Checking…" : "Submit"}
              </button>
            </div>
          </form>
        ) : (
          <div className="text-center py-4">
            {result.kind === "correct" && (
              <>
                <div className="font-serif text-3xl font-black text-correct">
                  Correct! +${result.delta.toLocaleString()}
                </div>
              </>
            )}
            {result.kind === "wrong" && (
              <>
                <div className="font-serif text-3xl font-black text-wrong">
                  Incorrect — −${Math.abs(result.delta).toLocaleString()}
                </div>
                <div className="text-white/80 mt-3">
                  The answer was{" "}
                  <span className="text-gold-bright font-bold">{result.correctAnswer}</span>
                </div>
              </>
            )}
            {result.kind === "skipped" && (
              <>
                <div className="font-serif text-3xl font-black text-white/80">
                  {isDD
                    ? `Skipped — −$${Math.abs(result.delta).toLocaleString()}`
                    : "Skipped"}
                </div>
                <div className="text-white/80 mt-3">
                  The answer was{" "}
                  <span className="text-gold-bright font-bold">{result.correctAnswer}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
