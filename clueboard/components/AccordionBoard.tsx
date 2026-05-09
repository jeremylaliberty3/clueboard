"use client";

import type { DailyBoard, GameState, ClueForClient } from "@/lib/types";

export default function AccordionBoard({
  board, state, onSelect,
}: {
  board: DailyBoard;
  state: GameState;
  onSelect: (clue: ClueForClient) => void;
}) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      {board.categories.map((cat) => {
        const cells = board.cellsByCategory[cat];
        return (
          <div key={cat} className="bg-board-deep rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5">
              <h3 className="font-serif font-black text-gold-bright uppercase tracking-tight text-base sm:text-lg text-center">
                {cat}
              </h3>
            </div>
            <div className="grid grid-cols-5 gap-1 p-2 bg-board-darker">
              {cells.map((c) => {
                const ans = state.answers[c.id];
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c)}
                    disabled={!!ans}
                    className={`min-h-20 font-serif font-black text-gold-bright text-xl sm:text-2xl hover:bg-board-deep transition rounded ${
                      ans ? "opacity-50" : ""
                    }`}
                  >
                    {ans ? (
                      ans.skipped ? (
                        <span className="text-white/50">—</span>
                      ) : (
                        <span className={ans.correct ? "text-correct" : "text-wrong"}>
                          {ans.correct ? "✓" : "✗"}
                        </span>
                      )
                    ) : (
                      `$${c.value}`
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
