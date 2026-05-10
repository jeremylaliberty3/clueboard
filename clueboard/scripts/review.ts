/**
 * Stage 3: Walk through a generated batch, approve or reject categories
 * and finals, write the result alongside as `<batch_id>.approved.json`.
 *
 * Run with:  cd clueboard && npm run review <batch_id>
 *            (omit batch_id to pick the most recent)
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = { value: number | null; clue: string; answer: string; source_id: string };
type Category = { title: string; theme: string; clues: Clue[] };
type Final = { title: string; clue: string; answer: string; source_id: string };
type Batch = {
  batch_id: string;
  generated_at: string;
  model: string;
  categories: Category[];
  finals: Final[];
};
type Approved = Batch & { approved_at: string };

async function pickBatchId(): Promise<string> {
  const arg = process.argv[2];
  if (arg && existsSync(join(GEN_DIR, `${arg}.json`))) return arg;
  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"))
    .sort();
  if (files.length === 0) {
    console.error("No generated batches found in data/generated/.");
    process.exit(1);
  }
  return files[files.length - 1].replace(/\.json$/, "");
}

async function main() {
  const batchId = await pickBatchId();
  const inPath = join(GEN_DIR, `${batchId}.json`);
  const outPath = join(GEN_DIR, `${batchId}.approved.json`);
  const batch = JSON.parse(await readFile(inPath, "utf8")) as Batch;

  console.log(`\nReviewing batch ${batchId}`);
  console.log(`Generated ${batch.generated_at} via ${batch.model}`);
  console.log(`${batch.categories.length} categories, ${batch.finals.length} finals.\n`);
  console.log(`Commands at each prompt: [a]pprove (default), [r]eject, [s]kip-to-end (auto-approve rest), [q]uit-without-saving.\n`);

  const rl = createInterface({ input, output });
  const ask = async (q: string) => (await rl.question(q)).trim().toLowerCase();

  const approvedCategories: Category[] = [];
  const approvedFinals: Final[] = [];
  let autoApprove = false;

  for (let i = 0; i < batch.categories.length; i++) {
    const cat = batch.categories[i];
    if (autoApprove) { approvedCategories.push(cat); continue; }
    console.log(`\n─── Category ${i + 1}/${batch.categories.length} ─────────────────────────`);
    console.log(`TITLE: ${cat.title}`);
    console.log(`THEME: ${cat.theme}`);
    for (const c of cat.clues) {
      console.log(`  $${c.value}  ${c.clue}`);
      console.log(`         → ${c.answer}    [${c.source_id}]`);
    }
    const r = await ask("[a/r/s/q] > ");
    if (r === "q") { rl.close(); console.log("Quit. No file written."); return; }
    if (r === "s") { autoApprove = true; approvedCategories.push(cat); continue; }
    if (r === "r") { console.log("rejected."); continue; }
    approvedCategories.push(cat);
  }

  autoApprove = false;
  for (let i = 0; i < batch.finals.length; i++) {
    const fin = batch.finals[i];
    if (autoApprove) { approvedFinals.push(fin); continue; }
    console.log(`\n─── Final ${i + 1}/${batch.finals.length} ────────────────────────────`);
    console.log(`CATEGORY: ${fin.title}`);
    console.log(`CLUE:     ${fin.clue}`);
    console.log(`ANSWER:   ${fin.answer}    [${fin.source_id}]`);
    const r = await ask("[a/r/s/q] > ");
    if (r === "q") { rl.close(); console.log("Quit. No file written."); return; }
    if (r === "s") { autoApprove = true; approvedFinals.push(fin); continue; }
    if (r === "r") { console.log("rejected."); continue; }
    approvedFinals.push(fin);
  }
  rl.close();

  const approved: Approved = {
    ...batch,
    categories: approvedCategories,
    finals: approvedFinals,
    approved_at: new Date().toISOString(),
  };
  await writeFile(outPath, JSON.stringify(approved, null, 2));
  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`Approved ${approvedCategories.length}/${batch.categories.length} categories, ${approvedFinals.length}/${batch.finals.length} finals.`);
  console.log(`\nNext: \`npm run import-clues ${batchId}\``);
}

main().catch((e) => { console.error(e); process.exit(1); });
