/**
 * Stage 3.5: Regenerate the clues that were rejected during review.
 *
 * For every category in the approved file with a `pending` array of value
 * slots, ask Claude to write a single replacement clue at that exact value
 * — given the kept clues, theme, and a fresh stratified sample of source
 * facts.
 *
 * Run with:  cd clueboard && npm run patch-clues <batch_id>
 *            (omit batch_id for the most recent approved file)
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, "..", "data");
const SOURCES = join(DATA_DIR, "sources.json");
const GEN_DIR = join(DATA_DIR, "generated");

type SourceFact = {
  source: "otdb" | "trivia-api";
  source_id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  answer: string;
};

type Clue = { value: number | null; clue: string; answer: string; source_id: string };
type Category = { title: string; theme: string; clues: Clue[]; pending?: number[] };
type Final = { title: string; clue: string; answer: string; source_id: string };
type Approved = {
  batch_id: string;
  generated_at: string;
  model: string;
  approved_at: string;
  categories: Category[];
  finals: Final[];
  reviewed_category_indices: number[];
  reviewed_final_indices: number[];
};

// Map dollar value → expected source-fact difficulty bias.
function difficultyForValue(v: number): "easy" | "medium" | "hard" {
  if (v <= 200) return "easy";
  if (v <= 600) return "medium";
  return "hard";
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isUsableFact(f: SourceFact): boolean {
  const a = f.answer.trim();
  if (!a) return false;
  if (a.length > 60) return false;
  if (/^(true|false)$/i.test(a)) return false;
  if (/[.!?]$/.test(a) && a.split(" ").length > 4) return false;
  if (/,\s|\sand\s|\sor\s|;/.test(a)) return false;
  if (a.split(" ").length > 6) return false;
  const q = f.question.toLowerCase();
  if (/\b(pictured|shown|above|below|this image|this picture|this audio|this video|highlighted|seen here)\b/.test(q)) return false;
  return true;
}

function pickFactsForValue(all: SourceFact[], value: number, n: number): SourceFact[] {
  const usable = all.filter(isUsableFact);
  const target = difficultyForValue(value);
  const matching = shuffle(usable.filter((f) => f.difficulty === target));
  // Top up with adjacent difficulty if matching pool is thin.
  if (matching.length < n) {
    const adjacent = shuffle(usable.filter((f) => f.difficulty !== target));
    return [...matching, ...adjacent.slice(0, n - matching.length)];
  }
  return matching.slice(0, n);
}

function parseStrictJSON(s: string): unknown {
  const stripped = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(stripped);
}

function noLeak(clue: string, answer: string): boolean {
  if (answer.length <= 3) return true;
  return !clue.toLowerCase().includes(answer.toLowerCase());
}

function validateAnswer(answer: string): boolean {
  const a = answer.trim();
  if (!a || a.length > 60) return false;
  if (/^(true|false)$/i.test(a)) return false;
  if (/[.!?]$/.test(a) && a.split(" ").length > 4) return false;
  if (/,\s|\sand\s|\sor\s|;/.test(a) && a.split(" ").length > 5) return false;
  return true;
}

const SYSTEM_PROMPT = `You are patching a single clue inside an existing Clueboard category. The category, theme, and most clues are already fixed — you just need to write ONE new clue that fits cleanly into the missing dollar-value slot.

Hard rules:

1. THEME ADHERENCE. Your clue MUST match the category's stated theme exactly. The theme is non-negotiable. If you can't find a source fact that fits, return null.
2. ANSWER LEAKAGE FORBIDDEN. The answer must NOT appear as a substring of the clue text (case-insensitive).
3. ANSWER FORM. Short canonical noun phrase, name, year, or number. Never a full sentence, list, "True"/"False", or the word the clue is defining.
4. CLUE FORM. Declarative statement, not a question. 1–2 sentences, ~60–200 chars. No media references ("see picture", "as shown").
5. DIFFICULTY. Match the dollar value: $200 = school/pop-culture-common, $400 = common knowledge, $600 = educated-adult, $800 = niche/specialized, $1000 = hardest tier.
6. UNIQUENESS. Use a source fact that's NOT already used in the kept clues (check source_ids).
7. GROUNDING. The clue's answer MUST be the source fact's answer (in canonical form). Don't invent details beyond the source fact.

Return strict JSON ONLY (no markdown fences, no prose):

{ "clue": "...", "answer": "...", "source_id": "..." }

Or if no fitting source fact exists in the candidates I provide:

{ "skip": true, "reason": "brief explanation" }`;

function buildUserPrompt(cat: Category, value: number, candidates: SourceFact[]): string {
  const keptClues = cat.clues
    .slice()
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .map((c) => `  $${c.value} — "${c.clue}" → ${c.answer}  [${c.source_id}]`)
    .join("\n");
  const usedIds = new Set(cat.clues.map((c) => c.source_id));
  const factLines = candidates
    .filter((f) => !usedIds.has(f.source_id))
    .map((f) => `  [${f.source_id}] (${f.difficulty}, ${f.category}) Q: ${f.question} | A: ${f.answer}`)
    .join("\n");

  return `Category: ${cat.title}
Theme: ${cat.theme}

Kept clues already in this category:
${keptClues}

Slot to fill: $${value}
Difficulty bias: ${difficultyForValue(value)}

Candidate source facts (use ONE):
${factLines}

Write the replacement clue now.`;
}

async function pickApprovedId(): Promise<string> {
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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY in env.");
    process.exit(1);
  }
  if (!existsSync(SOURCES)) {
    console.error(`Missing ${SOURCES}. Run \`npm run fetch-sources\` first.`);
    process.exit(1);
  }

  const id = await pickApprovedId();
  const path = join(GEN_DIR, `${id}.approved.json`);
  const approved = JSON.parse(await readFile(path, "utf8")) as Approved;
  const sources = JSON.parse(await readFile(SOURCES, "utf8")) as SourceFact[];

  const pendingCats = approved.categories.filter((c) => c.pending && c.pending.length > 0);
  const totalSlots = pendingCats.reduce((n, c) => n + (c.pending?.length ?? 0), 0);
  if (totalSlots === 0) {
    console.log("No pending clues to patch. You're done — run `npm run import-clues`.");
    return;
  }
  console.log(`Patching ${totalSlots} clue slot${totalSlots === 1 ? "" : "s"} across ${pendingCats.length} categor${pendingCats.length === 1 ? "y" : "ies"}.\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let patched = 0, skipped = 0;

  for (const cat of pendingCats) {
    const stillPending: number[] = [];
    for (const value of cat.pending ?? []) {
      const candidates = pickFactsForValue(sources, value, 30);
      const userPrompt = buildUserPrompt(cat, value, candidates);

      process.stdout.write(`  ${cat.title} $${value}: `);
      const t0 = Date.now();
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      let parsed: { clue?: string; answer?: string; source_id?: string; skip?: boolean; reason?: string };
      try {
        parsed = parseStrictJSON(text) as typeof parsed;
      } catch {
        console.log(`  parse failed (${elapsed}s) — keeping pending.`);
        stillPending.push(value);
        continue;
      }

      if (parsed.skip) {
        console.log(`skipped (${elapsed}s) — ${parsed.reason ?? "Claude couldn't find a fit"}`);
        skipped++;
        continue;
      }
      const { clue, answer, source_id } = parsed;
      if (!clue || !answer || !source_id) {
        console.log(`  malformed response (${elapsed}s) — keeping pending.`);
        stillPending.push(value);
        continue;
      }
      if (!validateAnswer(answer) || !noLeak(clue, answer)) {
        console.log(`  filter rejected (${elapsed}s) — keeping pending.`);
        stillPending.push(value);
        continue;
      }
      if (cat.clues.some((c) => c.source_id === source_id)) {
        console.log(`  source already used (${elapsed}s) — keeping pending.`);
        stillPending.push(value);
        continue;
      }
      cat.clues.push({ value, clue, answer, source_id });
      console.log(`✓ (${elapsed}s) → ${answer}`);
      patched++;
    }
    if (stillPending.length > 0) cat.pending = stillPending;
    else delete cat.pending;
    // Re-sort clues by value so the order stays canonical.
    cat.clues.sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  }

  // Drop categories that fell below 5 clues (skipped patches that weren't recovered).
  const completedCats = approved.categories.filter((c) => c.clues.length === 5);
  const incompleteCats = approved.categories.length - completedCats.length;
  approved.categories = completedCats;
  approved.approved_at = new Date().toISOString();

  await writeFile(path, JSON.stringify(approved, null, 2));
  console.log(`\nPatched ${patched}/${totalSlots} slot${totalSlots === 1 ? "" : "s"}.`);
  if (skipped > 0) console.log(`${skipped} skipped by Claude (no fitting source fact).`);
  if (incompleteCats > 0) console.log(`Dropped ${incompleteCats} categor${incompleteCats === 1 ? "y" : "ies"} that couldn't be completed.`);
  console.log(`\nFile updated: ${path}`);
  console.log(`${approved.categories.length} categories, ${approved.finals.length} finals ready for import.`);
  console.log(`Next: \`npm run import-clues ${id}\``);
}

main().catch((e) => { console.error(e); process.exit(1); });
