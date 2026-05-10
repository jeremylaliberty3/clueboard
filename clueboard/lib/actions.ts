"use server";

import { getDailyBoard, getClueWithAnswer, todayDateString } from "./board";
import { judgeAnswer } from "./validation";
import type { DailyBoard } from "./types";

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
