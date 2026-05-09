"use client";

import type { DailyBoard, GameState } from "@/lib/types";

export default function ReviewBoard({
  board, state, onBack,
}: {
  board: DailyBoard;
  state: GameState;
  onBack: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif text-3xl font-black text-gold-bright">Board review</h2>
        <button
          onClick={onBack}
          className="text-sm px-4 py-2 border border-white/20 rounded hover:bg-white/5"
        >
          Back to results
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {board.categories.map((cat) => (
          <section key={cat} className="bg-board-deep rounded-lg overflow-hidden">
            <h3 className="font-serif font-black text-gold-bright uppercase tracking-tight text-base sm:text-lg px-4 py-3 border-b border-white/5 text-center">
              {cat}
            </h3>
            <ul className="divide-y divide-white/5">
              {board.cellsByCategory[cat].map((cell) => {
                const ans = state.answers[cell.id];
                return (
                  <li key={cell.id} className="px-4 py-3 sm:px-6 sm:py-4">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="font-serif font-black text-gold-bright text-lg">
                        ${cell.value}
                      </span>
                      <Badge ans={ans} />
                    </div>
                    <p className="font-serif text-white/90 text-base sm:text-lg leading-snug mb-2">
                      {cell.clue}
                    </p>
                    <div className="text-sm text-white/70 space-y-0.5">
                      <div>
                        <span className="text-white/50">Your answer:</span>{" "}
                        {ans?.skipped ? (
                          <span className="italic text-white/50">skipped</span>
                        ) : ans?.userAnswer ? (
                          <span>{ans.userAnswer}</span>
                        ) : (
                          <span className="italic text-white/50">—</span>
                        )}
                      </div>
                      <div>
                        <span className="text-white/50">Correct answer:</span>{" "}
                        <span className="text-gold-bright font-medium">
                          {ans?.correctAnswer ?? "—"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section className="bg-board-deep rounded-lg overflow-hidden">
          <h3 className="font-serif font-black text-gold-bright uppercase tracking-tight text-base sm:text-lg px-4 py-3 border-b border-white/5 text-center">
            Final Clue · {board.finalClue.category}
          </h3>
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-white/60">
                Wager: ${(state.finalWager ?? 0).toLocaleString()}
              </span>
              <FinalBadge correct={state.finalCorrect} />
            </div>
            <p className="font-serif text-white/90 text-base sm:text-lg leading-snug mb-2">
              {board.finalClue.clue}
            </p>
            <div className="text-sm text-white/70 space-y-0.5">
              <div>
                <span className="text-white/50">Your answer:</span>{" "}
                {state.finalAnswer ? (
                  <span>{state.finalAnswer}</span>
                ) : (
                  <span className="italic text-white/50">—</span>
                )}
              </div>
              <div>
                <span className="text-white/50">Correct answer:</span>{" "}
                <span className="text-gold-bright font-medium">
                  {state.finalCorrectAnswer ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 mb-2 text-center">
        <button
          onClick={onBack}
          className="px-6 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110"
        >
          Back to results
        </button>
      </div>
    </div>
  );
}

function Badge({ ans }: { ans?: { correct: boolean; skipped: boolean } }) {
  if (!ans) return <span className="text-xs text-white/40">—</span>;
  if (ans.skipped) return <span className="text-xs text-white/50">skipped</span>;
  return ans.correct
    ? <span className="text-xs text-correct font-bold">Correct</span>
    : <span className="text-xs text-wrong font-bold">Incorrect</span>;
}

function FinalBadge({ correct }: { correct?: boolean }) {
  if (correct === undefined) return <span className="text-xs text-white/40">—</span>;
  return correct
    ? <span className="text-xs text-correct font-bold">Correct</span>
    : <span className="text-xs text-wrong font-bold">Incorrect</span>;
}
