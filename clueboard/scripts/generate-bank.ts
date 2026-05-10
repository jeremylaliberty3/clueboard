/**
 * Orchestrator: build the full clue bank by walking the topic taxonomy.
 * Calls generate-clues.ts as a child process for each topic in turn.
 *
 * Run with:  cd clueboard && npm run generate-bank -- --target-per-topic 33
 *            cd clueboard && npm run generate-bank -- --topics SCIENCE,SPORTS --target-per-topic 5
 *
 * The script is incremental: each topic's batches are saved as separate
 * JSON files, and the global used_source_ids.json is updated after each
 * call. You can stop/resume at any time.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const GEN_DIR = join(SCRIPT_DIR, "..", "data", "generated");

const ALL_TOPICS = [
  "HISTORY", "GEOGRAPHY", "SCIENCE", "POP_CULTURE", "MUSIC",
  "LITERATURE", "ARTS", "SPORTS", "FOOD_DRINK", "LANGUAGE",
  "WORDPLAY", "MYTHOLOGY", "TECHNOLOGY", "ANIMALS_NATURE", "MISC",
] as const;

type Topic = typeof ALL_TOPICS[number];

// Per-topic targets when total is split unevenly. WORDPLAY and MISC are
// thinner because they need creative work; SPORTS source pool is small.
const TOPIC_WEIGHTS: Record<Topic, number> = {
  HISTORY: 1.2, GEOGRAPHY: 1.2, SCIENCE: 1.2, POP_CULTURE: 1.2, MUSIC: 1.2,
  LITERATURE: 1.0, ARTS: 0.8, SPORTS: 0.6, FOOD_DRINK: 0.8, LANGUAGE: 0.7,
  WORDPLAY: 0.5, MYTHOLOGY: 0.7, TECHNOLOGY: 0.8, ANIMALS_NATURE: 0.8, MISC: 0.6,
};

async function existingCategoriesForTopic(topic: Topic): Promise<number> {
  if (!existsSync(GEN_DIR)) return 0;
  const files = (await readdir(GEN_DIR)).filter((f) => f.endsWith(".json") && !f.endsWith(".approved.json"));
  let total = 0;
  for (const f of files) {
    try {
      const data = JSON.parse(await readFile(join(GEN_DIR, f), "utf8")) as
        { topic_filter?: string | null; categories?: { topic?: string }[] };
      const cats = data.categories ?? [];
      total += cats.filter((c) => c.topic === topic || (data.topic_filter === topic && !c.topic)).length;
    } catch { /* ignore unreadable batch files */ }
  }
  return total;
}

function runGenerate(topic: Topic, categories: number, finals: number, model: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      "tsx", "--env-file=.env.local", "scripts/generate-clues.ts",
      "--topic", topic,
      "--categories", String(categories),
      "--finals", String(finals),
      "--model", model,
    ];
    console.log(`\n=== Topic: ${topic} (target +${categories} cats, +${finals} finals) ===`);
    const child = spawn("npx", args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const argMap = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) argMap.set(args[i].slice(2), args[i + 1] ?? "true");
  }
  const targetPerTopic = parseInt(argMap.get("target-per-topic") ?? "33", 10);
  const finalsPerTopic = parseInt(argMap.get("finals-per-topic") ?? "7", 10);
  const model = argMap.get("model") ?? "claude-sonnet-4-6";
  const topicsArg = argMap.get("topics");
  const topics: Topic[] = topicsArg
    ? topicsArg.split(",").map((s) => s.trim().toUpperCase() as Topic)
                .filter((t) => (ALL_TOPICS as readonly string[]).includes(t))
    : [...ALL_TOPICS];

  console.log(`Bank build plan:`);
  console.log(`  Topics: ${topics.join(", ")}`);
  console.log(`  Target per topic: ${targetPerTopic} categories + ${finalsPerTopic} finals`);
  console.log(`  Model: ${model}`);

  for (const topic of topics) {
    const weight = TOPIC_WEIGHTS[topic];
    const want = Math.round(targetPerTopic * weight);
    const wantFinals = Math.round(finalsPerTopic * weight);
    const have = await existingCategoriesForTopic(topic);
    const needCats = Math.max(0, want - have);
    if (needCats === 0) {
      console.log(`\n=== Topic: ${topic} — already at ${have}/${want}, skipping ===`);
      continue;
    }
    console.log(`\n=== Topic: ${topic} — ${have}/${want}, generating ${needCats} more ===`);
    const code = await runGenerate(topic, needCats, wantFinals, model);
    if (code !== 0) {
      console.warn(`  generate-clues exited with code ${code}; continuing.`);
    }
  }

  console.log("\n✓ Bank build pass complete.");
  console.log("Next: review with `npm run review` (per batch_id) then `npm run import-clues`.");
}

main().catch((e) => { console.error(e); process.exit(1); });
