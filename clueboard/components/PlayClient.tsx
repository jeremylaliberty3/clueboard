"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import type { DailyBoard, GameState, ClueForClient, AnswerRecord } from "@/lib/types";
import { submitAnswerAction, submitFinalAnswerAction, skipClueAction } from "@/lib/actions";
import {
  loadState, saveState, emptyState, recordAnswer,
  loadView, saveView, appendHistory,
} from "@/lib/storage";
import GridBoard from "./GridBoard";
import AccordionBoard from "./AccordionBoard";
import ClueModal from "./ClueModal";
import FinalClue from "./FinalClue";
import ResultScreen from "./ResultScreen";
import ReviewBoard from "./ReviewBoard";
import SignOutButton from "./SignOutButton";

type View = "grid" | "accordion";

export default function PlayClient({
  board,
  displayName,
}: {
  board: DailyBoard;
  displayName: string | null;
}) {
  const [state, setState] = useState<GameState | null>(null);
  const [view, setView] = useState<View>("grid");
  const [activeClue, setActiveClue] = useState<ClueForClient | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Hydrate state + view from localStorage.
  useEffect(() => {
    const existing = loadState(board.date);
    setState(existing ?? emptyState(board.date));
    const savedView = loadView();
    if (savedView) {
      setView(savedView);
    } else {
      setView(window.innerWidth >= 768 ? "grid" : "accordion");
    }
    setHydrated(true);
  }, [board.date]);

  // Persist on every change.
  useEffect(() => {
    if (state && hydrated) saveState(state);
  }, [state, hydrated]);

  const setViewPersist = (v: View) => {
    setView(v);
    saveView(v);
  };

  const totalClues = 30;
  const answeredCount = useMemo(
    () => (state ? Object.keys(state.answers).length : 0),
    [state],
  );
  const allAnswered = answeredCount >= totalClues;

  // Auto-advance to final phase when board complete.
  useEffect(() => {
    if (!state) return;
    if (allAnswered && state.phase === "board") {
      setState({ ...state, phase: "final_wager" });
    }
  }, [allAnswered, state]);

  const handleSelectClue = (clue: ClueForClient) => {
    if (!state) return;
    if (state.answers[clue.id]) return;
    setActiveClue(clue);
  };

  const handleSubmitClue = useCallback(
    async (clue: ClueForClient, userAnswer: string) => {
      const result = await submitAnswerAction(board.date, clue.id, userAnswer);
      if (!result.ok) return { correct: false, correctAnswer: "", error: result.error };
      const rec: AnswerRecord = {
        clueId: clue.id,
        userAnswer,
        correct: result.correct,
        skipped: false,
        value: result.value,
        correctAnswer: result.correctAnswer,
        answeredAt: new Date().toISOString(),
      };
      setState((prev) => (prev ? recordAnswer(prev, rec) : prev));
      return { correct: result.correct, correctAnswer: result.correctAnswer };
    },
    [board.date],
  );

  const handleSkipClue = useCallback(
    async (clue: ClueForClient) => {
      const result = await skipClueAction(board.date, clue.id);
      if (!result.ok) return { correctAnswer: "" };
      const rec: AnswerRecord = {
        clueId: clue.id,
        userAnswer: "",
        correct: false,
        skipped: true,
        value: result.value,
        correctAnswer: result.correctAnswer,
        answeredAt: new Date().toISOString(),
      };
      setState((prev) => (prev ? recordAnswer(prev, rec) : prev));
      return { correctAnswer: result.correctAnswer };
    },
    [board.date],
  );

  const handleSetWager = (wager: number) => {
    if (!state) return;
    setState({
      ...state,
      finalCategory: board.finalClue.category,
      finalWager: wager,
      phase: "final_clue",
    });
  };

  const handleSubmitFinal = async (userAnswer: string) => {
    if (!state) return { correct: false, correctAnswer: "" };
    const result = await submitFinalAnswerAction(
      board.date,
      board.finalClue.id,
      userAnswer,
    );
    if (!result.ok) return { correct: false, correctAnswer: "" };
    const wager = state.finalWager ?? 0;
    const delta = result.correct ? wager : -wager;
    const finalScore = state.score + delta;
    const next: GameState = {
      ...state,
      finalAnswer: userAnswer,
      finalCorrect: result.correct,
      finalCorrectAnswer: result.correctAnswer,
      finalScore,
      // Stay on "final_clue" so the user can read the verdict + correct answer.
      // Advances to "done" only when they click "See your final score".
    };
    setState(next);
    // Write history entry for /profile.
    const perCatMap = new Map<string, { correct: number; total: number }>();
    for (const cat of board.categories) {
      for (const cell of board.cellsByCategory[cat]) {
        const tag = cell.categoryTag;
        const rec = next.answers[cell.id];
        if (!rec || rec.skipped) continue; // skipped doesn't count toward accuracy
        const cur = perCatMap.get(tag) ?? { correct: 0, total: 0 };
        cur.total += 1;
        if (rec.correct) cur.correct += 1;
        perCatMap.set(tag, cur);
      }
    }
    appendHistory({
      date: board.date,
      finalScore,
      baseScore: state.score,
      finalCorrect: result.correct,
      finalWager: wager,
      perCategory: Array.from(perCatMap.entries()).map(([categoryTag, v]) => ({
        categoryTag, ...v,
      })),
    });
    return { correct: result.correct, correctAnswer: result.correctAnswer };
  };

  if (!hydrated || !state) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-white/60">Loading board…</div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4 border-b border-white/10">
        <Link href="/" className="font-serif text-xl font-black text-gold-bright">
          Clueboard
        </Link>
        <div className="flex items-center gap-4 sm:gap-6 text-sm">
          <div className="text-right">
            <div className="text-white/60 text-xs uppercase tracking-wide">Score</div>
            <div className={`font-bold text-lg ${state.score < 0 ? "text-wrong" : "text-gold-bright"}`}>
              {formatMoney(state.score)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-white/60 text-xs uppercase tracking-wide">Clues</div>
            <div className="font-bold text-lg">{answeredCount} / {totalClues}</div>
          </div>
          <button
            onClick={() => setViewPersist(view === "grid" ? "accordion" : "grid")}
            className="text-xs px-3 py-2 rounded border border-white/20 hover:bg-white/10"
          >
            {view === "grid" ? "Accordion" : "Grid"}
          </button>
          {displayName ? (
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-white/70 text-xs">{displayName}</span>
              <SignOutButton />
            </div>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent("/play")}`}
              className="text-xs text-white/70 hover:text-white border border-white/20 px-3 py-2 rounded"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col p-4 sm:p-6">
        {state.phase === "board" && (
          view === "grid" ? (
            <GridBoard board={board} state={state} onSelect={handleSelectClue} />
          ) : (
            <AccordionBoard board={board} state={state} onSelect={handleSelectClue} />
          )
        )}

        {state.phase === "final_wager" && (
          <FinalClue
            phase="wager"
            category={board.finalClue.category}
            currentScore={state.score}
            onWager={handleSetWager}
          />
        )}

        {state.phase === "final_clue" && (
          <FinalClue
            phase="clue"
            category={board.finalClue.category}
            clue={board.finalClue.clue}
            currentScore={state.score}
            wager={state.finalWager ?? 0}
            onSubmit={handleSubmitFinal}
            onContinue={() => setState((s) => (s ? { ...s, phase: "done" } : s))}
          />
        )}

        {state.phase === "done" && !reviewing && (
          <ResultScreen
            board={board}
            state={state}
            onReview={() => setReviewing(true)}
          />
        )}

        {state.phase === "done" && reviewing && (
          <ReviewBoard
            board={board}
            state={state}
            onBack={() => setReviewing(false)}
          />
        )}
      </div>

      {activeClue && (
        <ClueModal
          clue={activeClue}
          onClose={() => setActiveClue(null)}
          onSubmit={async (answer) => handleSubmitClue(activeClue, answer)}
          onSkip={async () => handleSkipClue(activeClue)}
        />
      )}
    </main>
  );
}

function formatMoney(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}
