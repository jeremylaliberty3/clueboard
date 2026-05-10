/**
 * Stage 1: Pull verified trivia from freely-licensed public sources into a
 * local fact bank for downstream Claude rewriting.
 *
 *   Open Trivia DB (CC BY-SA 4.0) — opentdb.com
 *   The Trivia API (CC BY 4.0)    — the-trivia-api.com
 *
 * Output: clueboard/data/sources.json
 *
 * Run with:  cd clueboard && npx tsx scripts/fetch-sources.ts
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type SourceFact = {
  source: "otdb" | "trivia-api";
  source_id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  answer: string;
  tags?: string[];
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, "..", "data");
const OUT = join(DATA_DIR, "sources.json");

// ----- HTML entity decoding (OTDB returns encoded text) -----
const ENTITIES: Record<string, string> = {
  "&quot;": '"', "&#039;": "'", "&apos;": "'", "&amp;": "&",
  "&lt;": "<", "&gt;": ">", "&hellip;": "…", "&nbsp;": " ",
  "&ndash;": "–", "&mdash;": "—", "&ldquo;": "“", "&rdquo;": "”",
  "&lsquo;": "‘", "&rsquo;": "’", "&eacute;": "é", "&Eacute;": "É",
  "&aacute;": "á", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú",
  "&uuml;": "ü", "&auml;": "ä", "&ouml;": "ö", "&szlig;": "ß", "&ntilde;": "ñ",
};
function decodeEntities(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// Open Trivia DB
// ============================================================
async function fetchOTDB(): Promise<SourceFact[]> {
  console.log("\n=== Open Trivia DB ===");
  const tokenRes = await fetch("https://opentdb.com/api_token.php?command=request").then((r) => r.json());
  const token = tokenRes.token as string;
  console.log(`Token acquired: ${token.slice(0, 12)}…`);

  const out: SourceFact[] = [];
  const seen = new Set<string>();
  const url = `https://opentdb.com/api.php?amount=50&token=${token}`;

  let consecutiveEmpty = 0;
  while (true) {
    let res: Response;
    try { res = await fetch(url); } catch (e) {
      console.warn(`  network error, retrying in 5s: ${e}`);
      await sleep(5000); continue;
    }
    const data = await res.json() as { response_code: number; results: Array<{
      category: string; type: string; difficulty: "easy" | "medium" | "hard";
      question: string; correct_answer: string; incorrect_answers: string[];
    }> };

    // 0 = ok, 1 = no more results for this filter, 4 = token exhausted, 5 = rate limit
    if (data.response_code === 4 || data.response_code === 1) {
      console.log("  token exhausted → finished OTDB");
      break;
    }
    if (data.response_code === 5) {
      console.log("  rate-limited, sleeping 6s…");
      await sleep(6000); continue;
    }
    if (data.response_code !== 0) {
      console.warn(`  unexpected response_code ${data.response_code}; stopping`);
      break;
    }
    if (!data.results || data.results.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
      await sleep(5500); continue;
    }
    consecutiveEmpty = 0;

    for (const q of data.results) {
      const question = decodeEntities(q.question).trim();
      const answer = decodeEntities(q.correct_answer).trim();
      const category = decodeEntities(q.category).trim();
      const id = `otdb:${hash(question + "|" + answer)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        source: "otdb",
        source_id: id,
        category,
        difficulty: q.difficulty,
        question,
        answer,
      });
    }
    process.stdout.write(`\r  collected: ${out.length} `);
    // OTDB's documented soft limit is 1 req / 5s.
    await sleep(5500);
  }
  process.stdout.write("\n");
  return out;
}

// ============================================================
// The Trivia API
// ============================================================
async function fetchTriviaAPI(): Promise<SourceFact[]> {
  console.log("\n=== The Trivia API ===");
  const out: SourceFact[] = [];
  const seen = new Set<string>();

  // Their /questions endpoint returns up to 50 random questions per call.
  // No "give me everything" endpoint, so we poll until the dedup rate gets
  // very high — at which point we've covered most of the pool.
  const target = 6500;            // upper bound; pool is ~6000
  const dedupStopAfter = 8;       // stop after N consecutive batches with mostly dupes
  let consecutiveDupeBatches = 0;
  let batchNo = 0;

  while (out.length < target && consecutiveDupeBatches < dedupStopAfter) {
    batchNo++;
    let res: Response;
    try {
      res = await fetch("https://the-trivia-api.com/v2/questions?limit=50");
    } catch (e) {
      console.warn(`  network error, retrying in 3s: ${e}`);
      await sleep(3000); continue;
    }
    if (!res.ok) {
      if (res.status === 429) {
        console.log("  rate-limited, sleeping 5s…");
        await sleep(5000); continue;
      }
      console.warn(`  HTTP ${res.status}; stopping`);
      break;
    }
    const batch = await res.json() as Array<{
      id: string; correctAnswer: string; incorrectAnswers: string[];
      question: { text: string }; tags: string[]; category: string;
      difficulty: "easy" | "medium" | "hard";
    }>;

    let added = 0;
    for (const q of batch) {
      const id = `tapi:${q.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        source: "trivia-api",
        source_id: id,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question.text.trim(),
        answer: q.correctAnswer.trim(),
        tags: q.tags,
      });
      added++;
    }
    if (added < 5) consecutiveDupeBatches++;
    else consecutiveDupeBatches = 0;
    process.stdout.write(`\r  batch ${batchNo} → +${added} (total ${out.length}, dupe-streak ${consecutiveDupeBatches}) `);
    await sleep(800);
  }
  process.stdout.write("\n");
  return out;
}

// ----- helpers -----
function hash(s: string): string {
  // Tiny non-cryptographic hash for dedup IDs.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function summarize(facts: SourceFact[]) {
  const byDifficulty: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const f of facts) {
    byDifficulty[f.difficulty]++;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySource[f.source] = (bySource[f.source] || 0) + 1;
  }
  console.log("\n=== Summary ===");
  console.log(`Total facts:    ${facts.length}`);
  console.log(`By source:      ${JSON.stringify(bySource)}`);
  console.log(`By difficulty:  ${JSON.stringify(byDifficulty)}`);
  const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  console.log(`Top categories:`);
  for (const [cat, n] of cats.slice(0, 12)) {
    console.log(`  ${n.toString().padStart(5)}  ${cat}`);
  }
  console.log(`(${cats.length} categories total)`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

  // Resume support: keep prior content if re-running so partial OTDB/Trivia API
  // failures don't wipe collected work.
  let prior: SourceFact[] = [];
  if (existsSync(OUT)) {
    try {
      prior = JSON.parse(await readFile(OUT, "utf8")) as SourceFact[];
      console.log(`Found existing ${prior.length} facts at ${OUT} — will merge.`);
    } catch { /* ignore */ }
  }

  const args = new Set(process.argv.slice(2));
  const skipOTDB = args.has("--skip-otdb");
  const skipTriviaApi = args.has("--skip-trivia-api");

  const otdb = skipOTDB ? [] : await fetchOTDB();
  const triviaApi = skipTriviaApi ? [] : await fetchTriviaAPI();

  // Merge + dedup against prior + within new.
  const all = new Map<string, SourceFact>();
  for (const f of prior) all.set(f.source_id, f);
  for (const f of otdb) all.set(f.source_id, f);
  for (const f of triviaApi) all.set(f.source_id, f);
  const merged = Array.from(all.values());

  await writeFile(OUT, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${merged.length} facts to ${OUT}`);
  summarize(merged);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
