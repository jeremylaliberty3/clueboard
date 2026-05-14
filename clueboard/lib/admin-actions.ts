"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdmin } from "./supabase-admin";
import { todayDateString } from "./board";

const GEN_DIR = path.join(process.cwd(), "data", "generated");
const REVIEW_STATE_PATH = path.join(GEN_DIR, ".review-state.json");

type ReviewState = {
  /** "<batchFile>::<categoryTitle>" entries the user explicitly rejected. */
  rejected: string[];
};

async function readReviewState(): Promise<ReviewState> {
  try {
    const raw = await fs.readFile(REVIEW_STATE_PATH, "utf-8");
    const j = JSON.parse(raw);
    return { rejected: Array.isArray(j.rejected) ? j.rejected : [] };
  } catch {
    return { rejected: [] };
  }
}

async function writeReviewState(state: ReviewState): Promise<void> {
  await fs.writeFile(REVIEW_STATE_PATH, JSON.stringify(state, null, 2));
}

function assertDev() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Admin actions are disabled in production.");
  }
}

export type AdminClue = {
  id: number;
  category: string;
  categoryStyle: string | null;
  clue: string;
  answer: string;
  value: number | null;
  round: "single" | "final";
  difficultyProfile: string | null;
};

export type AdminCategory = {
  /** Display name (the `category` column on clues). */
  name: string;
  /** Bucket the tree groups by (Wordplay/Trivia/Themed/etc — falls back to "Uncategorized"). */
  style: string;
  clues: AdminClue[];
  /** Dates this category has been booked on (any clue from it appears in daily_boards.clue_ids). */
  usedOn: string[];
};

export type AdminCatalog = {
  categoriesByStyle: Record<string, AdminCategory[]>;
  finalClues: AdminClue[];
  /** Past + future staged boards, keyed by date. */
  staged: Record<string, StagedBoard>;
  today: string;
};

export type StagedBoard = {
  date: string;
  categories: string[];
  clueIds: number[];
  finalClueId: number;
  dailyDoubleClueId: number | null;
};

export async function adminLoadCatalogAction(): Promise<AdminCatalog> {
  assertDev();
  const supabase = getSupabaseAdmin();

  // Paginate — Supabase default cap of 1000 rows per select would
  // silently truncate the catalog and make complete categories look
  // incomplete (missing values).
  type ClueRow = {
    id: number;
    category: string;
    category_style: string | null;
    clue: string;
    answer: string;
    value: number | null;
    round: "single" | "final";
    difficulty_profile: string | null;
  };
  const clueRows: ClueRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("clues")
      .select("id, category, category_style, clue, answer, value, round, difficulty_profile")
      .order("category", { ascending: true })
      .order("value", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Loading clues: ${error.message}`);
    if (!data || data.length === 0) break;
    clueRows.push(...(data as ClueRow[]));
    if (data.length < 1000) break;
  }

  const { data: boardRows, error: boardErr } = await supabase
    .from("daily_boards")
    .select("date, categories, clue_ids, final_clue_id, daily_double_clue_id");
  if (boardErr) throw new Error(`Loading daily_boards: ${boardErr.message}`);

  const staged: Record<string, StagedBoard> = {};
  const clueIdToDates = new Map<number, string[]>();
  for (const row of boardRows ?? []) {
    staged[row.date] = {
      date: row.date,
      categories: row.categories,
      clueIds: row.clue_ids,
      finalClueId: row.final_clue_id,
      dailyDoubleClueId: row.daily_double_clue_id ?? null,
    };
    for (const id of row.clue_ids) {
      const arr = clueIdToDates.get(id) ?? [];
      arr.push(row.date);
      clueIdToDates.set(id, arr);
    }
  }

  const byCategory = new Map<string, AdminCategory>();
  const finalClues: AdminClue[] = [];
  for (const row of clueRows ?? []) {
    const c: AdminClue = {
      id: row.id,
      category: row.category,
      categoryStyle: row.category_style ?? null,
      clue: row.clue,
      answer: row.answer,
      value: row.value,
      round: row.round,
      difficultyProfile: row.difficulty_profile ?? null,
    };
    if (row.round === "final") {
      finalClues.push(c);
      continue;
    }
    const cat = byCategory.get(row.category);
    const datesForThis = clueIdToDates.get(row.id) ?? [];
    if (cat) {
      cat.clues.push(c);
      for (const d of datesForThis) {
        if (!cat.usedOn.includes(d)) cat.usedOn.push(d);
      }
    } else {
      byCategory.set(row.category, {
        name: row.category,
        style: row.category_style ?? "Uncategorized",
        clues: [c],
        usedOn: [...datesForThis],
      });
    }
  }

  // Drop incomplete categories (must have all 5 standard values).
  const STD = [200, 400, 600, 800, 1000];
  const categories: AdminCategory[] = [];
  for (const cat of byCategory.values()) {
    const values = new Set(cat.clues.map((c) => c.value));
    if (STD.every((v) => values.has(v))) {
      cat.clues.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
      categories.push(cat);
    }
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));

  const categoriesByStyle: Record<string, AdminCategory[]> = {};
  for (const c of categories) {
    (categoriesByStyle[c.style] ||= []).push(c);
  }

  return {
    categoriesByStyle,
    finalClues: finalClues.sort((a, b) => a.category.localeCompare(b.category)),
    staged,
    today: todayDateString(),
  };
}

/**
 * Upsert a daily_boards row. Refuses to write to a date <= today (past
 * boards are frozen; today is locked once players have started).
 */
export async function adminSaveBoardAction(args: {
  date: string;
  categories: string[];
  clueIds: number[];
  finalClueId: number;
  dailyDoubleClueId: number | null;
}) {
  assertDev();
  const today = todayDateString();
  if (args.date <= today) {
    return {
      ok: false as const,
      error: `Refusing to write to ${args.date} (today or past). Pick a future date.`,
    };
  }
  if (args.categories.length !== 6 || args.clueIds.length !== 30) {
    return { ok: false as const, error: "Need exactly 6 categories and 30 clues." };
  }

  const supabase = getSupabaseAdmin();
  const seed = parseInt(args.date.replaceAll("-", ""), 10);
  const { error } = await supabase
    .from("daily_boards")
    .upsert(
      {
        date: args.date,
        categories: args.categories,
        clue_ids: args.clueIds,
        final_clue_id: args.finalClueId,
        daily_double_clue_id: args.dailyDoubleClueId,
        seed,
      },
      { onConflict: "date" },
    );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function adminDeleteBoardAction(date: string) {
  assertDev();
  const today = todayDateString();
  if (date <= today) {
    return { ok: false as const, error: `Refusing to delete ${date} (today or past).` };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("daily_boards").delete().eq("date", date);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function adminUpdateClueAction(args: {
  id: number;
  clue?: string;
  answer?: string;
}) {
  assertDev();
  if (args.clue === undefined && args.answer === undefined) {
    return { ok: false as const, error: "Nothing to update." };
  }
  const supabase = getSupabaseAdmin();
  const patch: Record<string, string> = {};
  if (args.clue !== undefined) patch.clue = args.clue;
  if (args.answer !== undefined) patch.answer = args.answer;
  const { error } = await supabase.from("clues").update(patch).eq("id", args.id);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/**
 * Move a clue to a new dollar value. To keep every category covering all
 * 5 standard values, whichever clue currently holds the target value
 * swaps down to the moving clue's old value.
 */
export async function adminSwapClueValueAction(args: {
  clueId: number;
  newValue: 200 | 400 | 600 | 800 | 1000;
}) {
  assertDev();
  const supabase = getSupabaseAdmin();
  const { data: source, error: srcErr } = await supabase
    .from("clues")
    .select("id, category, value")
    .eq("id", args.clueId)
    .maybeSingle();
  if (srcErr || !source) return { ok: false as const, error: srcErr?.message ?? "Clue not found." };
  if (source.value === args.newValue) return { ok: true as const, swappedId: null };

  const { data: target, error: tgtErr } = await supabase
    .from("clues")
    .select("id, value")
    .eq("category", source.category)
    .eq("value", args.newValue)
    .maybeSingle();
  if (tgtErr) return { ok: false as const, error: tgtErr.message };

  if (!target) {
    // No conflict — just update the source. (Unusual: shouldn't happen
    // for complete categories, but harmless.)
    const { error } = await supabase
      .from("clues")
      .update({ value: args.newValue })
      .eq("id", args.clueId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, swappedId: null };
  }

  // Two-step swap. Use a temp-value sentinel that satisfies any value
  // constraints (we pick something outside 200..1000). NOTE: if the
  // `clues.value` column has a CHECK constraint, this may fail; in that
  // case the swap needs to happen via a transaction or RPC. We try -1
  // first; fall back to two updates with a hop through a different
  // category's slot is overkill, so trust the column allows arbitrary
  // ints (typical).
  const TEMP = -1;
  const tx = await supabase
    .from("clues")
    .update({ value: TEMP })
    .eq("id", args.clueId);
  if (tx.error) return { ok: false as const, error: tx.error.message };
  const ty = await supabase
    .from("clues")
    .update({ value: source.value })
    .eq("id", target.id);
  if (ty.error) return { ok: false as const, error: ty.error.message };
  const tz = await supabase
    .from("clues")
    .update({ value: args.newValue })
    .eq("id", args.clueId);
  if (tz.error) return { ok: false as const, error: tz.error.message };
  return { ok: true as const, swappedId: target.id, swappedNewValue: source.value };
}

/**
 * Rename a category. Updates every clue with the old `category` name to
 * the new one. Refuses if newName collides with another existing
 * category (would merge silently otherwise).
 */
export async function adminRenameCategoryAction(args: {
  oldName: string;
  newName: string;
}) {
  assertDev();
  const trimmed = args.newName.trim();
  if (!trimmed) return { ok: false as const, error: "Name can't be empty." };
  if (trimmed === args.oldName) return { ok: true as const };

  const supabase = getSupabaseAdmin();
  const { data: collision } = await supabase
    .from("clues")
    .select("id")
    .eq("category", trimmed)
    .limit(1);
  if (collision && collision.length > 0) {
    return { ok: false as const, error: "Another category already uses that name." };
  }
  const { error } = await supabase
    .from("clues")
    .update({ category: trimmed })
    .eq("category", args.oldName);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

// ============================================================
// Review queue — read JSON files in data/generated, surface
// categories not yet imported, allow accept/reject from the UI.
// ============================================================

export type QueueClue = {
  value: number;
  clue: string;
  answer: string;
};

export type QueueCategory = {
  /** Stable key: "<batchFile>::<categoryTitle>". */
  key: string;
  batchFile: string;
  /** Subject inferred from the filename (history/music/sports/...). Used as category_style on import. */
  subject: string;
  title: string;
  theme: string | null;
  topic: string | null;
  difficultyProfile: string | null;
  clues: QueueClue[];
};

export type ReviewQueue = {
  /** Grouped by subject for the tree view. */
  bySubject: Record<string, QueueCategory[]>;
  totalPending: number;
};

const SUBJECT_RE = /-([a-z_]+)\.(?:approved\.)?json$/;

export async function adminLoadReviewQueueAction(): Promise<ReviewQueue> {
  assertDev();

  // Pull the set of categories already in the DB so we don't surface duplicates.
  const supabase = getSupabaseAdmin();
  const { data: dbRows, error } = await supabase
    .from("clues")
    .select("category, round")
    .eq("round", "single");
  if (error) throw new Error(`Loading clues: ${error.message}`);
  const dbCats = new Set((dbRows ?? []).map((r) => r.category));

  const state = await readReviewState();
  const rejected = new Set(state.rejected);

  const files = (await fs.readdir(GEN_DIR)).filter(
    (f) => f.endsWith(".json") && !f.startsWith("."),
  );

  const bySubject: Record<string, QueueCategory[]> = {};
  let total = 0;
  for (const file of files) {
    const m = file.match(SUBJECT_RE);
    const subject = m ? m[1] : "misc";
    let json: unknown;
    try {
      json = JSON.parse(await fs.readFile(path.join(GEN_DIR, file), "utf-8"));
    } catch {
      continue;
    }
    const cats: unknown =
      Array.isArray(json) ? json
      : (json as Record<string, unknown>).categories ?? [];
    if (!Array.isArray(cats)) continue;

    let idx = -1;
    for (const c of cats as Array<Record<string, unknown>>) {
      idx++;
      const title = (c.title ?? c.category ?? c.name) as string | undefined;
      if (!title) continue;
      if (dbCats.has(title)) continue;
      const key = `${file}#${idx}::${title}`;
      if (rejected.has(key)) continue;
      const rawClues = Array.isArray(c.clues) ? (c.clues as Array<Record<string, unknown>>) : [];
      const clues: QueueClue[] = rawClues
        .map((cl) => ({
          value: Number(cl.value),
          clue: String(cl.clue ?? ""),
          answer: String(cl.answer ?? ""),
        }))
        .filter((cl) => Number.isFinite(cl.value) && cl.clue && cl.answer);
      if (clues.length !== 5) continue; // skip malformed
      const STD = [200, 400, 600, 800, 1000];
      const values = new Set(clues.map((cl) => cl.value));
      if (!STD.every((v) => values.has(v))) continue;
      (bySubject[subject] ||= []).push({
        key,
        batchFile: file,
        subject,
        title,
        theme: (c.theme as string | undefined) ?? null,
        topic: (c.topic as string | undefined) ?? null,
        difficultyProfile: (c.difficulty_profile as string | undefined) ?? null,
        clues: clues.sort((a, b) => a.value - b.value),
      });
      total++;
    }
  }
  // Sort each subject by title for stable order.
  for (const subject of Object.keys(bySubject)) {
    bySubject[subject].sort((a, b) => a.title.localeCompare(b.title));
  }
  return { bySubject, totalPending: total };
}

export async function adminAcceptCategoryAction(args: {
  key: string;
  subject: string;
  title: string;
  theme: string | null;
  topic: string | null;
  difficultyProfile: string | null;
  clues: QueueClue[];
}) {
  assertDev();
  if (args.clues.length !== 5) {
    return { ok: false as const, error: "Need 5 clues." };
  }
  const supabase = getSupabaseAdmin();
  // Defensive: ensure not already in DB
  const { data: existing } = await supabase
    .from("clues")
    .select("id")
    .eq("category", args.title)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false as const, error: "Category already exists in DB." };
  }
  const rows = args.clues.map((cl) => ({
    category: args.title,
    category_tag: args.theme,
    clue: cl.clue,
    answer: cl.answer,
    value: cl.value,
    round: "single" as const,
    topic: args.topic,
    category_style: args.subject, // override existing "knowledge" with the filename subject
    difficulty_profile: args.difficultyProfile,
  }));
  const { error } = await supabase.from("clues").insert(rows);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function adminRejectCategoryAction(key: string) {
  assertDev();
  const state = await readReviewState();
  if (!state.rejected.includes(key)) {
    state.rejected.push(key);
    await writeReviewState(state);
  }
  return { ok: true as const };
}
