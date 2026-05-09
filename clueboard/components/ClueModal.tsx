"use client";

import { useEffect, useRef, useState } from "react";
import type { ClueForClient } from "@/lib/types";

type SubmitResult = { correct: boolean; correctAnswer: string; error?: string };
type SkipResult = { correctAnswer: string };

export default function ClueModal({
  clue, onClose, onSubmit, onSkip,
}: {
  clue: ClueForClient;
  onClose: () => void;
  onSubmit: (answer: string) => Promise<SubmitResult>;
  onSkip: () => Promise<SkipResult>;
}) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: "correct" }
    | { kind: "wrong"; correctAnswer: string }
    | { kind: "skipped"; correctAnswer: string }
    | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!result) return;
    const ms = result.kind === "correct" ? 900 : 2200;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [result, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !result) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || result) return;
    setSubmitting(true);
    const r = await onSubmit(answer);
    setSubmitting(false);
    setResult(r.correct
      ? { kind: "correct" }
      : { kind: "wrong", correctAnswer: r.correctAnswer });
  };

  const skip = async () => {
    if (submitting || result) return;
    setSubmitting(true);
    const r = await onSkip();
    setSubmitting(false);
    setResult({ kind: "skipped", correctAnswer: r.correctAnswer });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-board border-2 border-gold rounded-lg max-w-2xl w-full p-6 sm:p-10 shadow-2xl">
        <div className="flex items-center justify-between text-gold-bright text-sm font-bold mb-4">
          <span className="uppercase tracking-wide">{clue.category}</span>
          <span>${clue.value}</span>
        </div>
        <p className="font-serif font-bold text-2xl sm:text-3xl text-white/95 text-center leading-snug py-8">
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
                className="px-4 py-2 text-sm text-white/70 hover:text-white border border-white/15 rounded"
              >
                Skip (no penalty)
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancel
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
              <div className="font-serif text-3xl font-black text-correct">Correct!</div>
            )}
            {result.kind === "wrong" && (
              <>
                <div className="font-serif text-3xl font-black text-wrong">Sorry — incorrect</div>
                <div className="text-white/80 mt-3">
                  The answer was{" "}
                  <span className="text-gold-bright font-bold">{result.correctAnswer}</span>
                </div>
              </>
            )}
            {result.kind === "skipped" && (
              <>
                <div className="font-serif text-3xl font-black text-white/80">Skipped</div>
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
