/**
 * Additive staging for today (or any date) without wiping existing
 * content. Unlike stage-boards which fully resets, this:
 *   - Adds new category + final clue rows to the clues table
 *   - Deletes only the daily_boards row for the target date
 *   - Inserts a new daily_boards row for that date
 *
 * The 4-day future plan from stage-boards is untouched.
 *
 * Run with:  cd clueboard && npm run stage-today
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = { value: number | null; clue: string; answer: string; source_id: string };
type Category = {
  title: string;
  theme: string;
  topic?: string;
  category_style?: string;
  difficulty_profile?: string;
  clues: Clue[];
};
type Final = {
  title: string;
  topic?: string;
  clue: string;
  answer: string;
  source_id: string;
};

// ============================================================
// Today's plan
// ============================================================
const PLAN = {
  date: "2026-05-11",
  categories: [
    "SHAKESPEARE",
    "FLAGS OF THE WORLD",
    "ATOMIC STRUCTURE",
    "ACADEMY AWARD: BEST SUPPORTING ACTRESS",
    "COVER VERSIONS",
    "ANSWERS ENDING IN -ETTE",
  ],
  dd: { title: "SHAKESPEARE", value: 800 },
  // Final clue should come from a topic NOT on the board.
  finalAvoidTopics: ["LITERATURE", "GEOGRAPHY", "SCIENCE", "POP_CULTURE", "MUSIC", "WORDPLAY"],
};

async function loadBank() {
  const catsByTitle = new Map<string, Category>();
  const finalsByTopic = new Map<string, Final[]>();
  const seenFinalIds = new Set<string>();
  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"));
  for (const f of files) {
    try {
      const batch = JSON.parse(await readFile(join(GEN_DIR, f), "utf8")) as {
        categories?: Category[];
        finals?: Final[];
      };
      for (const c of batch.categories ?? []) {
        if (!catsByTitle.has(c.title)) catsByTitle.set(c.title, c);
      }
      for (const fn of batch.finals ?? []) {
        if (seenFinalIds.has(fn.source_id)) continue;
        seenFinalIds.add(fn.source_id);
        const t = fn.topic ?? "MISC";
        (finalsByTopic.get(t) ?? finalsByTopic.set(t, []).get(t))!.push(fn);
      }
    } catch { /* skip */ }
  }
  return { catsByTitle, finalsByTopic };
}

function pickFinal(finalsByTopic: Map<string, Final[]>, avoidTopics: string[]): Final {
  const ordered = Array.from(finalsByTopic.entries())
    .sort(([a], [b]) => (avoidTopics.includes(a) ? 1 : 0) - (avoidTopics.includes(b) ? 1 : 0));
  for (const [, list] of ordered) {
    if (list.length > 0) return list[0];
  }
  throw new Error("No finals available in the pool.");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const { catsByTitle, finalsByTopic } = await loadBank();
  console.log(`Loaded ${catsByTitle.size} categories from data/generated/.`);

  // Validate titles
  const missing = PLAN.categories.filter((t) => !catsByTitle.has(t));
  if (missing.length > 0) {
    console.error(`Couldn't find these titles in data/generated/:`);
    for (const t of missing) console.error(`  - ${t}`);
    process.exit(1);
  }

  const finalRow = pickFinal(finalsByTopic, PLAN.finalAvoidTopics);
  console.log(`Final picked: [${finalRow.topic}] ${finalRow.title} → ${finalRow.answer}`);

  const client = createClient(url, key, { auth: { persistSession: false } });

  // ── Insert new category clues + final ──
  type Row = {
    category: string;
    category_tag: string | null;
    clue: string;
    answer: string;
    value: number | null;
    round: "single" | "final";
    topic: string | null;
    category_style: string | null;
    difficulty_profile: string | null;
  };

  const catRows: Row[] = [];
  const catKeyOrder: string[] = []; // (title|value) keys in insert order
  for (const title of PLAN.categories) {
    const c = catsByTitle.get(title)!;
    for (const cl of c.clues) {
      const v = cl.value ?? 0;
      catRows.push({
        category: c.title,
        category_tag: c.theme,
        clue: cl.clue,
        answer: cl.answer,
        value: v,
        round: "single",
        topic: c.topic ?? null,
        category_style: c.category_style ?? null,
        difficulty_profile: c.difficulty_profile ?? null,
      });
      catKeyOrder.push(`${title}|${v}`);
    }
  }

  const finalInsertRow: Row = {
    category: finalRow.title,
    category_tag: null,
    clue: finalRow.clue,
    answer: finalRow.answer,
    value: null,
    round: "final",
    topic: finalRow.topic ?? null,
    category_style: null,
    difficulty_profile: null,
  };

  console.log(`\nInserting ${catRows.length} category clues + 1 final…`);
  const { data: insCats, error: ec } = await client.from("clues").insert(catRows).select("id");
  if (ec || !insCats) { console.error("Category insert failed:", ec); process.exit(1); }
  const { data: insFinal, error: ef } = await client.from("clues").insert(finalInsertRow).select("id").single();
  if (ef || !insFinal) { console.error("Final insert failed:", ef); process.exit(1); }

  const idByKey = new Map<string, number>();
  for (let i = 0; i < insCats.length; i++) idByKey.set(catKeyOrder[i], insCats[i].id);

  // Build clue_ids array
  const clueIds: number[] = [];
  for (const title of PLAN.categories) {
    for (const v of [200, 400, 600, 800, 1000]) {
      const id = idByKey.get(`${title}|${v}`);
      if (!id) { console.error(`Missing clue for ${title} $${v}`); process.exit(1); }
      clueIds.push(id);
    }
  }
  const ddId = idByKey.get(`${PLAN.dd.title}|${PLAN.dd.value}`)!;

  // ── Wipe any existing daily_boards row for this date ──
  console.log(`\nClearing any existing daily_boards row for ${PLAN.date}…`);
  const { error: edel } = await client.from("daily_boards").delete().eq("date", PLAN.date);
  if (edel) { console.error("daily_boards delete failed:", edel); process.exit(1); }

  // ── Insert new daily_boards row via RPC ──
  const { error: erpc } = await client.rpc("persist_daily_board", {
    p_date: PLAN.date,
    p_categories: PLAN.categories,
    p_clue_ids: clueIds,
    p_final_clue_id: insFinal.id,
    p_daily_double_clue_id: ddId,
  });
  if (erpc) { console.error("persist_daily_board failed:", erpc); process.exit(1); }

  console.log(`\n✓ Staged ${PLAN.date}:`);
  console.log(`  Categories: ${PLAN.categories.join(", ")}`);
  console.log(`  Daily Double: ${PLAN.dd.title} $${PLAN.dd.value}`);
  console.log(`  Final Clue: ${finalRow.title} → ${finalRow.answer}`);
  console.log(`\nThe live site will pick this up within ~60s (cache TTL).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
