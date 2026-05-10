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
  fit_justification: string;
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
  fit_justification: string;
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

You take VERIFIED FACTUAL QUESTION/ANSWER PAIRS and organize them into Jeopardy-style categories. You do NOT invent facts. You do NOT rewrite answers. You ONLY pick clusters of facts that share an obvious, mechanically-verifiable theme.

═══════════════════════════════════════════════════════
META-RULE: DISCOVER, DON'T INVENT
═══════════════════════════════════════════════════════

This is the most important rule. Read it twice.

WRONG WORKFLOW: "I'll design a clever category like 'MOVIE QUOTES'. Now let me find 5 facts that I can frame as fitting."

CORRECT WORKFLOW: "Let me scan the facts. Do I see 5+ facts whose questions LITERALLY contain a movie quote and whose answers are film titles? If yes → category. If no → keep scanning for other clusters."

You are NOT looking for facts that COULD be framed as fitting a theme. You are looking for facts that ALREADY mechanically demonstrate the theme in their literal text.

If you can only find 3 strong fits for a theme you like, DROP that theme entirely. The caller would rather have 4 great categories than 7 mixed-quality ones. Returning fewer than requested is the correct, expected behavior.

═══════════════════════════════════════════════════════
STRICT FIT — WHAT COUNTS AS MECHANICALLY VERIFIABLE
═══════════════════════════════════════════════════════

For every clue you include, you MUST be able to write a "fit_justification" string that points to SPECIFIC TEXT in the source fact that proves the fit. The justification quotes or names what you see in the source.

GOOD fit + good justification:
  Theme: "Movie quotes — answer is the FILM that contains the quote"
  Source: Q="Which film features the line 'You're gonna need a bigger boat'?" A="Jaws"
  fit_justification: "Source question literally contains the quoted line 'You're gonna need a bigger boat'; source answer 'Jaws' is a film title."
  ✓ Justification names specific source text.

BAD fit (REJECT, don't include):
  Theme: "Movie quotes"
  Source: Q="What 1975 Spielberg film features a great white shark?" A="Jaws"
  fit_justification (would be): "This is about Jaws, a movie famous for the bigger-boat quote."
  ✗ The source question doesn't contain any quote. You're filling in the theme from outside knowledge. REJECT.

GOOD fit examples:
- Theme "Years — answer is a YEAR": source answer matches the pattern of a 4-digit year (e.g. "1989").
- Theme "Answers starting with M": source answer's first letter is literally M.
- Theme "5-letter answers": source answer is exactly 5 letters, no spaces.
- Theme "Scientific names": source question contains "scientific name" or "Latin name" or "binomial".
- Theme "Capitals — answer is the CAPITAL CITY": source question contains "capital" AND source answer is named as a capital.
- Theme "Olympics — answer is the HOST CITY": source question contains "Olympics" or "Olympic Games", source answer is a city.

BAD fits (always REJECT):
- A theme that requires outside knowledge to verify ("answer is a Pulitzer winner" without the source mentioning Pulitzer).
- A theme that's true of the topic but not stated in the source ("Famous physicists" picking facts about Einstein where Einstein is in the answer but the source question is about water).
- Anything where you have to STRETCH the source to make it fit.

If you find yourself wanting to write a fit_justification that says "this relates to..." or "this is adjacent to..." — that fact does not fit. Drop it.

═══════════════════════════════════════════════════════
WORDPLAY / STRUCTURAL THEMES ARE WELCOME
═══════════════════════════════════════════════════════

The strict-fit rule makes wordplay/structural categories VERY achievable, because the fit is mechanical:

- "ANSWERS ENDING IN -TION" → check each answer's last 4 letters. If 5 facts have answers ending in -tion, you have a category.
- "ALL ONE-WORD ANSWERS" → check each answer has no spaces.
- "ANSWERS BEGINNING WITH B" → first letter check.
- "YEAR ANSWERS" → answer is a 4-digit year.
- "BEFORE & AFTER" — these need facts where two of three parts of the answer link. Harder to find naturally; only attempt if the pool has obvious fits.

Mix these in. They satisfy strict-fit easily and add real Jeopardy flavor.

═══════════════════════════════════════════════════════
ADDITIONAL RULES
═══════════════════════════════════════════════════════

RULE A — ANSWER PRESERVATION.
The clue's answer field MUST match the source fact's answer in canonical form. Allowed: drop leading "The/A/An", fix obvious capitalization, trim trailing punctuation. NOT allowed: change spelling, abbreviate, expand abbreviations, swap variants.

RULE B — CLUE TEXT CAN BE REWRITTEN.
You may rewrite the source fact's question as a Jeopardy-style declarative clue. 1–2 sentences, ~60–200 chars. NO media references ("shown above", "pictured"). NO trademark phrases ("Jeopardy!"). The answer must NOT appear (case-insensitive) inside the clue.

RULE C — ANSWER FORM.
Each answer must be: a proper noun, a 1–4 word common noun phrase, a number/year, or a single-word verb/adjective. NOT a sentence, "True"/"False", or a list.

RULE D — DIFFICULTY MONOTONICITY.
Within each category, $200 → $1000 ramps up in difficulty. $200 is pop-culture-common; $1000 is genuinely niche. Noticeable leap from $800 to $1000.

RULE E — NO DUPLICATE FACTS WITHIN A CATEGORY.
Each of the 5 clues in a category uses a distinct source_id.

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
ANTI-PATTERNS — REJECT YOUR OWN OUTPUT IF
═══════════════════════════════════════════════════════

✗  A clue's answer is "True", "False", a sentence, or a list of items.
✗  A clue defines its own answer ("This term, 'diphthong', refers to...").
✗  A category's theme is "British monarchs" but the $1000 clue is about Mussolini.
✗  Two clues in the same category use the same source fact.
✗  A category's declared topic doesn't match its content.
✗  A fit_justification that says "this relates to" or "this is about" without naming specific source text.
✗  A category whose theme can't be mechanically verified from the source facts alone.

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════

CRITICAL: Output STRICT JSON ONLY. Do not write any reasoning, scratch work, "let me scan...", "checking patterns...", or other prose. The first character of your response must be { and the last must be }. If you need to think, do it silently before composing the JSON.

Return ONLY strict JSON, no markdown fences, no prose. The exact shape:

{
  "categories": [
    {
      "title": "ANSWERS ENDING IN -ITION",
      "theme": "Answers all end in the letters -ITION",
      "topic": "WORDPLAY",
      "category_style": "wordplay",
      "difficulty_profile": "balanced",
      "clues": [
        {
          "value": 200,
          "clue": "...",
          "answer": "Tradition",
          "source_id": "tapi:abc",
          "fit_justification": "Source answer 'Tradition' literally ends in -ITION."
        },
        {
          "value": 400,
          "clue": "...",
          "answer": "Nutrition",
          "source_id": "otdb:def",
          "fit_justification": "Source answer 'Nutrition' literally ends in -ITION."
        }
        // ... etc
      ]
    }
  ],
  "finals": [
    {
      "title": "FAMOUS SPEECHES",
      "topic": "HISTORY",
      "clue": "...",
      "answer": "Martin Luther King Jr.",
      "source_id": "tapi:...",
      "fit_justification": "Source question literally references the 'I have a dream' speech and the Lincoln Memorial; answer is MLK."
    }
  ]
}

Categories with fewer than 5 clues will be discarded by the caller. Returning 4 strong categories is better than 7 mixed-quality ones.`;

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
    ? `Target topic: ${topicFilter}. Only output categories with topic="${topicFilter}".\n`
    : `You may output categories of any topic. Mix knowledge with wordplay/themed.\n`;
  return `Scan the source facts below and DISCOVER up to ${numCategories} categories that the facts genuinely support, plus up to ${numFinals} final clue${numFinals === 1 ? "" : "s"}.

${topicHeader}
A category is only valid if you can find 5 source facts whose literal question or answer text demonstrates the theme. For every clue you include, write a fit_justification that names specific text from the source. If a justification reads as a stretch, drop that fact and either find a stronger fit or abandon the category.

If the source pool doesn't support ${numCategories} valid categories, return fewer. The caller would rather have 3 great categories than 5 weak ones.

Wordplay/structural categories are encouraged when the answer pool naturally supports them (e.g. multiple answers ending in the same suffix, multiple year answers, multiple single-word answers in the same letter-class).

Available source facts:

${factLines}

Return strict JSON now, with full metadata (topic, category_style, difficulty_profile) per category and fit_justification on every clue.`;
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

// ============================================================
// Wordplay pre-clustering
// ============================================================
// For WORDPLAY topic generation, instead of asking Claude to scan a
// random pool for patterns, we mechanically pre-cluster facts by
// structural property and hand it ready-made groups to choose from.
// This is what makes wordplay categories reliably feasible.

type WordplayCluster = {
  label: string;       // human-readable cluster name, e.g. "Answers ending in -ITION"
  rule: string;        // mechanical rule, e.g. "answer.toLowerCase().endsWith('ition')"
  facts: SourceFact[]; // facts that match
};

function buildWordplayClusters(usable: SourceFact[]): WordplayCluster[] {
  const out: WordplayCluster[] = [];
  const cleanAnswer = (a: string) => a.trim().replace(/^(the|a|an)\s+/i, "");

  // Year answers
  out.push({
    label: "Year answers (4-digit year)",
    rule: "answer is a 4-digit year",
    facts: usable.filter((f) => /^\d{4}$/.test(cleanAnswer(f.answer))),
  });

  // Single-letter / single-digit answers
  out.push({
    label: "Single-character answers",
    rule: "answer is exactly one character",
    facts: usable.filter((f) => cleanAnswer(f.answer).length === 1),
  });

  // N-letter single-word answers, for N = 3..7
  for (let n = 3; n <= 7; n++) {
    out.push({
      label: `${n}-letter single-word answers`,
      rule: `answer is a single word exactly ${n} letters long`,
      facts: usable.filter((f) => {
        const a = cleanAnswer(f.answer);
        return /^[A-Za-z]+$/.test(a) && a.length === n;
      }),
    });
  }

  // Suffix clusters
  const suffixes = ["tion", "ology", "ism", "ing", "ous", "ery", "ette", "land", "stan"];
  for (const suf of suffixes) {
    out.push({
      label: `Answers ending in -${suf.toUpperCase()}`,
      rule: `answer ends in the letters '${suf}' (case-insensitive)`,
      facts: usable.filter((f) => cleanAnswer(f.answer).toLowerCase().endsWith(suf)),
    });
  }

  // Initial-letter clusters: keep ones with enough fits
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    out.push({
      label: `Answers starting with '${ch}'`,
      rule: `first letter of answer is '${ch}' (case-insensitive)`,
      facts: usable.filter((f) =>
        cleanAnswer(f.answer).toUpperCase().startsWith(ch),
      ),
    });
  }

  // All-caps abbreviation answers (e.g. "DNA", "NATO")
  out.push({
    label: "All-caps abbreviation answers",
    rule: "answer is 2-5 uppercase letters with no spaces",
    facts: usable.filter((f) => /^[A-Z]{2,5}$/.test(cleanAnswer(f.answer))),
  });

  // Numeric answers (not necessarily years)
  out.push({
    label: "Number answers",
    rule: "answer is a number (digits only, with optional decimal)",
    facts: usable.filter((f) => /^\d+(\.\d+)?$/.test(cleanAnswer(f.answer))),
  });

  // Keep only clusters with at least 8 fits (need 5 for a category + buffer
  // for Claude to pick the best 5).
  return out.filter((c) => c.facts.length >= 8);
}

function pickWordplayFacts(
  all: SourceFact[],
  excludeIds: Set<string>,
  numClusters: number,
  perCluster: number,
): { facts: SourceFact[]; clusterHints: string } {
  const usable = all.filter(isUsableFact).filter((f) => !excludeIds.has(f.source_id));
  const clusters = shuffle(buildWordplayClusters(usable));
  const chosen = clusters.slice(0, numClusters);

  if (chosen.length === 0) {
    return { facts: [], clusterHints: "" };
  }

  // For each cluster, include up to perCluster facts in the prompt.
  const facts: SourceFact[] = [];
  const lines: string[] = [];
  for (const cluster of chosen) {
    const sample = shuffle(cluster.facts).slice(0, perCluster);
    facts.push(...sample);
    lines.push(
      `  Cluster "${cluster.label}" (${cluster.rule}):\n` +
      sample.map((f) => `    [${f.source_id}] A: ${f.answer}`).join("\n"),
    );
  }
  const clusterHints =
    "WORDPLAY MODE: The fact pool has been pre-clustered by structural property. " +
    "Pick the strongest cluster (one with the cleanest, most varied 5 answers) and " +
    "build ONE category from it. The category's theme must be exactly the cluster's rule. " +
    "Verify each clue's answer literally matches the rule.\n\n" +
    "Available clusters (showing the answer pattern; full questions are in the main fact list below):\n" +
    lines.join("\n\n");
  return { facts, clusterHints };
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
  const factsPerCall = parseInt(argMap.get("facts") ?? "200", 10);
  const categoriesPerCall = parseInt(argMap.get("per-call") ?? "4", 10);
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

    let facts: SourceFact[];
    let clusterHints = "";
    if (topic === "WORDPLAY") {
      // Wordplay generation uses mechanical pre-clustering instead of a
      // random pool. Claude picks the best cluster and writes 5 strong
      // clues from it.
      const result = pickWordplayFacts(sources, usedIds, /* clusters */ 5, /* per */ 25);
      facts = result.facts;
      clusterHints = result.clusterHints;
      if (facts.length < 25) {
        console.warn(`  no wordplay clusters with enough fits. Stopping.`);
        break;
      }
    } else {
      facts = pickFacts(sources, factsPerCall, usedIds, topic);
      if (facts.length < 25) {
        console.warn(`  source pool exhausted for topic=${topic ?? "any"} (${facts.length} candidates). Stopping.`);
        break;
      }
    }
    const userPrompt = clusterHints
      ? `${clusterHints}\n\n${USER_PROMPT_TEMPLATE(cThisCall, fThisCall, facts, topic)}`
      : USER_PROMPT_TEMPLATE(cThisCall, fThisCall, facts, topic);

    console.log(`\n[call ${callIdx}] requesting ${cThisCall} categories + ${fThisCall} finals…`);
    const t0 = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 12000,
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

    // fit_justification must be present and at least ~30 chars to indicate
    // the model actually wrote something concrete rather than a stock phrase.
    // Stock phrases like "this relates to" or "this is about" are red flags.
    const STOCK_PHRASES = /\b(this relates to|this is about|adjacent to|connected to|associated with the theme)\b/i;
    const validJustification = (j: string | undefined) => {
      if (!j) return false;
      const trimmed = j.trim();
      if (trimmed.length < 30) return false;
      if (STOCK_PHRASES.test(trimmed)) return false;
      return true;
    };

    // Mechanical theme-fit verification for structural categories. We
    // detect the category type from its title and check the answers
    // demonstrate that structure literally.
    const verifyStructuralFit = (title: string, theme: string, answer: string): boolean => {
      const t = `${title} ${theme}`.toLowerCase();
      const a = answer.trim();

      // "Year answers" or "years"
      if (/\byear(s)?\b/.test(t) && /answer/.test(t)) {
        return /^\d{4}$/.test(a);
      }
      // "Ending in -X" or "ends in X"
      const endsIn = t.match(/end(?:ing|s)?\s+(?:in|with)\s+["'`-]?([a-z]{1,6})["'`-]?/i);
      if (endsIn) {
        const suffix = endsIn[1].toLowerCase().replace(/[^a-z]/g, "");
        return a.toLowerCase().replace(/[^a-z]/g, "").endsWith(suffix);
      }
      // "Starts with X" or "beginning with X"
      const startsWith = t.match(/(?:start|begin)(?:ing|s)?\s+with\s+["'`-]?([a-z])["'`-]?/i);
      if (startsWith) {
        const letter = startsWith[1].toLowerCase();
        return a.toLowerCase().startsWith(letter);
      }
      // "N-letter answers" or "N letter words"
      const nLetters = t.match(/(\d+)[-\s]letter/);
      if (nLetters) {
        const n = parseInt(nLetters[1], 10);
        return a.replace(/\s/g, "").length === n;
      }
      // "One-word" / "single-word"
      if (/(one|single)[-\s]word/.test(t)) {
        return !/\s/.test(a);
      }
      // Default: no structural rule detected.
      return true;
    };

    let droppedClues = 0, droppedCats = 0, droppedFinals = 0, droppedJustif = 0, droppedStruct = 0;
    const cleanedCats = (parsed.categories ?? []).map((c) => {
      if (!validTopic(c.topic)) c.topic = topic ?? "MISC";
      if (!validStyle(c.category_style)) c.category_style = "knowledge";
      if (!validProfile(c.difficulty_profile)) c.difficulty_profile = "balanced";

      const seenFacts = new Set<string>();
      const cleaned = (c.clues ?? []).filter((cl) => {
        if (!validateAnswer(cl.answer)) { droppedClues++; return false; }
        if (!noLeak(cl.clue, cl.answer)) { droppedClues++; return false; }
        if (seenFacts.has(cl.source_id)) { droppedClues++; return false; }
        if (usedIds.has(cl.source_id)) { droppedClues++; return false; }
        if (!validJustification(cl.fit_justification)) { droppedJustif++; return false; }
        if (!verifyStructuralFit(c.title, c.theme, cl.answer)) { droppedStruct++; return false; }
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
      if (!validJustification(f.fit_justification)) { droppedFinals++; return false; }
      if (!validTopic(f.topic)) f.topic = topic ?? "MISC";
      return true;
    });

    if (droppedClues || droppedCats || droppedFinals || droppedJustif || droppedStruct) {
      const parts: string[] = [];
      if (droppedClues) parts.push(`${droppedClues} clues (basic)`);
      if (droppedJustif) parts.push(`${droppedJustif} clues (weak fit_justification)`);
      if (droppedStruct) parts.push(`${droppedStruct} clues (structural mismatch)`);
      if (droppedCats) parts.push(`${droppedCats} categories (below 5 clues)`);
      if (droppedFinals) parts.push(`${droppedFinals} finals`);
      console.log(`  filters: dropped ${parts.join(", ")}`);
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
