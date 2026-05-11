/**
 * Hand-staged board planner.
 *
 *   1. Reads category data from data/generated/*.json by title.
 *   2. Picks finals from those batches by topic preference per day.
 *   3. Connects with the service-role key, wipes daily_boards + clues,
 *      then inserts only the staged categories + finals.
 *   4. For each day, writes a daily_boards row with the chosen
 *      categories, Daily Double location, and final clue.
 *
 * Pre-requisite: the lazy-persist-schema.sql migration must have been
 * applied (adds daily_double_clue_id + persist_daily_board RPC).
 *
 * Run with:  cd clueboard && npm run stage-boards
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = {
  value: number | null;
  clue: string;
  answer: string;
  source_id: string;
};
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
// Board plan
// ============================================================

const PLAN: {
  date: string;
  /** Category titles in display order. */
  categories: string[];
  /** Daily Double location: which category and which dollar value. */
  dd: { title: string; value: number };
  /** Topic-disallow list for the final clue (the board's topics). */
  finalAvoidTopics: string[];
}[] = [
  // Day 1 — TODAY. Reinstates the launch-state board.
  {
    date: "2026-05-11",
    categories: [
      "SPORTS TERMS & DEFINITIONS",
      "ANSWERS ENDING IN -ISM",
      "FAMOUS FILM QUOTES",
      "WHICH BOOK CONTAINS THIS CHARACTER?",
      "SONGS THAT START WITH...",
      "ART TERMINOLOGY",
    ],
    dd: { title: "ANSWERS ENDING IN -ISM", value: 400 },
    finalAvoidTopics: ["SPORTS", "WORDPLAY", "POP_CULTURE", "LITERATURE", "MUSIC", "ARTS"],
  },
  // Day 2 — uses #19 + #21 as the swap-ins for the previous #4/#6 conflicts.
  {
    date: "2026-05-12",
    categories: [
      "FAMOUS PAINTERS",
      "ASSASSINATIONS & THEIR AFTERMATH",
      "BEST PICTURE WINNERS",
      "THE HUMAN BODY",
      "SPORT PLAYED AT THE...",
      "ANCIENT ROME",
    ],
    dd: { title: "FAMOUS PAINTERS", value: 1000 },
    finalAvoidTopics: ["ARTS", "HISTORY", "POP_CULTURE", "SCIENCE", "SPORTS"],
  },
  // Day 3 — uses #23 as the swap-in for the previous #9 conflict.
  {
    date: "2026-05-13",
    categories: [
      "FIFA WORLD CUP WINNERS",
      "YOUNG ONES",
      "BAND MEMBERS",
      "U.S. PRESIDENTS",
      "CAPITAL CITIES",
      "RIVERS & MOUNTAINS",
    ],
    dd: { title: "CAPITAL CITIES", value: 600 },
    finalAvoidTopics: ["SPORTS", "SCIENCE", "MUSIC", "HISTORY", "GEOGRAPHY"],
  },
  // Day 4 — unchanged from the original plan (no conflicts with today).
  {
    date: "2026-05-14",
    categories: [
      "COUNTRY CODE TOP-LEVEL DOMAINS",
      "WORLD WAR II FACTS",
      "IN WHICH BOOK DOES THIS CHARACTER APPEAR?",
      "WHAT THE -OLOGY?",
      "CITY OF CHAMPIONS",
      "WHAT DOES IT STAND FOR?",
    ],
    dd: { title: "CITY OF CHAMPIONS", value: 800 },
    finalAvoidTopics: ["GEOGRAPHY", "HISTORY", "LITERATURE", "SCIENCE", "SPORTS"],
  },
];

// ============================================================
// Lookup categories + finals from disk
// ============================================================

async function loadBank(): Promise<{ catsByTitle: Map<string, Category>; finalsByTopic: Map<string, Final[]> }> {
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
        // First match wins. Categories with the same title across batches
        // typically have different content; we use the title the user
        // selected and trust that the first occurrence is the one they
        // were looking at in `list-clean` output.
        if (!catsByTitle.has(c.title)) catsByTitle.set(c.title, c);
      }
      for (const f of batch.finals ?? []) {
        if (seenFinalIds.has(f.source_id)) continue;
        seenFinalIds.add(f.source_id);
        const t = f.topic ?? "MISC";
        (finalsByTopic.get(t) ?? finalsByTopic.set(t, []).get(t))!.push(f);
      }
    } catch { /* skip */ }
  }
  return { catsByTitle, finalsByTopic };
}

function pickFinal(
  finalsByTopic: Map<string, Final[]>,
  usedFinalIds: Set<string>,
  avoidTopics: string[],
): Final {
  // Prefer finals from topics NOT on the board, and not already used.
  const ordered = Array.from(finalsByTopic.entries())
    .sort(([a], [b]) => {
      const aAvoid = avoidTopics.includes(a) ? 1 : 0;
      const bAvoid = avoidTopics.includes(b) ? 1 : 0;
      return aAvoid - bAvoid;
    });
  for (const [, list] of ordered) {
    for (const f of list) {
      if (!usedFinalIds.has(f.source_id)) {
        usedFinalIds.add(f.source_id);
        return f;
      }
    }
  }
  throw new Error("No unused finals left in the generated pool.");
}

// ============================================================
// Main
// ============================================================

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const { catsByTitle, finalsByTopic } = await loadBank();
  console.log(`Loaded ${catsByTitle.size} unique titles and ${[...finalsByTopic.values()].flat().length} finals from data/generated/.`);

  // Validate all category titles exist
  const missing: string[] = [];
  for (const day of PLAN) {
    for (const title of day.categories) {
      if (!catsByTitle.has(title)) missing.push(`${day.date}: "${title}"`);
    }
  }
  if (missing.length > 0) {
    console.error("Couldn't find these category titles in data/generated/*.json:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  // Pick a final per day
  const usedFinalIds = new Set<string>();
  const finalsPerDay = PLAN.map((day) => pickFinal(finalsByTopic, usedFinalIds, day.finalAvoidTopics));
  console.log("\nFinals chosen:");
  for (let i = 0; i < PLAN.length; i++) {
    const f = finalsPerDay[i];
    console.log(`  ${PLAN[i].date}: [${f.topic}] ${f.title} → ${f.answer}`);
  }

  const client = createClient(url, key, { auth: { persistSession: false } });

  // ── Wipe daily_boards + clues ──
  console.log("\nWiping daily_boards and clues…");
  {
    const { error: e1 } = await client.from("daily_boards").delete().not("date", "is", null);
    if (e1) { console.error("daily_boards wipe failed:", e1); process.exit(1); }
    const { error: e2 } = await client.from("clues").delete().not("id", "is", null);
    if (e2) { console.error("clues wipe failed:", e2); process.exit(1); }
  }

  // ── Insert all category clues ──
  // We collect by (day, title, value) → new clue.id so we can build the
  // daily_boards rows below.
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
  // Track ordering: index of (title, value) → catRows index (for ID lookup post-insert).
  const catKey = (title: string, value: number) => `${title}|${value}`;
  const catKeyOrder: string[] = [];
  for (const day of PLAN) {
    for (const title of day.categories) {
      const c = catsByTitle.get(title)!;
      // Insert each clue once per (day, title) — but since we wipe and the
      // same title can appear on multiple days (the user said small
      // repeats are okay), we'll insert each appearance.
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
        catKeyOrder.push(catKey(`${day.date}|${title}`, v));
      }
    }
  }

  const finalRows: Row[] = finalsPerDay.map((f) => ({
    category: f.title,
    category_tag: null,
    clue: f.clue,
    answer: f.answer,
    value: null,
    round: "final",
    topic: f.topic ?? null,
    category_style: null,
    difficulty_profile: null,
  }));

  console.log(`\nInserting ${catRows.length} category clues + ${finalRows.length} finals…`);
  const { data: insCats, error: ec } = await client.from("clues").insert(catRows).select("id");
  if (ec || !insCats) { console.error("Category insert failed:", ec); process.exit(1); }
  const { data: insFinals, error: ef } = await client.from("clues").insert(finalRows).select("id");
  if (ef || !insFinals) { console.error("Final insert failed:", ef); process.exit(1); }

  // Build (day|title|value) → clue.id map.
  const idByKey = new Map<string, number>();
  for (let i = 0; i < insCats.length; i++) idByKey.set(catKeyOrder[i], insCats[i].id);

  // ── Write daily_boards row per day ──
  console.log("\nWriting daily_boards rows:");
  for (let i = 0; i < PLAN.length; i++) {
    const day = PLAN[i];
    const finalRow = insFinals[i];

    const clueIds: number[] = [];
    for (const title of day.categories) {
      for (const v of [200, 400, 600, 800, 1000]) {
        const id = idByKey.get(catKey(`${day.date}|${title}`, v));
        if (!id) {
          console.error(`Missing clue for ${day.date} / ${title} / $${v}`);
          process.exit(1);
        }
        clueIds.push(id);
      }
    }

    const ddId = idByKey.get(catKey(`${day.date}|${day.dd.title}`, day.dd.value));
    if (!ddId) {
      console.error(`Couldn't resolve DD on ${day.date}: ${day.dd.title} $${day.dd.value}`);
      process.exit(1);
    }

    const { error } = await client.rpc("persist_daily_board", {
      p_date: day.date,
      p_categories: day.categories,
      p_clue_ids: clueIds,
      p_final_clue_id: finalRow.id,
      p_daily_double_clue_id: ddId,
    });
    if (error) {
      console.error(`persist_daily_board failed for ${day.date}:`, error);
      process.exit(1);
    }
    console.log(`  ${day.date}: ${day.categories.length} cats · DD on ${day.dd.title} $${day.dd.value} · final ${finalsPerDay[i].title}`);
  }

  console.log("\n✓ Done. The next 4 days are staged.");
  console.log("  Each will go live automatically at 00:00 US/Eastern on its date.");
  console.log("  The lazy-persist getDailyBoard() reads these rows first; no algorithm fallback needed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
