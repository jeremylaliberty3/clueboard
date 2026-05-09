"use client";

import type { DailyBoard, GameState, ClueForClient } from "@/lib/types";

export default function GridBoard({
  board, state, onSelect,
}: {
  board: DailyBoard;
  state: GameState;
  onSelect: (clue: ClueForClient) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1 min-w-[640px] mx-auto"
        style={{
          gridTemplateColumns: `repeat(${board.categories.length}, minmax(120px, 1fr))`,
        }}
      >
        {board.categories.map((cat) => (
          <div
            key={cat}
            className="bg-board-deep text-gold-bright font-serif font-black text-center text-sm sm:text-base uppercase tracking-tight px-2 py-4 min-h-20 flex items-center justify-center"
          >
            {cat}
          </div>
        ))}

        {[200, 400, 600, 800, 1000].map((value) =>
          board.categories.map((cat) => {
            const cell = board.cellsByCategory[cat].find((c) => c.value === value)!;
            const ans = state.answers[cell.id];
            return (
              <button
                key={cell.id}
                onClick={() => onSelect(cell)}
                disabled={!!ans}
                className={`bg-board-darker hover:bg-board-deep font-serif font-black text-2xl sm:text-3xl text-gold-bright min-h-20 sm:min-h-24 transition disabled:cursor-default ${
                  ans ? "opacity-50" : ""
                }`}
              >
                {ans ? (
                  ans.skipped ? (
                    <span className="text-white/50 text-2xl">—</span>
                  ) : (
                    <span className={ans.correct ? "text-correct" : "text-wrong"}>
                      {ans.correct ? "✓" : "✗"}
                    </span>
                  )
                ) : (
                  `$${value}`
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
