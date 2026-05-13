"use client";

import { useState } from "react";
import Link from "next/link";
import type { DailyBoard, GameState } from "@/lib/types";

export default function ResultScreen({
  board, state, onReview, isSignedIn,
}: {
  board: DailyBoard;
  state: GameState;
  onReview: () => void;
  isSignedIn: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const finalScore = state.finalScore ?? state.score;

  const grid = board.categories.map((cat) =>
    board.cellsByCategory[cat].map((cell) => {
      const ans = state.answers[cell.id];
      if (!ans) return "⬜";
      // Skipped without penalty = white square. DD skip counts as wrong.
      if (ans.skipped && !ans.isDailyDouble) return "⬜";
      return ans.correct ? "🟦" : "🟥";
    }).join(""),
  ).join("\n");

  const finalLine = state.finalCorrect
    ? `Final: 🟦  (+$${(state.finalWager ?? 0).toLocaleString()})`
    : `Final: 🟥  (−$${(state.finalWager ?? 0).toLocaleString()})`;

  const dateLabel = new Date(board.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });

  const text =
    `Clueboard — ${dateLabel}\n` +
    `${finalScore < 0 ? "-" : ""}$${Math.abs(finalScore).toLocaleString()}\n\n` +
    `${grid}\n` +
    `${finalLine}\n\n` +
    `clueboard.app`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-board-deep border-2 border-gold rounded-lg max-w-xl w-full p-8 text-center">
        <div className="text-gold-bright uppercase text-sm font-bold tracking-wide mb-2">
          Final Score
        </div>
        <div
          className={`font-serif font-black text-6xl mb-2 ${
            finalScore < 0 ? "text-wrong" : "text-gold-bright"
          }`}
        >
          {finalScore < 0 ? "-" : ""}${Math.abs(finalScore).toLocaleString()}
        </div>
        <div className="text-white/70 mb-6">{dateLabel}</div>

        <pre className="bg-board-darker p-4 rounded text-left text-sm leading-relaxed mx-auto inline-block">
{text}
        </pre>

        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={copy}
            className="px-6 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110"
          >
            {copied ? "Copied!" : "Copy score card"}
          </button>
          <button
            onClick={onReview}
            className="px-6 py-3 border border-white/30 rounded hover:bg-white/10"
          >
            Review board
          </button>
          {isSignedIn && (
            <Link
              href="/profile"
              className="px-6 py-3 border border-white/30 rounded hover:bg-white/10"
            >
              View stats
            </Link>
          )}
        </div>

        {!isSignedIn && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <p className="text-sm text-white/80 mb-3">
              Sign in to save this score and start a streak.
            </p>
            <Link
              href="/login?next=/play"
              className="inline-block px-5 py-2.5 bg-gold-bright text-board font-bold rounded hover:brightness-110"
            >
              Sign in
            </Link>
          </div>
        )}

        <p className="text-xs text-white/50 mt-6">
          Come back tomorrow at midnight Eastern for a new board.
        </p>
      </div>
    </div>
  );
}
