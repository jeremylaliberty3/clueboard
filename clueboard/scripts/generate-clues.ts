/**
 * Stage 2: Have Claude design Jeopardy-style categories and rewrite source
 * facts as authentic clues with $200–$1000 difficulty progression.
 *
 * Inputs:   clueboard/data/sources.json     (from fetch-sources)
 *           ANTHROPIC_API_KEY               (from .env.local)
 *
 * Outputs:  clueboard/data/generated/<batch_id>.json  — the batch
 *           clueboard/data/used_source_ids.json       — global dedup index
 *
 * Run with:  cd clueboard && npm run generate-clues -- --categories 10 --finals 5
 *            cd clueboard && npm run generate-clues -- --topic SCIENCE --categories 5
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
const USED_IDS = join(DATA_DIR, "used_source_ids.json");

// ----- topic taxonomy -----
export const TOPICS = [
  "HISTORY", "GEOGRAPHY", "SCIENCE", "POP_CULTURE", "MUSIC",
  "LITERATURE", "ARTS", "SPORTS", "FOOD_DRINK", "LANGUAGE",
  "WORDPLAY", "MYTHOLOGY", "TECHNOLOGY", "ANIMALS_NATURE", "MISC",
] as const;
export type Topic = typeof TOPICS[number];

// Hint Claude which source-fact categories naturally feed each topic. The
// strings are substrings checked case-insensitively against source_fact.category.
const TOPIC_SOURCE_HINTS: Record<Topic, string[]> = {
  HISTORY:        ["history"],
  GEOGRAPHY:      ["geograph"],
  SCIENCE:        ["science"],
  POP_CULTURE:    ["film", "tv", "society", "celebrit", "general"],
  MUSIC:          ["music"],
  LITERATURE:     ["arts_and_literature", "literature", "book"],
  ARTS:           ["arts"],
  SPORTS:         ["sport"],
  FOOD_DRINK:     ["food", "drink"],
  LANGUAGE:       ["general", "society"],
  WORDPLAY:       [], // Claude picks fact-fits regardless of category
  MYTHOLOGY:      ["mytholog", "religion"],
  TECHNOLOGY:     ["technology", "computer", "tech"],
  ANIMALS_NATURE: ["animal", "nature"],
  MISC:           [],
};

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

type CategoryStyle = "knowledge" | "wordplay" | "themed";
type DifficultyProfile = "easy_leaning" | "balanced" | "hard_leaning";

type GeneratedCategory = {
  title: string;
  theme: string;
  topic: Topic;
  category_style: CategoryStyle;
  difficulty_profile: DifficultyProfile;
  clues: GeneratedClue[];
};

type GeneratedFinal = {
  title: string;
  topic: Topic;
  clue: string;
  answer: string;
  source_id: string;
};

type GenerationBatch = {
  batch_id: string;
  generated_at: string;
  model: string;
  topic_filter: Topic | null;
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

Returning fewer categories than requested is the CORRECT, EXPECTED behavior when source facts don't support more.

═══════════════════════════════════════════════════════
THE SIX INVIOLABLE RULES
═══════════════════════════════════════════════════════

RULE 1 — STAY ON THEME.
Every clue in a category MUST satisfy the theme. THEMES MUST DECLARE THE ANSWER TYPE — bad: "Famous movie quotes." Good: "Famous movie quotes — answer is the FILM TITLE in which the line was spoken." If you can't write the theme as "[topic] — answer is [the X]", reject it.

RULE 2 — GROUNDING IS MECHANICAL.
The clue's answer MUST match the source fact's answer in canonical form. Don't invent details, change spellings, or combine facts. If wanting to write something the fact doesn't support, pick a different fact.

RULE 3 — ANSWER FORM.
Every answer must be: a proper noun, a 1–4 word common noun phrase, a number/year, or a single-word verb/adjective for wordplay categories.
NEVER: a sentence, "True"/"False", a list, or the literal word the clue is defining.

RULE 4 — CLUE FORM.
Declarative statement (not a question). 1–2 sentences, ~60–200 chars. No media references ("shown above"). No show-specific trademarks ("Jeopardy!").

RULE 5 — DIFFICULTY MONOTONICITY.
$200 → $1000 increasing difficulty. $200 = pop-culture-common, $1000 = niche/specialized. Noticeable leap from $800 to $1000.

RULE 6 — NO ANSWER LEAKAGE.
The answer string must NOT appear (case-insensitive) inside the clue text. If it does, rewrite the clue or pick a different fact.

═══════════════════════════════════════════════════════
NEW: CATEGORY METADATA YOU MUST OUTPUT
═══════════════════════════════════════════════════════

Each category must declare these three fields in addition to title/theme/clues:

"topic": one of HISTORY, GEOGRAPHY, SCIENCE, POP_CULTURE, MUSIC, LITERATURE, ARTS, SPORTS, FOOD_DRINK, LANGUAGE, WORDPLAY, MYTHOLOGY, TECHNOLOGY, ANIMALS_NATURE, MISC.
  - HISTORY = events, eras, leaders. Includes US presidents, dynasties, wars.
  - POP_CULTURE = movies, TV, celebrities, internet culture (NOT music — that has its own topic).
  - MUSIC = songs, artists, instruments, classical, pop, rock.
  - LITERATURE = novels, plays, poets, characters, opening lines.
  - ARTS = visual art, sculpture, theater, museums (NOT literature).
  - LANGUAGE = etymology, vocabulary, grammar, foreign words.
  - WORDPLAY = the answer or theme involves linguistic structure (anagrams, "starts & ends with X", "all answers are 4-letter words", puns).
  - MISC = doesn't fit cleanly elsewhere (holidays, brands, currencies, board games).

"category_style": one of "knowledge", "wordplay", "themed".
  - knowledge: pure topic-based facts, e.g. "WORLD CAPITALS" or "FAMOUS PHYSICISTS"
  - wordplay: the answers share a linguistic constraint, e.g. "ANSWERS THAT END IN -ITION" or "5-LETTER ANIMAL NAMES"
  - themed: a creative non-topical constraint that's not pure wordplay, e.g. "BEFORE & AFTER" or "FAMOUS DUOS" or "FIRSTS"

"difficulty_profile": one of "easy_leaning", "balanced", "hard_leaning".
  - easy_leaning: $200 is genuinely easy and even $1000 is approachable for a casual player. Pop-culture-heavy, school-curriculum-heavy.
  - balanced: smooth ramp from accessible to challenging. The default for most categories.
  - hard_leaning: $200 already requires some specific knowledge; $1000 is genuinely niche. For deep-domain categories.

═══════════════════════════════════════════════════════
WORKED EXAMPLE
═══════════════════════════════════════════════════════

Theme: "World capitals on rivers — answer is the CAPITAL CITY"
$200  This British capital, home of Big Ben, sits on the Thames.                        → London
$400  France's capital, host of the 2024 Olympics, sits on the Seine.                   → Paris
$600  Hungary's capital, an amalgam of two cities on the Danube, has thermal baths.     → Budapest
$800  Iraq's capital, founded in 762 AD on the Tigris, was the heart of the Abbasid caliphate. → Baghdad
$1000 Mali's capital, sitting on the Niger, shares its name with a hippopotamus.        → Bamako

Metadata: topic=GEOGRAPHY, category_style=knowledge, difficulty_profile=balanced.

═══════════════════════════════════════════════════════
ANTI-PATTERNS — REJECT YOUR OWN OUTPUT IF
═══════════════════════════════════════════════════════

✗  A clue's answer is "True", "False", a sentence, or a list of items.
✗  A clue defines its own answer ("This term, 'diphthong', refers to...").
✗  A category's theme is "British monarchs" but the $1000 clue is about Mussolini.
✗  You invent a word that isn't in the source fact (e.g. "Azuro" for Italian "blue").
✗  Two clues in the same category use the same source fact.
✗  A category's declared topic doesn't actually match its content.

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════

Return ONLY strict JSON, no markdown fences, no prose. The exact shape:

{
  "categories": [
    {
      "title": "POTENT POTABLES",
      "theme": "Famous alcoholic drinks and their origins — answer is the SPIRIT or DRINK",
      "topic": "FOOD_DRINK",
      "category_style": "knowledge",
      "difficulty_profile": "balanced",
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
      "topic": "HISTORY",
      "clue": "In 1963, this American civil rights leader delivered a speech beginning 'I have a dream' from the Lincoln Memorial steps.",
      "answer": "Martin Luther King Jr.",
      "source_id": "tapi:..."
    }
  ]
}

Categories with fewer than 5 clues will be discarded by the caller.`;

const USER_PROMPT_TEMPLATE = (
  numCategories: number,
  numFinals: number,
  facts: SourceFact[],
  topicFilter: Topic | null,
) => {
  const factLines = facts.map((f) =>
    `[${f.source_id}] (${f.difficulty}, ${f.category}) Q: ${f.question} | A: ${f.answer}`
  ).join("\n");
  const topicHeader = topicFilter
    ? `\nALL categories must have topic="${topicFilter}". Design themes that genuinely fit this topic.\n`
    : `\nVary the categories: don't make all from the same topic. Mix wordplay/themed with pure-knowledge categories.\n`;
  return `Design ${numCategories} categories and ${numFinals} final clue${numFinals === 1 ? "" : "s"}.
${topicHeader}
Each category needs 5 clues spanning $200–$1000. Each final clue should be challenging — the kind of thing a player wagers on at the end of a board.

Available source facts (use ONLY these for grounding):

${factLines}

Return strict JSON now, including topic, category_style, and difficulty_profile fields per category.`;
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

function factMatchesTopic(fact: SourceFact, topic: Topic): boolean {
  const hints = TOPIC_SOURCE_HINTS[topic];
  if (hints.length === 0) return true; // WORDPLAY/MISC accept anything usable
  const cat = fact.category.toLowerCase();
  return hints.some((h) => cat.includes(h));
}

function pickFacts(
  all: SourceFact[],
  n: number,
  excludeIds: Set<string>,
  topic: Topic | null,
): SourceFact[] {
  let usable = all.filter(isUsableFact).filter((f) => !excludeIds.has(f.source_id));
  if (topic) {
    const matching = usable.filter((f) => factMatchesTopic(f, topic));
    // Use topic-matched facts if there are enough; otherwise fall through with all.
    if (matching.length >= n) usable = matching;
  }
  const easy = shuffle(usable.filter((f) => f.difficulty === "easy"));
  const med  = shuffle(usable.filter((f) => f.difficulty === "medium"));
  const hard = shuffle(usable.filter((f) => f.difficulty === "hard"));
  const each = Math.floor(n / 3);
  return shuffle([...easy.slice(0, each), ...med.slice(0, each), ...hard.slice(0, n - 2 * each)]);
}

function parseStrictJSON(s: string): unknown {
  const stripped = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(stripped);
}

function shortBatchId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function loadUsedIds(): Promise<Set<string>> {
  if (!existsSync(USED_IDS)) return new Set();
  try {
    const arr = JSON.parse(await readFile(USED_IDS, "utf8")) as string[];
    return new Set(arr);
  } catch { return new Set(); }
}

async function saveUsedIds(ids: Set<string>) {
  await writeFile(USED_IDS, JSON.stringify(Array.from(ids).sort(), null, 2));
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
  const topicArg = argMap.get("topic")?.toUpperCase() as Topic | undefined;
  if (topicArg && !TOPICS.includes(topicArg as Topic)) {
    console.error(`Unknown topic "${topicArg}". Valid: ${TOPICS.join(", ")}`);
    process.exit(1);
  }
  const topic: Topic | null = topicArg ?? null;

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
  const usedIds = await loadUsedIds();
  console.log(`Loaded ${sources.length} source facts. Already-used: ${usedIds.size}.`);
  console.log(`Plan: ${numCategories} categories${topic ? ` (topic=${topic})` : ""} + ${numFinals} finals, ${categoriesPerCall} per call (model: ${model}).`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const collectedCategories: GeneratedCategory[] = [];
  const collectedFinals: GeneratedFinal[] = [];

  let remainingCategories = numCategories;
  let remainingFinals = numFinals;
  let callIdx = 0;
  let consecutiveEmpty = 0;

  while ((remainingCategories > 0 || remainingFinals > 0) && consecutiveEmpty < 3) {
    callIdx++;
    const cThisCall = Math.min(remainingCategories, categoriesPerCall);
    const fThisCall = Math.min(
      remainingFinals,
      Math.max(1, Math.ceil(numFinals / Math.max(1, Math.ceil(numCategories / categoriesPerCall)))),
    );
    if (cThisCall === 0 && fThisCall === 0) break;

    const facts = pickFacts(sources, factsPerCall, usedIds, topic);
    if (facts.length < 25) {
      console.warn(`  source pool exhausted for topic=${topic ?? "any"} (${facts.length} candidates). Stopping.`);
      break;
    }
    const userPrompt = USER_PROMPT_TEMPLATE(cThisCall, fThisCall, facts, topic);

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
      consecutiveEmpty++;
      continue;
    }

    // Mechanical post-generation filters.
    const validateAnswer = (answer: string) => {
      const a = answer.trim();
      if (!a || a.length > 60) return false;
      if (/^(true|false)$/i.test(a)) return false;
      if (/[.!?]$/.test(a) && a.split(" ").length > 4) return false;
      if (/,\s|\sand\s|\sor\s|;/.test(a) && a.split(" ").length > 5) return false;
      return true;
    };
    const noLeak = (clue: string, answer: string) => {
      if (answer.length <= 3) return true;
      return !clue.toLowerCase().includes(answer.toLowerCase());
    };
    const validTopic = (t: unknown) => typeof t === "string" && (TOPICS as readonly string[]).includes(t);
    const validStyle = (s: unknown): s is CategoryStyle => s === "knowledge" || s === "wordplay" || s === "themed";
    const validProfile = (p: unknown): p is DifficultyProfile => p === "easy_leaning" || p === "balanced" || p === "hard_leaning";

    let droppedClues = 0, droppedCats = 0, droppedFinals = 0;
    const cleanedCats = (parsed.categories ?? []).map((c) => {
      // Default missing metadata to safe values rather than dropping the
      // category outright. Topic mismatches relative to the requested topic
      // are caught by the caller.
      if (!validTopic(c.topic)) c.topic = topic ?? "MISC";
      if (!validStyle(c.category_style)) c.category_style = "knowledge";
      if (!validProfile(c.difficulty_profile)) c.difficulty_profile = "balanced";

      const seenFacts = new Set<string>();
      const cleaned = (c.clues ?? []).filter((cl) => {
        if (!validateAnswer(cl.answer)) { droppedClues++; return false; }
        if (!noLeak(cl.clue, cl.answer)) { droppedClues++; return false; }
        if (seenFacts.has(cl.source_id)) { droppedClues++; return false; }
        if (usedIds.has(cl.source_id)) { droppedClues++; return false; }
        seenFacts.add(cl.source_id);
        return true;
      });
      if (cleaned.length < 5) droppedCats++;
      return { ...c, clues: cleaned };
    }).filter((c) => c.clues.length === 5);

    const cleanedFinals = (parsed.finals ?? []).filter((f) => {
      if (!validateAnswer(f.answer)) { droppedFinals++; return false; }
      if (!noLeak(f.clue, f.answer)) { droppedFinals++; return false; }
      if (usedIds.has(f.source_id)) { droppedFinals++; return false; }
      if (!validTopic(f.topic)) f.topic = topic ?? "MISC";
      return true;
    });

    if (droppedClues || droppedCats || droppedFinals) {
      console.log(`  filters: dropped ${droppedClues} clues, ${droppedCats} categories, ${droppedFinals} finals`);
    }

    // Mark new source IDs as used so subsequent batches won't reuse them.
    for (const cat of cleanedCats) {
      for (const cl of cat.clues) usedIds.add(cl.source_id);
    }
    for (const f of cleanedFinals) usedIds.add(f.source_id);
    await saveUsedIds(usedIds);

    collectedCategories.push(...cleanedCats);
    collectedFinals.push(...cleanedFinals);
    remainingCategories -= cleanedCats.length;
    remainingFinals -= cleanedFinals.length;
    console.log(`  collected ${cleanedCats.length} categories (${collectedCategories.length}/${numCategories}), ${cleanedFinals.length} finals (${collectedFinals.length}/${numFinals})`);

    if (cleanedCats.length === 0 && cleanedFinals.length === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
    }
  }

  if (consecutiveEmpty >= 3) {
    console.warn("\n  three empty batches in a row — bailing out.");
  }

  const batch: GenerationBatch = {
    batch_id: shortBatchId() + (topic ? `-${topic.toLowerCase()}` : ""),
    generated_at: new Date().toISOString(),
    model,
    topic_filter: topic,
    categories: collectedCategories,
    finals: collectedFinals,
  };
  const outPath = join(OUT_DIR, `${batch.batch_id}.json`);
  await writeFile(outPath, JSON.stringify(batch, null, 2));
  console.log(`\nWrote batch to ${outPath}`);
  console.log(`Summary: ${collectedCategories.length} categories, ${collectedFinals.length} finals.`);
  console.log(`Used-IDs index now has ${usedIds.size} entries.`);
  console.log(`\nNext: review with \`npm run review ${batch.batch_id}\``);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
