/**
 * Walk every generated batch in data/generated/ and produce a single
 * validation report: aggregate stats, distributions, fact-reuse warnings,
 * and a per-category preview so you can eyeball quality.
 *
 * Run with:  cd clueboard && npm run inspect-bank
 *            cd clueboard && npm run inspect-bank -- --full        (full clue text)
 *            cd clueboard && npm run inspect-bank -- --topic SCIENCE
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

type Clue = {
  value: number | null;
  clue: string;
  answer: string;
  source_id: string;
  fit_justification?: string;
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
  fit_justification?: string;
};
type Batch = {
  batch_id: string;
  topic_filter?: string | null;
  categories?: Category[];
  finals?: Final[];
};

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:  (s: string) => `\x1b[2m${s}\x1b[0m`,
  red:  (s: string) => `\x1b[31m${s}\x1b[0m`,
  green:(s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow:(s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function rule() { return "─".repeat(72); }
function pad(s: string, w: number) { return s.length >= w ? s : s + " ".repeat(w - s.length); }

async function main() {
  const args = process.argv.slice(2);
  const argMap = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) argMap.set(args[i].slice(2), args[i + 1] ?? "true");
  }
  const full = argMap.get("full") === "true";
  const topicFilter = argMap.get("topic")?.toUpperCase();

  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"))
    .sort();
  if (files.length === 0) {
    console.log(C.dim("No generated batches found in data/generated/."));
    return;
  }

  // Aggregate
  const categories: Category[] = [];
  const finals: Final[] = [];
  for (const f of files) {
    try {
      const b = JSON.parse(await readFile(join(GEN_DIR, f), "utf8")) as Batch;
      categories.push(...(b.categories ?? []));
      finals.push(...(b.finals ?? []));
    } catch (e) {
      console.warn(C.yellow(`  Couldn't read ${f}: ${e}`));
    }
  }

  const filtered = topicFilter
    ? categories.filter((c) => c.topic === topicFilter)
    : categories;

  // ── header ──
  console.log(C.bold("\n" + rule()));
  console.log(C.bold(`  CLUEBOARD BANK INSPECTION`));
  console.log(C.bold(rule()));
  console.log(`  Files:          ${files.length}`);
  console.log(`  Categories:     ${categories.length}  (${categories.length * 5} clues)`);
  console.log(`  Finals:         ${finals.length}`);
  if (topicFilter) console.log(C.cyan(`  Filtered to topic: ${topicFilter}  (${filtered.length} cats)`));

  // ── topic distribution ──
  const byTopic: Record<string, number> = {};
  for (const c of categories) byTopic[c.topic ?? "(none)"] = (byTopic[c.topic ?? "(none)"] || 0) + 1;
  console.log(C.bold(`\n  Topics`));
  const tEntries = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
  for (const [t, n] of tEntries) {
    const bar = "█".repeat(Math.min(40, n));
    console.log(`    ${pad(t, 18)} ${pad(String(n), 4)}  ${C.dim(bar)}`);
  }

  // ── style distribution ──
  const byStyle: Record<string, number> = {};
  for (const c of categories) byStyle[c.category_style ?? "(none)"] = (byStyle[c.category_style ?? "(none)"] || 0) + 1;
  console.log(C.bold(`\n  Styles`));
  for (const [s, n] of Object.entries(byStyle).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(s, 18)} ${pad(String(n), 4)}`);
  }

  // ── difficulty profile distribution ──
  const byProfile: Record<string, number> = {};
  for (const c of categories) byProfile[c.difficulty_profile ?? "(none)"] = (byProfile[c.difficulty_profile ?? "(none)"] || 0) + 1;
  console.log(C.bold(`\n  Difficulty profiles`));
  for (const [p, n] of Object.entries(byProfile).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(p, 18)} ${pad(String(n), 4)}`);
  }

  // ── integrity flags ──
  console.log(C.bold(`\n  Integrity checks`));

  const titles = categories.map((c) => c.title);
  const dupTitles = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))];
  if (dupTitles.length === 0) console.log(C.green("    ✓ No duplicate category titles"));
  else console.log(C.yellow(`    ⚠ Duplicate titles: ${dupTitles.join(", ")}`));

  const factCount = new Map<string, number>();
  for (const c of categories) for (const cl of c.clues) factCount.set(cl.source_id, (factCount.get(cl.source_id) || 0) + 1);
  for (const f of finals) factCount.set(f.source_id, (factCount.get(f.source_id) || 0) + 1);
  const reused = Array.from(factCount.entries()).filter(([, n]) => n > 1);
  if (reused.length === 0) console.log(C.green("    ✓ No source-fact reuse across bank"));
  else console.log(C.yellow(`    ⚠ ${reused.length} source facts reused across categories`));

  const noLeak = (clue: string, answer: string) =>
    answer.length <= 3 || !clue.toLowerCase().includes(answer.toLowerCase());
  let leakCount = 0;
  for (const c of categories) for (const cl of c.clues) if (!noLeak(cl.clue, cl.answer)) leakCount++;
  for (const f of finals) if (!noLeak(f.clue, f.answer)) leakCount++;
  if (leakCount === 0) console.log(C.green("    ✓ No answer leakage"));
  else console.log(C.red(`    ✗ ${leakCount} clues with answer in clue text`));

  let missingMeta = 0;
  for (const c of categories) if (!c.topic || !c.category_style || !c.difficulty_profile) missingMeta++;
  if (missingMeta === 0) console.log(C.green("    ✓ All categories have full metadata"));
  else console.log(C.yellow(`    ⚠ ${missingMeta} categories missing metadata`));

  // Fit justification quality
  let missingJustif = 0;
  let weakJustif = 0;
  const STOCK = /\b(this relates to|this is about|adjacent to|connected to|associated with the theme)\b/i;
  for (const c of categories) {
    for (const cl of c.clues) {
      const j = cl.fit_justification?.trim() ?? "";
      if (!j) missingJustif++;
      else if (j.length < 30 || STOCK.test(j)) weakJustif++;
    }
  }
  if (missingJustif === 0 && weakJustif === 0) {
    console.log(C.green("    ✓ All clues have specific fit_justification"));
  } else {
    if (missingJustif > 0) console.log(C.red(`    ✗ ${missingJustif} clues missing fit_justification`));
    if (weakJustif > 0) console.log(C.yellow(`    ⚠ ${weakJustif} clues have weak/stock fit_justification`));
  }

  // Variety-rule pre-check
  const topicCount = Object.keys(byTopic).length;
  if (topicCount >= 6) console.log(C.green(`    ✓ ${topicCount} distinct topics — rule 1 (one-per-topic) satisfiable`));
  else console.log(C.yellow(`    ⚠ Only ${topicCount} topics — rule 1 will fall back to plain shuffle`));

  const varietyCats = categories.filter((c) => c.category_style === "wordplay" || c.category_style === "themed").length;
  if (varietyCats >= 1) console.log(C.green(`    ✓ ${varietyCats} wordplay/themed categories — rule 2 satisfiable`));
  else console.log(C.yellow(`    ⚠ 0 wordplay/themed categories — rule 2 will be skipped`));

  const balancedCats = categories.filter((c) => c.difficulty_profile === "balanced").length;
  if (balancedCats >= 2) console.log(C.green(`    ✓ ${balancedCats} balanced-difficulty categories — rule 3 satisfiable`));
  else console.log(C.yellow(`    ⚠ Only ${balancedCats} balanced-difficulty categories — rule 3 weak`));

  // ── per-category preview ──
  console.log(C.bold(`\n  Categories  ${C.dim("(--full for clue text)")}`));
  console.log(rule());

  const sorted = [...filtered].sort((a, b) => (a.topic ?? "").localeCompare(b.topic ?? ""));
  for (const c of sorted) {
    const t = pad(c.topic ?? "?", 14);
    const s = pad(c.category_style ?? "?", 10);
    const d = pad(c.difficulty_profile ?? "?", 14);
    console.log(`${C.cyan(t)} ${C.dim(s)} ${C.dim(d)} ${C.bold(c.title)}`);
    console.log(`  ${C.dim(c.theme)}`);
    if (full) {
      for (const cl of c.clues) {
        const v = `$${cl.value}`;
        const safe = noLeak(cl.clue, cl.answer);
        const mark = safe ? " " : C.red("!");
        console.log(`  ${mark}${pad(v, 6)} ${cl.clue}`);
        console.log(`            ${C.dim("→ " + cl.answer)}  ${C.dim("[" + cl.source_id + "]")}`);
        if (cl.fit_justification) {
          console.log(`            ${C.dim("fit: " + cl.fit_justification)}`);
        }
      }
    }
    console.log();
  }

  // ── finals ──
  console.log(C.bold(`  Finals`));
  console.log(rule());
  for (const f of finals) {
    console.log(`${C.cyan(pad(f.topic ?? "?", 14))} ${C.bold(f.title)}`);
    console.log(`  ${f.clue}`);
    console.log(`  ${C.dim("→ " + f.answer)}  ${C.dim("[" + f.source_id + "]")}`);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
