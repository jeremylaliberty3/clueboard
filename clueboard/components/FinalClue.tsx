"use client";

import { useEffect, useState } from "react";

type WagerProps = {
  phase: "wager";
  category: string;
  currentScore: number;
  onWager: (wager: number) => void;
};

type ClueProps = {
  phase: "clue";
  category: string;
  clue: string;
  currentScore: number;
  wager: number;
  onSubmit: (answer: string) => Promise<{ correct: boolean; correctAnswer: string }>;
  onContinue: () => void;
};

export default function FinalClue(props: WagerProps | ClueProps) {
  if (props.phase === "wager") return <WagerCard {...props} />;
  return <ClueCard {...props} />;
}

function WagerCard({ category, currentScore, onWager }: WagerProps) {
  const max = Math.max(0, currentScore);
  const [wager, setWager] = useState<string>(String(Math.min(max, 1000)));
  const num = parseInt(wager, 10);
  const valid = !isNaN(num) && num >= 0 && num <= max;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-board-deep border-2 border-gold rounded-md max-w-xl w-full p-8 text-center">
        <div className="text-gold-bright uppercase text-sm font-bold tracking-wide mb-2">
          Final Clue
        </div>
        <h2 className="font-serif font-black text-3xl sm:text-4xl text-gold-bright mb-6">
          {category}
        </h2>
        <p className="text-white/80 mb-6">
          Your current score is{" "}
          <span className="text-gold-bright font-bold">
            ${currentScore.toLocaleString()}
          </span>
          . Wager any amount from $0 to ${max.toLocaleString()}.
        </p>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={wager}
          onChange={(e) => setWager(e.target.value.replace(/[^0-9]/g, ""))}
          className="w-40 mx-auto block text-center text-2xl font-bold px-4 py-3 rounded bg-white/10 border border-white/20 text-gold-bright focus:outline-none focus:border-gold-bright"
        />
        <button
          disabled={!valid}
          onClick={() => onWager(num)}
          className="mt-6 px-8 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110 disabled:opacity-50"
        >
          Lock in wager
        </button>
      </div>
    </div>
  );
}

function ClueCard({ category, clue, wager, onSubmit, onContinue }: ClueProps) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; correctAnswer: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || result) return;
    setSubmitting(true);
    const r = await onSubmit(answer);
    setSubmitting(false);
    setResult(r);
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-board border-2 border-gold rounded-md max-w-2xl w-full p-8 text-center">
        <div className="text-gold-bright uppercase text-sm font-bold tracking-wide mb-2">
          Final Clue · {category} · Wager ${wager.toLocaleString()}
        </div>
        <p className="font-serif font-bold text-2xl sm:text-3xl text-white text-center leading-snug py-8">
          {clue}
        </p>
        {!result ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input
              type="text"
              autoFocus
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer…"
              className="w-full px-4 py-3 rounded bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-gold-bright"
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={submitting || !answer.trim()}
              className="px-6 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Checking…" : "Submit final answer"}
            </button>
          </form>
        ) : (
          <div className="py-4">
            <div
              className={`font-serif text-3xl font-black ${
                result.correct ? "text-correct" : "text-wrong"
              }`}
            >
              {result.correct
                ? `Correct! +$${wager.toLocaleString()}`
                : `Incorrect — −$${wager.toLocaleString()}`}
            </div>
            <div className="text-white/85 mt-3">
              The answer was{" "}
              <span className="text-gold-bright font-bold">{result.correctAnswer}</span>
            </div>
            <button
              onClick={onContinue}
              className="mt-6 px-6 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110"
            >
              See your final score
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
