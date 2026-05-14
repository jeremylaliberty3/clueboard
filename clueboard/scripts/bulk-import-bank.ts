/**
 * Bulk-import every category in data/generated/*.json (NOT archive) into
 * the `clues` table, skipping anything whose category name already
 * exists in DB. Each category's clues get `category_style` set to the
 * subject inferred from the filename (history/music/sports/...), which
 * fixes the "everything is knowledge" problem in one pass.
 *
 * Run:
 *   cd clueboard && npx tsx --env-file=.env.local scripts/bulk-import-bank.ts --dry
 *   cd clueboard && npx tsx --env-file=.env.local scripts/bulk-import-bank.ts
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

type RawClue = { value: number; clue: string; answer: string };
type RawCategory = {
  title?: string;
  category?: string;
  name?: string;
  theme?: string | null;
  topic?: string | null;
  difficulty_profile?: string | null;
  clues: RawClue[];
};

const STD = [200, 400, 600, 800, 1000];
const SUBJECT_RE = /-([a-z_]+)\.(?:approved\.)?json$/;
const GEN_DIR = "data/generated";

async function main() {
  const dry = process.argv.includes("--dry");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  if (!url || !key) {
    console.error("Missing env vars.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Paginate — Supabase caps a single select at 1000 rows by default,
  // and silently truncating the existing-set check would cause a second
  // import run to duplicate every category whose id > 1000 (which is
  // exactly the bug that already shipped once).
  async function fetchAll<T extends Record<string, unknown>>(
    select: string,
    eq: { col: string; val: string },
  ): Promise<T[]> {
    let all: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("clues")
        .select(select)
        .eq(eq.col, eq.val)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all = all.concat(data as unknown as T[]);
      if (data.length < 1000) break;
    }
    return all;
  }

  const dbRows = await fetchAll<{ category: string }>(
    "id, category",
    { col: "round", val: "single" },
  );
  const dbCats = new Set(dbRows.map((r) => r.category));

  const dbFinalRows = await fetchAll<{ clue: string }>(
    "id, clue",
    { col: "round", val: "final" },
  );
  const dbFinalClueText = new Set(dbFinalRows.map((r) => r.clue));

  const files = fs.readdirSync(GEN_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("."),
  );

  // Collect candidates. Dedup by title — first occurrence wins.
  type Row = {
    category: string;
    category_tag: string | null;
    clue: string;
    answer: string;
    value: number;
    round: "single";
    topic: string | null;
    category_style: string;
    difficulty_profile: string | null;
  };
  const rows: Row[] = [];
  const seenTitles = new Set<string>();
  const perSubject: Record<string, number> = {};
  let skippedExisting = 0;
  let skippedDuplicate = 0;
  let skippedMalformed = 0;

  // Finals are tracked separately because they have a different shape.
  type FinalRow = {
    category: string;
    category_tag: null;
    clue: string;
    answer: string;
    value: null;
    round: "final";
    topic: string | null;
    category_style: null;
    difficulty_profile: null;
  };
  const finalRows: FinalRow[] = [];
  const seenFinalClues = new Set<string>();
  let finalsSkippedExisting = 0;
  let finalsSkippedDuplicate = 0;

  for (const file of files) {
    const m = file.match(SUBJECT_RE);
    const subject = m ? m[1] : "misc";
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(path.join(GEN_DIR, file), "utf-8"));
    } catch {
      continue;
    }
    const finals: unknown =
      (json as Record<string, unknown>).finals ?? [];
    if (Array.isArray(finals)) {
      for (const f of finals as Array<Record<string, unknown>>) {
        const title = (f.title ?? f.category ?? f.name) as string | undefined;
        const clue = f.clue as string | undefined;
        const answer = f.answer as string | undefined;
        if (!title || !clue || !answer) continue;
        if (dbFinalClueText.has(clue)) {
          finalsSkippedExisting++;
          continue;
        }
        if (seenFinalClues.has(clue)) {
          finalsSkippedDuplicate++;
          continue;
        }
        seenFinalClues.add(clue);
        finalRows.push({
          category: title,
          category_tag: null,
          clue,
          answer,
          value: null,
          round: "final",
          topic: (f.topic as string | undefined) ?? null,
          category_style: null,
          difficulty_profile: null,
        });
      }
    }

    const cats: unknown = Array.isArray(json)
      ? json
      : (json as Record<string, unknown>).categories ?? [];
    if (!Array.isArray(cats)) continue;

    for (const c of cats as RawCategory[]) {
      const title = c.title ?? c.category ?? c.name;
      if (!title) continue;
      if (dbCats.has(title)) {
        skippedExisting++;
        continue;
      }
      if (seenTitles.has(title)) {
        skippedDuplicate++;
        continue;
      }
      if (!Array.isArray(c.clues) || c.clues.length !== 5) {
        skippedMalformed++;
        continue;
      }
      const values = new Set(c.clues.map((cl) => Number(cl.value)));
      if (!STD.every((v) => values.has(v))) {
        skippedMalformed++;
        continue;
      }
      seenTitles.add(title);
      perSubject[subject] = (perSubject[subject] ?? 0) + 1;
      for (const cl of c.clues) {
        rows.push({
          category: title,
          category_tag: c.theme ?? null,
          clue: String(cl.clue),
          answer: String(cl.answer),
          value: Number(cl.value),
          round: "single",
          topic: c.topic ?? null,
          category_style: subject,
          difficulty_profile: c.difficulty_profile ?? null,
        });
      }
    }
  }

  console.log("\nImport plan:");
  console.log(`  Categories already in DB:  ${dbCats.size}`);
  console.log(`  New categories to insert:  ${seenTitles.size}`);
  console.log(`  Total category clues:      ${rows.length}`);
  console.log(`  Finals already in DB:      ${dbFinalClueText.size}`);
  console.log(`  New finals to insert:      ${finalRows.length}`);
  console.log(`  Skipped cats (in DB):      ${skippedExisting}`);
  console.log(`  Skipped cats (cross-dup):  ${skippedDuplicate}`);
  console.log(`  Skipped cats (malformed):  ${skippedMalformed}`);
  console.log(`  Skipped finals (in DB):    ${finalsSkippedExisting}`);
  console.log(`  Skipped finals (dup):      ${finalsSkippedDuplicate}`);
  console.log("\nBy subject:");
  for (const [s, n] of Object.entries(perSubject).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n}`);
  }

  if (dry) {
    console.log("\nDry-run only — no DB writes. Re-run without --dry to insert.");
    return;
  }

  const allRows = [...rows, ...finalRows];
  if (allRows.length === 0) {
    console.log("\nNothing to insert.");
    return;
  }

  console.log("\nInserting…");
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const { error: insertErr, data } = await supabase
      .from("clues")
      .insert(chunk)
      .select("id");
    if (insertErr) {
      console.error(`\nInsert failed at offset ${i}:`, insertErr);
      process.exit(1);
    }
    inserted += data?.length ?? 0;
    process.stdout.write(`\r  inserted ${inserted}/${allRows.length} `);
  }
  process.stdout.write("\n");
  console.log(`\n✓ Imported ${rows.length} category clues across ${seenTitles.size} categories.`);
  console.log(`✓ Imported ${finalRows.length} final clues.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
