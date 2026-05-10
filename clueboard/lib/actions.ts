"use server";

import { getDailyBoard, getClueWithAnswer, todayDateString } from "./board";
import { judgeAnswer } from "./validation";
import { getSupabaseServerClient } from "./supabase-server";
import type { DailyBoard, GameState } from "./types";

export async function submitAnswerAction(
  date: string,
  clueId: number,
  userAnswer: string,
) {
  if (date !== todayDateString()) {
    return { ok: false as const, error: "Board is no longer current." };
  }
  const clue = await getClueWithAnswer(clueId, date);
  if (!clue) return { ok: false as const, error: "Clue not on today's board." };
  if (clue.round !== "single") return { ok: false as const, error: "Use submitFinalAnswer for the Final Clue." };
  const verdict = judgeAnswer(userAnswer, clue.answer);
  return {
    ok: true as const,
    correct: verdict.correct,
    correctAnswer: clue.answer,
    value: clue.value ?? 0,
    reason: verdict.reason,
  };
}

export async function submitFinalAnswerAction(
  date: string,
  clueId: number,
  userAnswer: string,
) {
  if (date !== todayDateString()) {
    return { ok: false as const, error: "Board is no longer current." };
  }
  const clue = await getClueWithAnswer(clueId, date);
  if (!clue || clue.round !== "final") {
    return { ok: false as const, error: "Final clue not found." };
  }
  const verdict = judgeAnswer(userAnswer, clue.answer);
  return {
    ok: true as const,
    correct: verdict.correct,
    correctAnswer: clue.answer,
    reason: verdict.reason,
  };
}

export async function skipClueAction(date: string, clueId: number) {
  if (date !== todayDateString()) {
    return { ok: false as const, error: "Board is no longer current." };
  }
  const clue = await getClueWithAnswer(clueId, date);
  if (!clue || clue.round !== "single") {
    return { ok: false as const, error: "Clue not on today's board." };
  }
  return {
    ok: true as const,
    correctAnswer: clue.answer,
    value: clue.value ?? 0,
  };
}

export async function getTodayBoardAction(): Promise<{ board: DailyBoard }> {
  return { board: await getDailyBoard() };
}

// ============================================================
// Signed-in game-session persistence (Phase B.2)
// ============================================================

async function validateStateAgainstBoard(state: GameState): Promise<string | null> {
  if (state.date !== todayDateString()) return "Date mismatch";
  const board = await getDailyBoard(state.date);
  const validIds = new Set<number>();
  for (const cat of board.categories) {
    for (const cell of board.cellsByCategory[cat]) validIds.add(cell.id);
  }
  validIds.add(board.finalClue.id);
  for (const k of Object.keys(state.answers)) {
    if (!validIds.has(parseInt(k, 10))) return "Invalid clue id in state";
  }
  return null;
}

/**
 * Upsert the signed-in user's game state for today. Returns ok=false for
 * anonymous users (the client should fall back to localStorage instead).
 */
export async function saveGameStateAction(state: GameState) {
  const supabase = await getSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false as const, error: "Not signed in" };

  const validationError = await validateStateAgainstBoard(state);
  if (validationError) return { ok: false as const, error: validationError };

  const isComplete = state.phase === "done";
  const { error } = await supabase.from("game_sessions").upsert(
    {
      user_id: userData.user.id,
      date: state.date,
      state: state as unknown as Record<string, unknown>,
      final_wager: state.finalWager ?? null,
      final_answer: state.finalAnswer ?? null,
      final_correct: state.finalCorrect ?? null,
      final_score: state.finalScore ?? null,
      status: isComplete ? "completed" : "in_progress",
      completed_at: isComplete ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,date" },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/** Load today's game session for the signed-in user. Returns null if none. */
export async function loadGameStateAction() {
  const supabase = await getSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false as const, error: "Not signed in" };

  const date = todayDateString();
  const { data, error } = await supabase
    .from("game_sessions")
    .select("state")
    .eq("user_id", userData.user.id)
    .eq("date", date)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    state: (data?.state as GameState | null) ?? null,
  };
}
