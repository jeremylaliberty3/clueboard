import "server-only";
import { getSupabase } from "./supabase";
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

// Cache the full clue pool for the lifetime of the server process.
// 140 rows is trivially small and never changes mid-run.
let _allCluesCache: { single: Clue[]; final: Clue[] } | null = null;

async function loadAllClues(): Promise<{ single: Clue[]; final: Clue[] }> {
  if (_allCluesCache) return _allCluesCache;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clues")
    .select("id, category, category_tag, clue, answer, value, round");
  if (error) throw new Error(`Supabase error loading clues: ${error.message}`);
  if (!data) throw new Error("No clue data returned from Supabase.");

  const all: Clue[] = data.map((row) => ({
    id: row.id,
    category: row.category,
    categoryTag: row.category_tag ?? "",
    clue: row.clue,
    answer: row.answer,
    value: row.value,
    round: row.round as "single" | "final",
  }));
  _allCluesCache = {
    single: all.filter((c) => c.round === "single"),
    final: all.filter((c) => c.round === "final"),
  };
  return _allCluesCache;
}

// Cache rendered boards by date so repeat requests don't redo the seeded shuffle.
const _boardCache = new Map<string, DailyBoard>();

export async function getDailyBoard(date: string = todayDateString()): Promise<DailyBoard> {
  const cached = _boardCache.get(date);
  if (cached) return cached;

  const { single, final } = await loadAllClues();
  const seed = seedFromDate(date);
  const rng = mulberry32(seed);

  // Group eligible single-round clues by category, only keep categories with all 5 standard values.
  const byCat: Record<string, Clue[]> = {};
  for (const cl of single) {
    (byCat[cl.category] ||= []).push(cl);
  }
  const eligibleCategories = Object.keys(byCat).filter((cat) => {
    const present = new Set(byCat[cat].map((c) => c.value));
    return STANDARD_VALUES.every((v) => present.has(v));
  });

  const chosenCategories = shuffle(eligibleCategories, rng).slice(0, 6);
  if (chosenCategories.length < 6) {
    throw new Error(
      `Not enough eligible categories in Supabase (need 6, have ${chosenCategories.length}).`,
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

  if (final.length === 0) throw new Error("No final-round clues in Supabase.");
  const finalIdx = Math.floor(rng() * final.length);
  const finalClue = stripAnswer(final[finalIdx]);

  const board: DailyBoard = {
    date,
    categories: chosenCategories,
    cellsByCategory,
    finalClue,
  };
  _boardCache.set(date, board);
  return board;
}

export async function isClueOnBoard(clueId: number, date: string): Promise<boolean> {
  const board = await getDailyBoard(date);
  for (const cat of board.categories) {
    if (board.cellsByCategory[cat].some((c) => c.id === clueId)) return true;
  }
  return board.finalClue.id === clueId;
}

export async function getClueWithAnswer(clueId: number, date: string): Promise<Clue | undefined> {
  if (!(await isClueOnBoard(clueId, date))) return undefined;
  const { single, final } = await loadAllClues();
  return [...single, ...final].find((c) => c.id === clueId);
}
