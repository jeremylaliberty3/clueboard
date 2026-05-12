"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import type { DailyBoard, GameState, ClueForClient, AnswerRecord } from "@/lib/types";
import {
  submitAnswerAction, submitFinalAnswerAction, skipClueAction,
  saveGameStateAction, loadGameStateAction,
} from "@/lib/actions";
import {
  loadState, saveState, clearState, emptyState, recordAnswer,
  loadView, saveView, appendHistory,
} from "@/lib/storage";
import GridBoard from "./GridBoard";
import AccordionBoard from "./AccordionBoard";
import ClueModal from "./ClueModal";
import FinalClue from "./FinalClue";
import ResultScreen from "./ResultScreen";
import ReviewBoard from "./ReviewBoard";
import SignOutButton from "./SignOutButton";
import HowToPlayModal from "./HowToPlayModal";

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
  const [showHowTo, setShowHowTo] = useState(false);

  const isSignedIn = displayName !== null;

  // Hydrate state + view from the appropriate backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let initial: GameState | null = null;
      if (isSignedIn) {
        // DB wins. If a row exists for today, use it (drops any stale local
        // state from a prior anon session). Otherwise migrate any local
        // state up to the DB on first sign-in.
        const result = await loadGameStateAction();
        if (cancelled) return;
        if (result.ok && result.state) {
          initial = result.state;
          clearState(board.date);
        } else {
          const local = loadState(board.date);
          if (local) {
            await saveGameStateAction(local);
            if (cancelled) return;
            clearState(board.date);
            initial = local;
          }
        }
      } else {
        initial = loadState(board.date);
      }
      if (cancelled) return;
      if (initial) initial = pruneStaleAnswers(initial, board);
      setState(initial ?? emptyState(board.date));

      const savedView = loadView();
      setView(savedView ?? (window.innerWidth >= 768 ? "grid" : "accordion"));
      const answered = initial ? Object.keys(initial.answers).length : 0;
      if (!isSignedIn && answered === 0) setShowHowTo(true);
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [board.date, isSignedIn]);

  // Single helper for every state mutation: updates React state AND
  // persists to the right backend. Replaces ad-hoc setState calls in the
  // submit/skip/wager handlers.
  const commitState = useCallback(
    (next: GameState) => {
      setState(next);
      if (isSignedIn) {
        // Fire-and-forget; failures here just mean the next save will
        // catch up. No user-visible interruption.
        void saveGameStateAction(next);
      } else {
        saveState(next);
      }
    },
    [isSignedIn],
  );

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
      commitState({ ...state, phase: "final_wager" });
    }
  }, [allAnswered, state, commitState]);

  const handleSelectClue = (clue: ClueForClient) => {
    if (!state) return;
    if (state.answers[clue.id]) return;
    setActiveClue(clue);
  };

  const handleSubmitClue = useCallback(
    async (clue: ClueForClient, userAnswer: string, wager?: number) => {
      const result = await submitAnswerAction(board.date, clue.id, userAnswer);
      if (!result.ok) return { correct: false, correctAnswer: "", error: result.error };
      const isDD = !!clue.isDailyDouble;
      const recordedValue = isDD ? (wager ?? 0) : result.value;
      const rec: AnswerRecord = {
        clueId: clue.id,
        userAnswer,
        correct: result.correct,
        skipped: false,
        value: recordedValue,
        isDailyDouble: isDD || undefined,
        correctAnswer: result.correctAnswer,
        answeredAt: new Date().toISOString(),
      };
      setState((prev) => {
        if (!prev) return prev;
        const next = recordAnswer(prev, rec);
        if (isSignedIn) void saveGameStateAction(next);
        else saveState(next);
        return next;
      });
      return { correct: result.correct, correctAnswer: result.correctAnswer };
    },
    [board.date, isSignedIn],
  );

  const handleSkipClue = useCallback(
    async (clue: ClueForClient, wager?: number) => {
      const result = await skipClueAction(board.date, clue.id);
      if (!result.ok) return { correctAnswer: "" };
      const isDD = !!clue.isDailyDouble;
      const recordedValue = isDD ? (wager ?? 0) : result.value;
      const rec: AnswerRecord = {
        clueId: clue.id,
        userAnswer: "",
        correct: false,
        skipped: true,
        value: recordedValue,
        isDailyDouble: isDD || undefined,
        correctAnswer: result.correctAnswer,
        answeredAt: new Date().toISOString(),
      };
      setState((prev) => {
        if (!prev) return prev;
        const next = recordAnswer(prev, rec);
        if (isSignedIn) void saveGameStateAction(next);
        else saveState(next);
        return next;
      });
      return { correctAnswer: result.correctAnswer };
    },
    [board.date, isSignedIn],
  );

  const handleSetWager = (wager: number) => {
    if (!state) return;
    commitState({
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
    commitState(next);
    // Anonymous users get their /profile stats from a localStorage history
    // index. Signed-in users' /profile (B.3) reads directly from the
    // game_sessions DB table, so skip the local history append for them.
    if (!isSignedIn) {
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
    }
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
            onContinue={() => state && commitState({ ...state, phase: "done" })}
          />
        )}

        {state.phase === "done" && !reviewing && (
          <ResultScreen
            board={board}
            state={state}
            onReview={() => setReviewing(true)}
            isSignedIn={isSignedIn}
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

      {showHowTo && <HowToPlayModal onClose={() => setShowHowTo(false)} />}

      {activeClue && (
        <ClueModal
          clue={activeClue}
          currentScore={state.score}
          onClose={() => setActiveClue(null)}
          onSubmit={async (answer, wager) => handleSubmitClue(activeClue, answer, wager)}
          onSkip={async (wager) => handleSkipClue(activeClue, wager)}
        />
      )}
    </main>
  );
}

/**
 * Drop answer entries that reference clue IDs not on the current board
 * (i.e. stale entries from a previous incarnation of today's date — can
 * happen when admin work wipes and re-inserts clues mid-day, giving new
 * clues new IDs while localStorage still has answers keyed by the old
 * ones). Recompute score from the surviving answers so we don't credit
 * or debit for ghost clues.
 */
function pruneStaleAnswers(state: GameState, board: DailyBoard): GameState {
  const validIds = new Set<number>();
  for (const cat of board.categories) {
    for (const cell of board.cellsByCategory[cat]) validIds.add(cell.id);
  }
  validIds.add(board.finalClue.id);

  const filteredAnswers: Record<number, AnswerRecord> = {};
  for (const [k, ans] of Object.entries(state.answers)) {
    const id = Number(k);
    if (validIds.has(id)) filteredAnswers[id] = ans;
  }

  if (Object.keys(filteredAnswers).length === Object.keys(state.answers).length) {
    return state; // nothing stale; return as-is
  }

  let score = 0;
  for (const ans of Object.values(filteredAnswers)) {
    if (ans.skipped && !ans.isDailyDouble) continue;
    score += ans.correct ? ans.value : -ans.value;
  }
  return { ...state, answers: filteredAnswers, score };
}

function formatMoney(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}
