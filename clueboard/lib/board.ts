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
  // Dev-only override: set DEV_DATE_OVERRIDE=YYYY-MM-DD in .env.local to
  // load a future (or past) board locally without waiting for midnight.
  // Guarded by NODE_ENV so it has no effect on a production deploy.
  if (process.env.NODE_ENV !== "production") {
    const override = process.env.DEV_DATE_OVERRIDE?.trim();
    if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  }
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

// In-memory caches with TTLs. Vercel serverless instances are long-
// lived (sometimes hours) and admin actions like stage-boards can
// reshape the clue pool out from under them. A short TTL means an
// instance can serve stale content for at most ~60 seconds before it
// refetches.
const CLUE_CACHE_TTL_MS = 60_000;
const BOARD_CACHE_TTL_MS = 60_000;

let _allCluesCache: { single: Clue[]; final: Clue[]; expires: number } | null = null;

async function loadAllClues(): Promise<{ single: Clue[]; final: Clue[] }> {
  if (_allCluesCache && _allCluesCache.expires > Date.now()) {
    return { single: _allCluesCache.single, final: _allCluesCache.final };
  }
  const supabase = getSupabase();
  // Paginate. Supabase caps a single select at 1000 rows by default,
  // which silently truncates the clue pool. Any daily_boards row whose
  // clue_ids reference rows past that cap would fail to hydrate and
  // fall back to algorithmic generation — exactly the bug that hit prod
  // after the bank grew past 1000 clues.
  type Row = {
    id: number;
    category: string;
    category_tag: string | null;
    clue: string;
    answer: string;
    value: number | null;
    round: string;
    topic: string | null;
    category_style: string | null;
    difficulty_profile: string | null;
  };
  const data: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: chunk, error } = await supabase
      .from("clues")
      .select("id, category, category_tag, clue, answer, value, round, topic, category_style, difficulty_profile")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Supabase error loading clues: ${error.message}`);
    if (!chunk || chunk.length === 0) break;
    data.push(...(chunk as Row[]));
    if (chunk.length < 1000) break;
  }
  if (data.length === 0) throw new Error("No clue data returned from Supabase.");

  const all: Clue[] = data.map((row) => ({
    id: row.id,
    category: row.category,
    categoryTag: row.category_tag ?? "",
    clue: row.clue,
    answer: row.answer,
    value: row.value,
    round: row.round as "single" | "final",
    topic: row.topic ?? null,
    categoryStyle: row.category_style ?? null,
    difficultyProfile: row.difficulty_profile ?? null,
  }));
  _allCluesCache = {
    single: all.filter((c) => c.round === "single"),
    final: all.filter((c) => c.round === "final"),
    expires: Date.now() + CLUE_CACHE_TTL_MS,
  };
  return { single: _allCluesCache.single, final: _allCluesCache.final };
}

// Per-category metadata derived from the first clue in each category.
type CategoryMeta = {
  topic: string;
  style: "knowledge" | "wordplay" | "themed";
  difficultyProfile: "easy_leaning" | "balanced" | "hard_leaning";
};

function buildCategoryMeta(byCat: Record<string, Clue[]>): Record<string, CategoryMeta> {
  const out: Record<string, CategoryMeta> = {};
  for (const [cat, clues] of Object.entries(byCat)) {
    const first = clues[0];
    out[cat] = {
      topic: first.topic ?? "MISC",
      style: (first.categoryStyle ?? "knowledge") as CategoryMeta["style"],
      difficultyProfile: (first.difficultyProfile ?? "balanced") as CategoryMeta["difficultyProfile"],
    };
  }
  return out;
}

/**
 * Pick 6 categories for today's board using the variety rules, with
 * soft relaxation when the bank can't satisfy them all.
 *
 *   Rule 1 (hard):  All 6 categories from distinct topics.
 *                   Falls back to "shuffle and take 6" if <6 topics in bank.
 *   Rule 2 (soft):  At least 1 wordplay or themed category.
 *                   Skipped if no wordplay/themed in any chosen topic.
 *   Rule 3 (soft):  At least 2 "balanced" difficulty profiles.
 *                   Best-effort substitution within the chosen topics.
 */
function pickBoardCategories(
  byCat: Record<string, Clue[]>,
  meta: Record<string, CategoryMeta>,
  rng: () => number,
): string[] {
  const allCats = Object.keys(byCat);
  if (allCats.length < 6) {
    throw new Error(`Not enough eligible categories (need 6, have ${allCats.length}).`);
  }

  // Group categories by topic.
  const byTopic: Record<string, string[]> = {};
  for (const cat of allCats) {
    (byTopic[meta[cat].topic] ||= []).push(cat);
  }
  const topics = Object.keys(byTopic);

  // Rule 1: if we don't have 6 distinct topics, abandon variety rules
  // entirely and pick 6 random eligible categories. Only happens early
  // in the bank's life or for very thin topics.
  if (topics.length < 6) {
    return shuffle(allCats, rng).slice(0, 6);
  }

  // Pick 6 topics, then one category per topic.
  const chosenTopics = shuffle(topics, rng).slice(0, 6);
  let chosen = chosenTopics.map((t) => shuffle(byTopic[t], rng)[0]);

  // Rule 2: ensure at least one wordplay/themed category.
  const isVariety = (cat: string) =>
    meta[cat].style === "wordplay" || meta[cat].style === "themed";
  if (!chosen.some(isVariety)) {
    // First try: swap within already-chosen topics if a variety alternate exists.
    let swapped = false;
    for (let i = 0; i < chosenTopics.length && !swapped; i++) {
      const t = chosenTopics[i];
      const alternates = byTopic[t].filter(isVariety);
      if (alternates.length > 0) {
        chosen[i] = alternates[Math.floor(rng() * alternates.length)];
        swapped = true;
      }
    }
    // Second try: drop one chosen topic, replace with a topic that has
    // a wordplay/themed category.
    if (!swapped) {
      const remainingTopics = topics.filter((t) => !chosenTopics.includes(t));
      for (const t of shuffle(remainingTopics, rng)) {
        const candidates = byTopic[t].filter(isVariety);
        if (candidates.length > 0) {
          // Replace the topic we're least attached to (last).
          chosenTopics[chosenTopics.length - 1] = t;
          chosen[chosen.length - 1] = candidates[Math.floor(rng() * candidates.length)];
          break;
        }
      }
    }
    // If still none, accept — the bank has no variety categories yet.
  }

  // Rule 3: at least 2 "balanced" difficulty profiles.
  const countBalanced = () =>
    chosen.filter((c) => meta[c].difficultyProfile === "balanced").length;
  if (countBalanced() < 2) {
    // Try in-topic swaps to gain balanced categories.
    for (let i = 0; i < chosen.length && countBalanced() < 2; i++) {
      if (meta[chosen[i]].difficultyProfile === "balanced") continue;
      const t = chosenTopics[i];
      const balanced = byTopic[t].filter((c) => meta[c].difficultyProfile === "balanced");
      if (balanced.length > 0) {
        chosen[i] = balanced[Math.floor(rng() * balanced.length)];
      }
    }
    // Stop trying — we did what we could.
  }

  return chosen;
}

const _boardCache = new Map<string, { board: DailyBoard; expires: number }>();

/**
 * Returns the daily board for a given date. The lookup order is:
 *
 *   1. In-memory cache (per-process, with TTL)
 *   2. Persistent `daily_boards` row (frozen artifact)
 *   3. Generate fresh via seeded RNG, then persist
 *
 * Once a date's board is persisted, it's immutable — even if the
 * clue pool grows or the algorithm changes, past boards stay as they
 * were when first generated.
 */
export async function getDailyBoard(date: string = todayDateString()): Promise<DailyBoard> {
  const cached = _boardCache.get(date);
  if (cached && cached.expires > Date.now()) return cached.board;

  // 1. Try the persistent store.
  const stored = await loadStoredBoard(date);
  if (stored) {
    _boardCache.set(date, { board: stored, expires: Date.now() + BOARD_CACHE_TTL_MS });
    return stored;
  }

  // 2. Generate from scratch and persist.
  const board = await generateFreshBoard(date);
  await persistBoard(board);
  _boardCache.set(date, { board, expires: Date.now() + BOARD_CACHE_TTL_MS });
  return board;
}

/**
 * Hydrate a previously-persisted board from `daily_boards`. Returns
 * null if the row doesn't exist or any of its referenced clue rows
 * have been deleted (defensive — treat broken rows as missing).
 */
async function loadStoredBoard(date: string): Promise<DailyBoard | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("daily_boards")
    .select("date, categories, clue_ids, final_clue_id, daily_double_clue_id")
    .eq("date", date)
    .maybeSingle();
  if (error || !data) return null;

  const { single, final } = await loadAllClues();
  const byId = new Map<number, Clue>();
  for (const c of single) byId.set(c.id, c);
  for (const c of final) byId.set(c.id, c);

  const cellsByCategory: Record<string, ClueForClient[]> = {};
  for (const cat of data.categories) cellsByCategory[cat] = [];
  for (const id of data.clue_ids) {
    const clue = byId.get(id);
    if (!clue) return null; // stale row; let caller fall back to fresh generation
    const cell = stripAnswer(clue);
    if (data.daily_double_clue_id === id) cell.isDailyDouble = true;
    (cellsByCategory[clue.category] ||= []).push(cell);
  }
  // Each category's clues should be sorted ascending by dollar value.
  for (const cat of data.categories) {
    cellsByCategory[cat]?.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  }

  const finalClueRow = byId.get(data.final_clue_id);
  if (!finalClueRow) return null;

  return {
    date: data.date,
    categories: data.categories,
    cellsByCategory,
    finalClue: stripAnswer(finalClueRow),
  };
}

/**
 * Compute today's board from the seeded RNG. Pure function of the
 * date and the current clue pool — no DB side effects.
 */
async function generateFreshBoard(date: string): Promise<DailyBoard> {
  const { single, final } = await loadAllClues();
  const seed = seedFromDate(date);
  const rng = mulberry32(seed);

  const byCat: Record<string, Clue[]> = {};
  for (const cl of single) {
    (byCat[cl.category] ||= []).push(cl);
  }
  const eligible: Record<string, Clue[]> = {};
  for (const [cat, clues] of Object.entries(byCat)) {
    const present = new Set(clues.map((c) => c.value));
    if (STANDARD_VALUES.every((v) => present.has(v))) {
      eligible[cat] = clues;
    }
  }
  const meta = buildCategoryMeta(eligible);

  const chosenCategories = pickBoardCategories(eligible, meta, rng);

  const cellsByCategory: Record<string, ClueForClient[]> = {};
  for (const cat of chosenCategories) {
    const picked: ClueForClient[] = [];
    for (const v of STANDARD_VALUES) {
      const candidates = eligible[cat].filter((c) => c.value === v);
      const idx = Math.floor(rng() * candidates.length);
      picked.push(stripAnswer(candidates[idx]));
    }
    cellsByCategory[cat] = picked;
  }

  // Daily Double — deterministically pick one cell on the board.
  // Bias to $400+ rows so it isn't sitting on the $200 freebie.
  {
    const ddCatIdx = Math.floor(rng() * chosenCategories.length);
    const ddValueIdx = 1 + Math.floor(rng() * 4);
    const ddCat = chosenCategories[ddCatIdx];
    cellsByCategory[ddCat][ddValueIdx].isDailyDouble = true;
  }

  // Rule 4 (soft): prefer a Final Clue from a topic that isn't on the board.
  if (final.length === 0) throw new Error("No final-round clues in Supabase.");
  const boardTopics = new Set(chosenCategories.map((c) => meta[c].topic));
  const offBoardFinals = final.filter((f) => f.topic && !boardTopics.has(f.topic));
  const finalPool = offBoardFinals.length > 0 ? offBoardFinals : final;
  const finalClue = stripAnswer(finalPool[Math.floor(rng() * finalPool.length)]);

  return {
    date,
    categories: chosenCategories,
    cellsByCategory,
    finalClue,
  };
}

/**
 * Write a freshly-generated board to `daily_boards` via the
 * persist_daily_board() SECURITY DEFINER function (which is callable
 * via the anon key but won't overwrite an existing row, so concurrent
 * first-of-day requests are safe).
 */
async function persistBoard(board: DailyBoard): Promise<void> {
  const supabase = getSupabase();
  const clueIds: number[] = [];
  let dailyDoubleClueId: number | null = null;
  for (const cat of board.categories) {
    for (const cell of board.cellsByCategory[cat]) {
      clueIds.push(cell.id);
      if (cell.isDailyDouble) dailyDoubleClueId = cell.id;
    }
  }
  const { error } = await supabase.rpc("persist_daily_board", {
    p_date: board.date,
    p_categories: board.categories,
    p_clue_ids: clueIds,
    p_final_clue_id: board.finalClue.id,
    p_daily_double_clue_id: dailyDoubleClueId,
  });
  if (error) {
    // Soft fail — game still works from the in-memory cache; the next
    // first-visit will retry.
    console.warn(`persistBoard failed for ${board.date}:`, error.message);
  }
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
