import type { GameState, AnswerRecord } from "./types";

const KEY_PREFIX = "clueboard:state:";
const VIEW_KEY = "clueboard:view";
const HISTORY_KEY = "clueboard:history";

export type HistoryEntry = {
  date: string;
  finalScore: number;
  baseScore: number;
  finalCorrect: boolean | null;
  finalWager: number;
  perCategory: { categoryTag: string; correct: number; total: number }[];
};

export function loadState(date: string): GameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + date);
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(state: GameState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_PREFIX + state.date, JSON.stringify(state));
}

export function emptyState(date: string): GameState {
  return {
    date,
    answers: {},
    score: 0,
    phase: "board",
  };
}

export function recordAnswer(state: GameState, rec: AnswerRecord): GameState {
  const delta = rec.skipped ? 0 : rec.correct ? rec.value : -rec.value;
  return {
    ...state,
    answers: { ...state.answers, [rec.clueId]: rec },
    score: state.score + delta,
  };
}

export function loadView(): "grid" | "accordion" | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(VIEW_KEY);
  if (v === "grid" || v === "accordion") return v;
  return null;
}

export function saveView(v: "grid" | "accordion") {
  if (typeof window === "undefined") return;
  localStorage.setItem(VIEW_KEY, v);
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry) {
  if (typeof window === "undefined") return;
  const all = loadHistory().filter((e) => e.date !== entry.date);
  all.push(entry);
  all.sort((a, b) => a.date.localeCompare(b.date));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
}
