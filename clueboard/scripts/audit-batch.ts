/**
 * Quick programmatic audit of a generated batch — flags likely issues
 * without making decisions. Read-only; never modifies files.
 *
 * Run with:  cd clueboard && npx tsx scripts/audit-batch.ts <batch_id>
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = { value: number | null; clue: string; answer: string; source_id: string };
type Category = { title: string; theme: string; clues: Clue[] };
type Final = { title: string; clue: string; answer: string; source_id: string };
type Batch = { batch_id: string; categories: Category[]; finals: Final[] };

async function pickBatchId(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"))
    .sort();
  return files[files.length - 1].replace(/\.json$/, "");
}

function flagsForClue(clue: Clue): string[] {
  const flags: string[] = [];
  const a = clue.answer.toLowerCase();
  const c = clue.clue.toLowerCase();

  if (a.length > 40) flags.push("answer-long");
  if (clue.answer.split(" ").length > 4) flags.push("answer-verbose");
  if (clue.clue.length < 40) flags.push("clue-short");
  if (clue.clue.length > 280) flags.push("clue-long");
  if (a.length > 3 && c.includes(a)) flags.push("ANSWER-LEAK");
  if (/\b(this is|here is|name the|what is)\b/i.test(clue.clue)) flags.push("instruction-style");
  return flags;
}

async function main() {
  const id = await pickBatchId();
  const batch = JSON.parse(await readFile(join(GEN_DIR, `${id}.json`), "utf8")) as Batch;
  console.log(`Auditing batch ${id}: ${batch.categories.length} categories, ${batch.finals.length} finals.\n`);

  // Category title duplicates
  const titles = batch.categories.map((c) => c.title);
  const dupTitles = titles.filter((t, i) => titles.indexOf(t) !== i);
  if (dupTitles.length) console.log(`DUPLICATE TITLES: ${[...new Set(dupTitles)].join(", ")}`);

  // Source-fact reuse across categories
  const factUse = new Map<string, string[]>();
  for (const cat of batch.categories) {
    for (const cl of cat.clues) {
      (factUse.get(cl.source_id) || factUse.set(cl.source_id, []).get(cl.source_id))!.push(cat.title);
    }
  }
  const reused = Array.from(factUse.entries()).filter(([, v]) => v.length > 1);
  if (reused.length) {
    console.log(`\nSOURCE-FACT REUSED ACROSS CATEGORIES (${reused.length}):`);
    for (const [id, cats] of reused.slice(0, 10)) {
      console.log(`  ${id} → ${cats.join(" | ")}`);
    }
  }

  console.log("\n──── Per-category flags ────");
  let issueCount = 0;
  for (let i = 0; i < batch.categories.length; i++) {
    const cat = batch.categories[i];
    const cflags: string[] = [];
    for (const cl of cat.clues) {
      const f = flagsForClue(cl);
      if (f.length) cflags.push(`$${cl.value}:[${f.join(",")}]`);
    }
    if (cflags.length === 0) continue;
    console.log(`  #${i + 1} ${cat.title} — ${cflags.join("  ")}`);
    issueCount++;
  }
  console.log(`\n${issueCount}/${batch.categories.length} categories flagged.`);

  console.log("\n──── Per-final flags ────");
  let finalIssues = 0;
  for (let i = 0; i < batch.finals.length; i++) {
    const f = batch.finals[i];
    const flags = flagsForClue({ value: null, clue: f.clue, answer: f.answer, source_id: f.source_id });
    if (flags.length) {
      console.log(`  #${i + 1} ${f.title} — [${flags.join(",")}]`);
      finalIssues++;
    }
  }
  console.log(`${finalIssues}/${batch.finals.length} finals flagged.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
