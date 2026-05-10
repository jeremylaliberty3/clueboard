/**
 * Stage 2: Have Claude design Jeopardy-style categories and rewrite source
 * facts as authentic clues with $200–$1000 difficulty progression.
 *
 * Inputs:   clueboard/data/sources.json     (from fetch-sources)
 *           ANTHROPIC_API_KEY               (from .env.local)
 *
 * Output:   clueboard/data/generated/<batch_id>.json
 *
 * Run with:  cd clueboard && npx tsx scripts/generate-clues.ts --categories 10 --finals 5
 *            (defaults to 10 / 5 — a small validation batch)
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

// ----- paths -----
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, "..", "data");
const SOURCES = join(DATA_DIR, "sources.json");
const OUT_DIR = join(DATA_DIR, "generated");

// ----- types -----
type SourceFact = {
  source: "otdb" | "trivia-api";
  source_id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  answer: string;
};

type GeneratedClue = {
  value: 200 | 400 | 600 | 800 | 1000 | null;
  clue: string;
  answer: string;
  source_id: string;
};

type GeneratedCategory = {
  title: string;
  theme: string;
  clues: GeneratedClue[];
};

type GeneratedFinal = {
  title: string;
  clue: string;
  answer: string;
  source_id: string;
};

type GenerationBatch = {
  batch_id: string;
  generated_at: string;
  model: string;
  categories: GeneratedCategory[];
  finals: GeneratedFinal[];
};

// ============================================================
// Prompts
// ============================================================
const SYSTEM_PROMPT = `You are the writer's room for Clueboard, a daily trivia game in the style of classic American TV trivia shows.

Your job is to take verified factual question/answer pairs and rewrite them as Jeopardy-style clues, organized into clever categories with appropriate difficulty progression.

CLUE STYLE — every clue must be:
- A DECLARATIVE STATEMENT, never a question. ("This Italian explorer landed in the Bahamas in 1492" — not "Who landed in the Bahamas in 1492?")
- 1–2 sentences, ~80–180 characters.
- Phrased so the correct answer is unambiguous. Players type one short response.
- Self-contained. No "see the picture", "as shown", "above", "audio", or other media references.
- Free of trademark or show-specific phrasing. Don't say "Jeopardy!" or "Final Jeopardy!".

ANSWER STYLE — every answer must be:
- A short, canonical form of the source fact's correct answer.
- Without "What is" / "Who is" / "The" prefix (we'll handle those in our matcher).
- Spelled clearly. Use the most-recognized spelling (e.g. "Tchaikovsky", not "Chaikovsky").

CATEGORY STYLE — every category must:
- Have an evocative TITLE in ALL CAPS, 3–30 characters. Wordplay welcome ("POTENT POTABLES", "STARTS & ENDS WITH 'A'", "BEFORE & AFTER", "19TH-CENTURY DOUBLE-TAKES").
- Have an internal THEME — a topic, era, format, wordplay constraint, etc. — that ties all 5 clues together.
- Have exactly 5 clues at $200, $400, $600, $800, $1000, with monotonically increasing difficulty.
- Each clue uses a DIFFERENT source fact. No fact may be used twice in a single category.

DIFFICULTY GUIDELINES:
- $200: well-known, taught in school, widely-shared cultural knowledge.
- $400: still common knowledge but requires a moment.
- $600: educated-adult level, may require domain familiarity.
- $800: niche or specialized; a real challenge for a casual player.
- $1000: hardest tier; rewards deep familiarity, wordplay, or lateral thinking.

GROUNDING RULE (critical):
- Every clue you write MUST be grounded in one of the source facts I provide. The clue's answer must match the source fact's answer (or a clearly equivalent canonical form).
- Include the source_id of the fact you used. This lets us audit accuracy.
- If a category needs 5 facts and you only see 4 fitting ones, DROP the category. Don't pad with facts that don't fit.

FORMAT — return ONLY valid strict JSON. No prose before or after. No markdown fences. The exact shape:
{
  "categories": [
    {
      "title": "POTENT POTABLES",
      "theme": "Famous alcoholic drinks and their origins",
      "clues": [
        {"value": 200, "clue": "...", "answer": "...", "source_id": "otdb:abc123"},
        {"value": 400, "clue": "...", "answer": "...", "source_id": "otdb:def456"},
        {"value": 600, "clue": "...", "answer": "...", "source_id": "otdb:..."},
        {"value": 800, "clue": "...", "answer": "...", "source_id": "otdb:..."},
        {"value": 1000, "clue": "...", "answer": "...", "source_id": "otdb:..."}
      ]
    }
  ],
  "finals": [
    {
      "title": "FAMOUS SPEECHES",
      "clue": "In 1963, this American civil rights leader delivered a speech beginning 'I have a dream' from the Lincoln Memorial steps.",
      "answer": "Martin Luther King Jr.",
      "source_id": "tapi:..."
    }
  ]
}`;

const USER_PROMPT_TEMPLATE = (
  numCategories: number,
  numFinals: number,
  facts: SourceFact[],
) => {
  const factLines = facts.map((f) =>
    `[${f.source_id}] (${f.difficulty}, ${f.category}) Q: ${f.question} | A: ${f.answer}`
  ).join("\n");
  return `Design ${numCategories} categories and ${numFinals} final clue${numFinals === 1 ? "" : "s"}.

Each category needs 5 clues spanning $200–$1000. Each final clue should be challenging — the kind of thing a player wagers on at the end of a board.

Vary the categories: don't make all 6 about pop culture or all about history. Mix wordplay categories with knowledge categories.

Available source facts (use ONLY these for grounding):

${factLines}

Return strict JSON now.`;
};

// ============================================================
// Helpers
// ============================================================
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickFacts(all: SourceFact[], n: number): SourceFact[] {
  // Stratify by difficulty to give Claude balanced material to choose from.
  const easy = shuffle(all.filter((f) => f.difficulty === "easy"));
  const med = shuffle(all.filter((f) => f.difficulty === "medium"));
  const hard = shuffle(all.filter((f) => f.difficulty === "hard"));
  const each = Math.floor(n / 3);
  return shuffle([...easy.slice(0, each), ...med.slice(0, each), ...hard.slice(0, n - 2 * each)]);
}

function parseStrictJSON(s: string): unknown {
  // Strip ```json fences if Claude adds them despite instructions.
  const stripped = s.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(stripped);
}

function shortBatchId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

// ============================================================
// Main
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const argMap = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) argMap.set(args[i].slice(2), args[i + 1] ?? "true");
  }
  const numCategories = parseInt(argMap.get("categories") ?? "10", 10);
  const numFinals = parseInt(argMap.get("finals") ?? "5", 10);
  const factsPerCall = parseInt(argMap.get("facts") ?? "120", 10);
  const categoriesPerCall = parseInt(argMap.get("per-call") ?? "5", 10);
  const model = argMap.get("model") ?? "claude-sonnet-4-6";

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY in env. Add it to clueboard/.env.local.");
    process.exit(1);
  }
  if (!existsSync(SOURCES)) {
    console.error(`Missing ${SOURCES}. Run \`npm run fetch-sources\` first.`);
    process.exit(1);
  }
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const sources = JSON.parse(await readFile(SOURCES, "utf8")) as SourceFact[];
  console.log(`Loaded ${sources.length} source facts.`);
  console.log(`Plan: ${numCategories} categories + ${numFinals} finals, ${categoriesPerCall} per call (model: ${model}).`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const collectedCategories: GeneratedCategory[] = [];
  const collectedFinals: GeneratedFinal[] = [];

  let remainingCategories = numCategories;
  let remainingFinals = numFinals;
  let callIdx = 0;

  while (remainingCategories > 0 || remainingFinals > 0) {
    callIdx++;
    const cThisCall = Math.min(remainingCategories, categoriesPerCall);
    const fThisCall = Math.min(remainingFinals, Math.max(1, Math.ceil(numFinals / Math.ceil(numCategories / categoriesPerCall))));
    if (cThisCall === 0 && fThisCall === 0) break;

    const facts = pickFacts(sources, factsPerCall);
    const userPrompt = USER_PROMPT_TEMPLATE(cThisCall, fThisCall, facts);

    console.log(`\n[call ${callIdx}] requesting ${cThisCall} categories + ${fThisCall} finals…`);
    const t0 = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt }],
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const usage = response.usage;
    console.log(`  done in ${elapsed}s — input ${usage.input_tokens} (cache write ${usage.cache_creation_input_tokens ?? 0}, cache read ${usage.cache_read_input_tokens ?? 0}), output ${usage.output_tokens}`);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed: { categories?: GeneratedCategory[]; finals?: GeneratedFinal[] };
    try {
      parsed = parseStrictJSON(text) as typeof parsed;
    } catch (e) {
      console.warn(`  JSON parse failed: ${e}. First 400 chars of response:`);
      console.warn(text.slice(0, 400));
      continue;
    }

    const newCats = (parsed.categories ?? []).filter((c) => c.clues?.length === 5);
    const newFinals = parsed.finals ?? [];
    collectedCategories.push(...newCats);
    collectedFinals.push(...newFinals);
    remainingCategories -= newCats.length;
    remainingFinals -= newFinals.length;
    console.log(`  collected ${newCats.length} categories (${collectedCategories.length}/${numCategories}), ${newFinals.length} finals (${collectedFinals.length}/${numFinals})`);

    if (newCats.length === 0 && newFinals.length === 0) {
      console.warn("  empty batch — bailing out to avoid burning tokens.");
      break;
    }
  }

  const batch: GenerationBatch = {
    batch_id: shortBatchId(),
    generated_at: new Date().toISOString(),
    model,
    categories: collectedCategories,
    finals: collectedFinals,
  };
  const outPath = join(OUT_DIR, `${batch.batch_id}.json`);
  await writeFile(outPath, JSON.stringify(batch, null, 2));
  console.log(`\nWrote batch to ${outPath}`);
  console.log(`Summary: ${collectedCategories.length} categories, ${collectedFinals.length} finals.`);
  console.log(`\nNext: review with \`npx tsx scripts/review.ts ${batch.batch_id}\``);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
