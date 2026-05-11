/**
 * Preview a pre-staged daily_boards row.
 *
 *   - Loads the row for the given date.
 *   - Resolves every referenced clue_id, daily_double_clue_id, and
 *     final_clue_id against the live `clues` table.
 *   - Flags any missing references (would cause a fallback to
 *     algorithmic generation in production).
 *   - Prints full clue + answer text grouped by category.
 *
 * Run with:  cd clueboard && npm run preview-board -- 2026-05-12
 */

import { createClient } from "@supabase/supabase-js";

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:  (s: string) => `\x1b[2m${s}\x1b[0m`,
  red:  (s: string) => `\x1b[31m${s}\x1b[0m`,
  green:(s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow:(s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: npm run preview-board -- 2026-05-12");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  // 1. Load the daily_boards row
  const { data: board, error: e1 } = await client
    .from("daily_boards")
    .select("date, categories, clue_ids, final_clue_id, daily_double_clue_id, seed, created_at")
    .eq("date", date)
    .maybeSingle();
  if (e1) { console.error("Query failed:", e1.message); process.exit(1); }
  if (!board) {
    console.log(C.yellow(`No daily_boards row exists for ${date}.`));
    console.log(C.dim("→ At midnight ET on that date, the board will be algorithmically generated from the live clue pool and persisted on first request."));
    process.exit(0);
  }

  console.log(C.bold(`\nBoard staged for ${date}`));
  console.log(C.dim(`Created: ${board.created_at}`));
  console.log(C.dim(`Seed:    ${board.seed}`));

  // 2. Fetch every clue referenced by this board
  const allIds = [...new Set([...board.clue_ids, board.final_clue_id, board.daily_double_clue_id].filter(Boolean))];
  const { data: clues, error: e2 } = await client
    .from("clues")
    .select("id, category, value, clue, answer, round")
    .in("id", allIds);
  if (e2) { console.error("Clue query failed:", e2.message); process.exit(1); }

  const byId = new Map<number, typeof clues[number]>();
  for (const c of clues ?? []) byId.set(c.id, c);

  // 3. Integrity checks
  console.log(C.bold(`\nIntegrity checks`));
  const missing: number[] = [];
  for (const id of board.clue_ids) if (!byId.has(id)) missing.push(id);
  if (!byId.has(board.final_clue_id)) missing.push(board.final_clue_id);
  if (board.daily_double_clue_id && !byId.has(board.daily_double_clue_id)) missing.push(board.daily_double_clue_id);

  if (missing.length === 0) {
    console.log(C.green(`  ✓ All ${allIds.length} referenced clue IDs resolve to rows in clues table`));
  } else {
    console.log(C.red(`  ✗ ${missing.length} missing clue IDs: ${missing.join(", ")}`));
    console.log(C.red(`  → This board would FALL BACK to algorithmic generation on its date.`));
  }

  if (board.daily_double_clue_id) {
    const ddInList = board.clue_ids.includes(board.daily_double_clue_id);
    if (ddInList) console.log(C.green(`  ✓ Daily Double clue is on the board`));
    else console.log(C.red(`  ✗ Daily Double clue id ${board.daily_double_clue_id} is NOT in clue_ids`));
  }

  const finalRow = byId.get(board.final_clue_id);
  if (finalRow && finalRow.round !== "final") {
    console.log(C.yellow(`  ⚠ Final clue id ${board.final_clue_id} has round="${finalRow.round}" (expected "final")`));
  }

  // 4. Render the board
  console.log(C.bold(`\nCategories (${board.categories.length})`));
  for (const cat of board.categories) {
    const cells = (clues ?? [])
      .filter((c) => c.category === cat && c.round === "single")
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    console.log(`\n  ${C.cyan(C.bold(cat))}`);
    for (const cell of cells) {
      const isDD = cell.id === board.daily_double_clue_id;
      const marker = isDD ? C.yellow(" ★ DD") : "";
      console.log(`    $${cell.value}${marker}`);
      console.log(`      ${cell.clue}`);
      console.log(C.dim(`      → ${cell.answer}    [id ${cell.id}]`));
    }
  }

  // 5. Final clue
  console.log(C.bold(`\nFinal Clue`));
  if (finalRow) {
    console.log(`  ${C.cyan(C.bold(finalRow.category))}`);
    console.log(`    ${finalRow.clue}`);
    console.log(C.dim(`    → ${finalRow.answer}    [id ${finalRow.id}]`));
  } else {
    console.log(C.red(`  ✗ Final clue id ${board.final_clue_id} not found`));
  }

  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
