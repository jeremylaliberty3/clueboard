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

═══════════════════════════════════════════════════════
META-RULE: QUALITY OVER QUANTITY
═══════════════════════════════════════════════════════

The caller asks for N categories but DOES NOT WANT N IF THE THEMES DON'T FIT.

The caller silently discards any category that has fewer than 5 clues. So if a theme can only support 3 strong clues, returning a 3-clue category throws away your whole effort. Don't pad — pick a different theme that you can genuinely fill 5 strong clues for.

Returning fewer categories than requested is the CORRECT, EXPECTED behavior when source facts don't support more. The user would rather have 5 great categories than 10 mixed-quality ones.

═══════════════════════════════════════════════════════
THE SIX INVIOLABLE RULES
═══════════════════════════════════════════════════════

RULE 1 — STAY ON THEME.
Every single clue in a category MUST satisfy that category's theme. The theme is a hard constraint, not a vibe. Before finalizing each clue, mentally test: "If a player saw this clue under this category title, would they nod or be confused?" If confused — drop that clue and find a different source fact.

THEMES MUST DECLARE THE ANSWER TYPE. Bad theme: "Famous movie quotes." (What's the answer — the quote? the film? the actor?) Good theme: "Famous movie quotes — answer is the FILM TITLE in which the line was spoken."

If you can't write the theme as "[topic] — answer is [the X]", reject the theme.

RULE 2 — GROUNDING IS MECHANICAL.
The clue's answer MUST match the source fact's answer in canonical form (allowing only minor formatting like dropping "the" or fixing capitalization). You may NOT:
- invent details beyond what the source fact establishes
- change spellings into something the fact didn't say
- combine facts from multiple sources into one clue
- use a source fact whose answer doesn't fit your intended clue

If you find yourself wanting to write something the source fact doesn't support, pick a different source fact instead.

RULE 3 — ANSWER FORM.
Every answer must be ONE of these forms:
- A proper noun (person, place, work, brand)
- A common noun phrase (1–4 words)
- A number, year, or simple count
- A single-word verb or adjective for wordplay categories

NEVER:
- A full sentence or clause ("The red carpet changed to a champagne carpet")
- "True" or "False"
- A list of multiple things ("A Fistful of Dollars, For a Few Dollars More, ...")
- The literal word the clue is defining (no circular definitions)

If the source fact's answer is in a forbidden form, skip that fact.

RULE 4 — CLUE FORM.
Every clue must be:
- A DECLARATIVE STATEMENT, never a question. ("This Italian explorer landed in the Bahamas in 1492." — not "Who landed in the Bahamas?")
- 1–2 sentences, roughly 60–200 characters.
- Self-contained. No references to images, audio, video, "above", "below", or "shown".
- Free of show-specific trademarks. Don't say "Jeopardy!" or "Final Jeopardy!".
- Phrased so a knowledgeable player can give one short canonical response. No riddles whose answer is a full sentence.

RULE 5 — DIFFICULTY MONOTONICITY.
Within each category the 5 clues must ramp from $200 (easy / school-level / pop-culture-common) up through $1000 (hard / specialized / rewards depth). Don't put a hard clue at $200 or a giveaway at $1000. The leap from $800 to $1000 should be noticeable.

RULE 6 — NO ANSWER LEAKAGE.
The answer string MUST NOT appear as a case-insensitive substring inside the clue text. If you write a clue and the answer is sitting in the clue, REWRITE the clue. Bad: clue "Rodin's sculpture 'The Kiss' depicts...", answer "The Kiss". Good: clue "Rodin's marble sculpture depicts the doomed lovers Paolo and Francesca locked in this affectionate act.", answer "The Kiss".

Same goes for proper nouns: if the answer is a person's name and that name appears in the clue, that's leakage. Rewrite or pick a different fact.

═══════════════════════════════════════════════════════
WORKED EXAMPLE — what GOOD output looks like
═══════════════════════════════════════════════════════

Theme: "World capitals on rivers"
$200  This British capital, home of Big Ben, sits on the Thames.                        → London
$400  France's capital, host of the 2024 Olympics, sits on the Seine.                   → Paris
$600  Hungary's capital, an amalgam of two cities on the Danube, has thermal baths.     → Budapest
$800  This Russian capital, the world's northernmost capital with over 1M people, sits at the mouth of the Daugava... wait, that's Riga. Skip.
$800  Iraq's capital, founded in 762 AD on the Tigris, was the heart of the Abbasid caliphate. → Baghdad
$1000 Mali's capital, sitting on the Niger, shares its name with a hippopotamus.        → Bamako

Notice: every clue mentions a river (theme honored), every answer is a single proper noun, the difficulty ramps. The model recognized a misfit and corrected mid-flight. That's the standard.

═══════════════════════════════════════════════════════
ANTI-PATTERNS — REJECT YOUR OWN OUTPUT IF
═══════════════════════════════════════════════════════

✗  A clue's answer is "True", "False", a sentence, or a list of items.
✗  A clue defines its own answer ("This term, 'diphthong', refers to...") → the answer would just be "diphthong". Circular. Reject.
✗  A category's theme is "British monarchs" but the $1000 clue is about Mussolini.
✗  You invent a word that isn't in the source fact (e.g. claiming Italian for "blue" is "Azuro" when no source says so).
✗  A clue requires the player to type more than ~5 words to answer.
✗  Two clues in the same category use the same source fact.

═══════════════════════════════════════════════════════
CATEGORY STYLE
═══════════════════════════════════════════════════════

- TITLE in ALL CAPS, 3–30 characters. Wordplay welcome: "POTENT POTABLES", "STARTS & ENDS WITH 'A'", "BEFORE & AFTER", "19TH-CENTURY DOUBLE-TAKES", "STATE-IFIED CAPITALS".
- THEME is a sentence the model writes for itself describing the unifying constraint. Treat it as a contract with the reader.
- Mix category types across a batch: some knowledge (a topic, an era), some wordplay (sound, structure), some format ("answers all start with a vowel", "answers are all 4-letter words").

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════

Return ONLY strict JSON, no markdown fences, no prose. The exact shape:

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
}

Categories with fewer than 5 clues will be discarded by the caller. Returning 6 strong categories is better than 10 mixed-quality ones.`;

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

// Reject facts whose answer can't be cleanly used as a Jeopardy-style answer.
// These slip through OTDB's true/false questions and Trivia API answers
// that are full sentences or multi-item lists.
function isUsableFact(f: SourceFact): boolean {
  const a = f.answer.trim();
  if (!a) return false;
  if (a.length > 60) return false;                  // too long for a clean answer
  if (/^(true|false)$/i.test(a)) return false;       // boolean
  if (/[.!?]$/.test(a) && a.split(" ").length > 4) return false; // sentence
  if (/,\s|\sand\s|\sor\s|;/.test(a)) return false;  // list/multi-part
  if (a.split(" ").length > 6) return false;         // verbose phrase
  // Question text must not depend on media references the player can't see.
  const q = f.question.toLowerCase();
  if (/\b(pictured|shown|above|below|this image|this picture|this audio|this video|highlighted|seen here)\b/.test(q)) return false;
  return true;
}

function pickFacts(all: SourceFact[], n: number): SourceFact[] {
  const usable = all.filter(isUsableFact);
  // Stratify by difficulty to give Claude balanced material to choose from.
  const easy = shuffle(usable.filter((f) => f.difficulty === "easy"));
  const med = shuffle(usable.filter((f) => f.difficulty === "medium"));
  const hard = shuffle(usable.filter((f) => f.difficulty === "hard"));
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

    // Mechanical post-generation filters: catch the failure modes Claude
    // sometimes slips on despite the prompt — answer leakage, sentence
    // answers, list answers. Drop offending clues; drop the whole category
    // if it falls below 5.
    const validateAnswer = (answer: string) => {
      const a = answer.trim();
      if (!a || a.length > 60) return false;
      if (/^(true|false)$/i.test(a)) return false;
      if (/[.!?]$/.test(a) && a.split(" ").length > 4) return false;
      if (/,\s|\sand\s|\sor\s|;/.test(a) && a.split(" ").length > 5) return false;
      return true;
    };
    const noLeak = (clue: string, answer: string) => {
      // Reject if the answer appears verbatim (case-insensitive) inside the clue.
      // Allow very short answers (1–3 chars) since those create false positives.
      if (answer.length <= 3) return true;
      return !clue.toLowerCase().includes(answer.toLowerCase());
    };

    let droppedClues = 0, droppedCats = 0, droppedFinals = 0;
    const cleanedCats = (parsed.categories ?? []).map((c) => {
      const seenFacts = new Set<string>();
      const cleaned = (c.clues ?? []).filter((cl) => {
        if (!validateAnswer(cl.answer)) { droppedClues++; return false; }
        if (!noLeak(cl.clue, cl.answer)) { droppedClues++; return false; }
        if (seenFacts.has(cl.source_id)) { droppedClues++; return false; }  // no within-category fact reuse
        seenFacts.add(cl.source_id);
        return true;
      });
      if (cleaned.length < 5) droppedCats++;
      return { ...c, clues: cleaned };
    }).filter((c) => c.clues.length === 5);

    const cleanedFinals = (parsed.finals ?? []).filter((f) => {
      if (!validateAnswer(f.answer)) { droppedFinals++; return false; }
      if (!noLeak(f.clue, f.answer)) { droppedFinals++; return false; }
      return true;
    });
    if (droppedClues || droppedCats || droppedFinals) {
      console.log(`  filters: dropped ${droppedClues} clues, ${droppedCats} categories, ${droppedFinals} finals`);
    }

    const newCats = cleanedCats;
    const newFinals = cleanedFinals;
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
