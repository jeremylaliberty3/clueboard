/**
 * Stage 4: Push an approved batch into Supabase.
 *
 * Inputs:   clueboard/data/generated/<batch_id>.approved.json
 *           NEXT_PUBLIC_SUPABASE_URL
 *           SUPABASE_SERVICE_ROLE_KEY      (service role bypasses RLS for inserts)
 *
 * Run with:  cd clueboard && npm run import-clues <batch_id>
 *            (omit batch_id to import the most recent approved file)
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = { value: number | null; clue: string; answer: string; source_id: string };
type Category = { title: string; theme: string; clues: Clue[] };
type Final = { title: string; clue: string; answer: string; source_id: string };
type Approved = {
  batch_id: string;
  generated_at: string;
  model: string;
  categories: Category[];
  finals: Final[];
  approved_at: string;
};

type ClueRow = {
  category: string;
  category_tag: string | null;
  clue: string;
  answer: string;
  value: number | null;
  round: "single" | "final";
};

async function pickBatch(): Promise<string> {
  const arg = process.argv[2];
  if (arg && existsSync(join(GEN_DIR, `${arg}.approved.json`))) return arg;
  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".approved.json"))
    .sort();
  if (files.length === 0) {
    console.error("No approved batches found. Run `npm run review` first.");
    process.exit(1);
  }
  return files[files.length - 1].replace(/\.approved\.json$/, "");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }

  const batchId = await pickBatch();
  const path = join(GEN_DIR, `${batchId}.approved.json`);
  const batch = JSON.parse(await readFile(path, "utf8")) as Approved;
  console.log(`Importing batch ${batchId}: ${batch.categories.length} categories (${batch.categories.reduce((n, c) => n + c.clues.length, 0)} clues), ${batch.finals.length} finals.`);

  const rows: ClueRow[] = [];
  for (const cat of batch.categories) {
    for (const c of cat.clues) {
      rows.push({
        category: cat.title,
        category_tag: cat.theme,
        clue: c.clue,
        answer: c.answer,
        value: c.value,
        round: "single",
      });
    }
  }
  for (const f of batch.finals) {
    rows.push({
      category: f.title,
      category_tag: null,
      clue: f.clue,
      answer: f.answer,
      value: null,
      round: "final",
    });
  }

  const client = createClient(url, key, { auth: { persistSession: false } });

  // Insert in chunks of 500 to stay well under any payload limits.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error, data } = await client.from("clues").insert(chunk).select("id");
    if (error) {
      console.error(`Insert failed at offset ${i}:`, error);
      process.exit(1);
    }
    inserted += data?.length ?? 0;
    process.stdout.write(`\r  inserted ${inserted}/${rows.length} `);
  }
  process.stdout.write("\n");
  console.log(`\n✓ Imported ${inserted} clues from batch ${batchId}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
