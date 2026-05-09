import "server-only";
import { SINGLE_CLUES, FINAL_CLUES, clueById } from "./clues";
import type { Clue, ClueForClient, DailyBoard } from "./types";

// Mulberry32 PRNG — deterministic for a given seed.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const STANDARD_VALUES = [200, 400, 600, 800, 1000];

export function todayDateString(): string {
  // US/Eastern calendar date, YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function seedFromDate(date: string): number {
  // "2026-05-09" -> 20260509
  return parseInt(date.replaceAll("-", ""), 10);
}

function stripAnswer(c: Clue): ClueForClient {
  return {
    id: c.id,
    category: c.category,
    categoryTag: c.categoryTag,
    clue: c.clue,
    value: c.value,
    round: c.round,
  };
}

export function getDailyBoard(date: string = todayDateString()): DailyBoard {
  const seed = seedFromDate(date);
  const rng = mulberry32(seed);

  // Group eligible single-round clues by category, only keep categories with all 5 standard values.
  const byCat: Record<string, Clue[]> = {};
  for (const cl of SINGLE_CLUES) {
    (byCat[cl.category] ||= []).push(cl);
  }
  const eligibleCategories = Object.keys(byCat).filter((cat) => {
    const present = new Set(byCat[cat].map((c) => c.value));
    return STANDARD_VALUES.every((v) => present.has(v));
  });

  const chosenCategories = shuffle(eligibleCategories, rng).slice(0, 6);
  if (chosenCategories.length < 6) {
    throw new Error(
      `Not enough eligible categories (need 6, have ${chosenCategories.length}). Add more clues in lib/clues.ts.`,
    );
  }

  const cellsByCategory: Record<string, ClueForClient[]> = {};
  for (const cat of chosenCategories) {
    const picked: ClueForClient[] = [];
    for (const v of STANDARD_VALUES) {
      const candidates = byCat[cat].filter((c) => c.value === v);
      const idx = Math.floor(rng() * candidates.length);
      picked.push(stripAnswer(candidates[idx]));
    }
    cellsByCategory[cat] = picked;
  }

  const finalIdx = Math.floor(rng() * FINAL_CLUES.length);
  const finalClue = stripAnswer(FINAL_CLUES[finalIdx]);

  return {
    date,
    categories: chosenCategories,
    cellsByCategory,
    finalClue,
  };
}

export function isClueOnBoard(clueId: number, date: string): boolean {
  const board = getDailyBoard(date);
  for (const cat of board.categories) {
    if (board.cellsByCategory[cat].some((c) => c.id === clueId)) return true;
  }
  return board.finalClue.id === clueId;
}

export function getClueWithAnswer(clueId: number, date: string): Clue | undefined {
  if (!isClueOnBoard(clueId, date)) return undefined;
  return clueById(clueId);
}
