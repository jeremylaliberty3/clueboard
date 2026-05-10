/**
 * Stage 3: Walk through a generated batch and approve/reject content.
 *
 * Per-CATEGORY actions:
 *   a / Enter — approve as-is
 *   e         — edit: reject specific clues (by index 1–5); the kept
 *               clues stay, and the rejected slots are queued for the
 *               patch script to regenerate.
 *   r         — reject the whole category
 *   s         — skip-to-end: auto-approve everything remaining
 *   q         — quit without saving any further reviews
 *
 * Per-FINAL actions:
 *   a / Enter — approve
 *   r         — reject
 *   s, q      — same as above
 *
 * Progress is saved after every decision, so you can quit and resume
 * with `npm run review <batch_id>` at any time.
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

type ApprovedCategory = Category & {
  /** Standard-value slots that need a replacement clue (filled by patch-clues.ts). */
  pending?: number[];
};
type Approved = {
  batch_id: string;
  generated_at: string;
  model: string;
  approved_at: string;
  categories: ApprovedCategory[];
  finals: Final[];
  /** Indices into the original batch — used to resume. */
  reviewed_category_indices: number[];
  reviewed_final_indices: number[];
};

const STANDARD_VALUES = [200, 400, 600, 800, 1000];

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

async function loadOrInitApproved(batch: Batch, outPath: string): Promise<Approved> {
  if (existsSync(outPath)) {
    const existing = JSON.parse(await readFile(outPath, "utf8")) as Approved;
    console.log(`Resuming from ${outPath} — ${existing.reviewed_category_indices.length}/${batch.categories.length} categories already reviewed, ${existing.reviewed_final_indices.length}/${batch.finals.length} finals.\n`);
    return existing;
  }
  return {
    batch_id: batch.batch_id,
    generated_at: batch.generated_at,
    model: batch.model,
    approved_at: new Date().toISOString(),
    categories: [],
    finals: [],
    reviewed_category_indices: [],
    reviewed_final_indices: [],
  };
}

async function saveApproved(outPath: string, approved: Approved) {
  approved.approved_at = new Date().toISOString();
  await writeFile(outPath, JSON.stringify(approved, null, 2));
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function formatClueLine(idx: number, c: Clue): string {
  const valStr = c.value === null ? "Final" : `$${c.value}`;
  return `  [${idx}] ${pad(valStr, 6)} ${c.clue}\n         → ${c.answer}    [${c.source_id}]`;
}

async function main() {
  const batchId = await pickBatchId();
  const inPath = join(GEN_DIR, `${batchId}.json`);
  const outPath = join(GEN_DIR, `${batchId}.approved.json`);
  const batch = JSON.parse(await readFile(inPath, "utf8")) as Batch;

  console.log(`\nReviewing batch ${batchId}`);
  console.log(`Generated ${batch.generated_at} via ${batch.model}`);
  console.log(`${batch.categories.length} categories, ${batch.finals.length} finals.`);
  console.log(`\nCategory actions: [a]pprove, [e]dit (reject specific clues), [r]eject, [s]kip-to-end, [q]uit\n`);

  const approved = await loadOrInitApproved(batch, outPath);
  const reviewedCats = new Set(approved.reviewed_category_indices);
  const reviewedFinals = new Set(approved.reviewed_final_indices);

  const rl = createInterface({ input, output });
  const ask = async (q: string) => (await rl.question(q)).trim().toLowerCase();

  let autoApprove = false;
  let abort = false;

  // ── categories ─────────────────────────────────────────────
  for (let i = 0; i < batch.categories.length; i++) {
    if (reviewedCats.has(i)) continue;
    const cat = batch.categories[i];
    if (autoApprove) {
      approved.categories.push(cat);
      approved.reviewed_category_indices.push(i);
      await saveApproved(outPath, approved);
      continue;
    }
    console.log(`\n─── Category ${i + 1}/${batch.categories.length} ${"─".repeat(40)}`);
    console.log(`TITLE: ${cat.title}`);
    console.log(`THEME: ${cat.theme}`);
    cat.clues.forEach((c, idx) => console.log(formatClueLine(idx + 1, c)));

    const r = await ask("[a/e/r/s/q] > ");
    if (r === "q") { abort = true; break; }
    if (r === "s") { autoApprove = true; approved.categories.push(cat); approved.reviewed_category_indices.push(i); await saveApproved(outPath, approved); continue; }
    if (r === "r") { approved.reviewed_category_indices.push(i); await saveApproved(outPath, approved); console.log("rejected."); continue; }
    if (r === "e") {
      const raw = await ask("Reject which clues? (space-sep indices 1–5, blank to abort): ");
      if (!raw) { console.log("aborted."); i--; continue; }
      const indices = raw.split(/\s+/).map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 5);
      const kept: Clue[] = [];
      const pending: number[] = [];
      cat.clues.forEach((c, idx) => {
        const isRejected = indices.includes(idx + 1);
        if (isRejected) pending.push(c.value ?? 0);
        else kept.push(c);
      });
      // Ensure pending values are valid standard values; fall back to the slot's original value.
      const cleanPending = pending.filter((v) => STANDARD_VALUES.includes(v));
      if (kept.length === 0) {
        approved.reviewed_category_indices.push(i);
        await saveApproved(outPath, approved);
        console.log("rejected (all clues marked).");
        continue;
      }
      const entry: ApprovedCategory = { ...cat, clues: kept };
      if (cleanPending.length > 0) entry.pending = cleanPending;
      approved.categories.push(entry);
      approved.reviewed_category_indices.push(i);
      await saveApproved(outPath, approved);
      console.log(`kept ${kept.length} clue${kept.length === 1 ? "" : "s"}, queued ${cleanPending.length} for patching at $${cleanPending.join(", $")}.`);
      continue;
    }
    // default = approve
    approved.categories.push(cat);
    approved.reviewed_category_indices.push(i);
    await saveApproved(outPath, approved);
  }

  if (abort) {
    rl.close();
    console.log(`\nQuit. Progress saved to ${outPath}.`);
    console.log(`Resume with: npm run review ${batchId}`);
    return;
  }

  // ── finals ─────────────────────────────────────────────────
  autoApprove = false;
  for (let i = 0; i < batch.finals.length; i++) {
    if (reviewedFinals.has(i)) continue;
    const fin = batch.finals[i];
    if (autoApprove) {
      approved.finals.push(fin);
      approved.reviewed_final_indices.push(i);
      await saveApproved(outPath, approved);
      continue;
    }
    console.log(`\n─── Final ${i + 1}/${batch.finals.length} ${"─".repeat(40)}`);
    console.log(`CATEGORY: ${fin.title}`);
    console.log(`CLUE:     ${fin.clue}`);
    console.log(`ANSWER:   ${fin.answer}    [${fin.source_id}]`);
    const r = await ask("[a/r/s/q] > ");
    if (r === "q") { abort = true; break; }
    if (r === "s") { autoApprove = true; approved.finals.push(fin); approved.reviewed_final_indices.push(i); await saveApproved(outPath, approved); continue; }
    if (r === "r") { approved.reviewed_final_indices.push(i); await saveApproved(outPath, approved); console.log("rejected."); continue; }
    approved.finals.push(fin);
    approved.reviewed_final_indices.push(i);
    await saveApproved(outPath, approved);
  }
  rl.close();

  // Summary
  const pendingCats = approved.categories.filter((c) => c.pending?.length).length;
  const pendingClues = approved.categories.reduce((n, c) => n + (c.pending?.length ?? 0), 0);
  console.log(`\n✓ Saved ${outPath}`);
  console.log(`Approved ${approved.categories.length}/${batch.categories.length} categories, ${approved.finals.length}/${batch.finals.length} finals.`);
  if (pendingCats > 0) {
    console.log(`${pendingCats} categories have ${pendingClues} clue slot${pendingClues === 1 ? "" : "s"} queued for patching.`);
    console.log(`Next: \`npm run patch-clues ${batchId}\``);
  } else {
    console.log(`Next: \`npm run import-clues ${batchId}\``);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
