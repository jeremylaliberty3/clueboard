/**
 * List categories that pass strict auto-checks beyond the in-line
 * generator filters. Useful for hand-curating a small board set.
 *
 * Checks applied:
 *   - 5 distinct answers in the category (no degenerate "all same")
 *   - No answer equals the category title (case-insensitive, articles
 *     stripped)
 *   - No clue text contains Claude reasoning artifacts ("wait, ",
 *     "let me check", "let me try", " actually didn't")
 *   - No clue text contains the answer (answer leakage)
 *   - No empty / tiny clue text
 *
 * Run with:  cd clueboard && npx tsx scripts/list-clean.ts
 *            cd clueboard && npx tsx scripts/list-clean.ts --topic GEOGRAPHY
 *            cd clueboard && npx tsx scripts/list-clean.ts --full
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
type Batch = { categories?: Category[] };

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";

function strip(s: string) {
  return s.trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
}

function passesStrict(c: Category): { ok: true } | { ok: false; reason: string } {
  if (!c.clues || c.clues.length !== 5) return { ok: false, reason: "not 5 clues" };
  const answers = c.clues.map((cl) => strip(cl.answer));
  if (new Set(answers).size < 5) {
    return { ok: false, reason: `only ${new Set(answers).size} distinct answers` };
  }
  const titleNorm = strip(c.title);
  for (const a of answers) {
    if (a === titleNorm) return { ok: false, reason: `answer "${a}" equals category title` };
  }
  for (const cl of c.clues) {
    const lc = cl.clue.toLowerCase();
    if (/\bwait,/.test(lc)) return { ok: false, reason: `clue has "wait,"` };
    if (/let me (check|try|look)/.test(lc)) return { ok: false, reason: `clue has reasoning marker` };
    if (/actually,?\s+(he|she|it|they)\s+(didn'?t|did not|wasn'?t)/.test(lc)) {
      return { ok: false, reason: `clue has self-correction` };
    }
    if (cl.clue.trim().length < 30) return { ok: false, reason: "clue too short" };
    if (cl.clue.trim().length > 300) return { ok: false, reason: "clue too long" };
    const aLc = cl.answer.toLowerCase();
    if (aLc.length > 3 && lc.includes(aLc)) {
      return { ok: false, reason: `answer "${cl.answer}" appears in clue text` };
    }
  }
  return { ok: true };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const topicArg = process.argv.find((a, i) => process.argv[i - 1] === "--topic")?.toUpperCase();
  const perTopicArg = process.argv.find((a, i) => process.argv[i - 1] === "--per-topic");
  const perTopic = perTopicArg ? parseInt(perTopicArg, 10) : Infinity;
  const full = args.has("--full");
  const dedupTitles = args.has("--dedup");

  const files = (await readdir(GEN_DIR))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"));

  const all: Category[] = [];
  for (const f of files) {
    try {
      const b = JSON.parse(await readFile(join(GEN_DIR, f), "utf8")) as Batch;
      all.push(...(b.categories ?? []));
    } catch { /* ignore */ }
  }

  // Apply strict filter
  const survivors: Category[] = [];
  const rejected: { c: Category; reason: string }[] = [];
  for (const c of all) {
    if (topicArg && c.topic !== topicArg) continue;
    const r = passesStrict(c);
    if (r.ok) survivors.push(c);
    else rejected.push({ c, reason: r.reason });
  }

  console.log(`\nScanned ${all.length} categories. ${BOLD}${survivors.length} pass${RESET} strict checks. ${rejected.length} rejected.`);

  // Group survivors by topic for display
  const byTopic: Record<string, Category[]> = {};
  for (const c of survivors) {
    (byTopic[c.topic ?? "(none)"] ||= []).push(c);
  }

  // Optionally dedup by title within each topic, keeping the first one seen.
  if (dedupTitles) {
    for (const [topic, cats] of Object.entries(byTopic)) {
      const seen = new Set<string>();
      byTopic[topic] = cats.filter((c) => {
        const key = c.title.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  for (const [topic, allCats] of Object.entries(byTopic).sort()) {
    const cats = isFinite(perTopic) ? allCats.slice(0, perTopic) : allCats;
    console.log(`\n${CYAN}${BOLD}── ${topic} (${cats.length}${allCats.length > cats.length ? ` of ${allCats.length}` : ""}) ──${RESET}`);
    for (const c of cats) {
      console.log(`  ${BOLD}${c.title}${RESET} ${DIM}· ${c.category_style} · ${c.difficulty_profile}${RESET}`);
      console.log(`     ${DIM}${c.theme}${RESET}`);
      const previews = c.clues.slice().sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
        .map((cl) => `$${cl.value}=${cl.answer}`).join("  ");
      console.log(`     ${previews}`);
      if (full) {
        for (const cl of c.clues.slice().sort((a, b) => (a.value ?? 0) - (b.value ?? 0))) {
          console.log(`       $${cl.value}  ${cl.clue}`);
          console.log(`            → ${cl.answer}`);
        }
      }
      console.log();
    }
  }

  if (rejected.length > 0) {
    console.log(`\n${DIM}─── Rejected (${rejected.length}) ───${RESET}`);
    const reasons: Record<string, number> = {};
    for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(4)}  ${reason}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
