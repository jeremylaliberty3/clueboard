/**
 * One-shot cleanup: for each (category, value, round) tuple in the
 * `clues` table that has more than one row, keep ONE and delete the
 * rest. Preference order for which to keep:
 *   1. Any id currently referenced by a `daily_boards` row
 *      (so we don't break a staged or past board).
 *   2. Otherwise, the lowest id (= the first one we ever imported).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/dedupe-clues.ts --dry
 *   npx tsx --env-file=.env.local scripts/dedupe-clues.ts
 */

import { createClient } from "@supabase/supabase-js";

async function fetchAll(supabase: any, table: string, select: string, filter?: (q: any) => any) {
  let all: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  if (!url || !key) {
    console.error("Missing env vars.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 1. Set of clue_ids referenced by any daily_boards row.
  const { data: boards } = await supabase
    .from("daily_boards")
    .select("date, clue_ids, final_clue_id, daily_double_clue_id");
  const referenced = new Set<number>();
  for (const b of boards ?? []) {
    for (const id of b.clue_ids ?? []) referenced.add(id);
    if (b.final_clue_id != null) referenced.add(b.final_clue_id);
    if (b.daily_double_clue_id != null) referenced.add(b.daily_double_clue_id);
  }
  console.log(`daily_boards: ${boards?.length ?? 0} rows, ${referenced.size} clue ids in use`);

  // 2. All single-round clues (paginated).
  const clues = await fetchAll(supabase, "clues", "id, category, value, round");
  console.log(`clues table: ${clues.length} total rows`);

  // 3. Bucket by (category, value, round).
  const buckets = new Map<string, number[]>();
  for (const r of clues) {
    if (r.round !== "single") continue;
    const k = `${r.category}|${r.value}|${r.round}`;
    const arr = buckets.get(k) ?? [];
    arr.push(r.id);
    buckets.set(k, arr);
  }

  const toDelete: number[] = [];
  const keepDecisions: Array<{ tuple: string; keep: number; remove: number[] }> = [];
  for (const [k, ids] of buckets) {
    if (ids.length === 1) continue;
    // Sort by id ascending so the default "keep lowest" works.
    ids.sort((a, b) => a - b);
    const referencedOnes = ids.filter((id) => referenced.has(id));
    const keep = referencedOnes.length > 0 ? referencedOnes[0] : ids[0];
    const remove = ids.filter((id) => id !== keep);
    // If multiple are referenced, keep the first and warn — but don't
    // delete the others (would break a board).
    if (referencedOnes.length > 1) {
      console.log(
        `  ⚠ tuple ${k} has ${referencedOnes.length} ids referenced by boards (${referencedOnes.join(",")}). Keeping ${keep}, skipping the rest from deletion to avoid breaking boards.`,
      );
      const safeRemove = remove.filter((id) => !referenced.has(id));
      toDelete.push(...safeRemove);
      keepDecisions.push({ tuple: k, keep, remove: safeRemove });
    } else {
      toDelete.push(...remove);
      keepDecisions.push({ tuple: k, keep, remove });
    }
  }

  console.log(`\nDuplicate tuples: ${keepDecisions.length}`);
  console.log(`Rows to delete:    ${toDelete.length}`);

  if (dry) {
    console.log("\nFirst 5 deletion plans:");
    for (const d of keepDecisions.slice(0, 5)) {
      console.log(`  ${d.tuple}: keep ${d.keep}, delete ${d.remove.join(",")}`);
    }
    console.log("\nDry-run only — no DB writes. Re-run without --dry to delete.");
    return;
  }

  if (toDelete.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  console.log("\nDeleting…");
  const CHUNK = 100;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK);
    const { error } = await supabase.from("clues").delete().in("id", chunk);
    if (error) {
      console.error(`\nDelete failed at offset ${i}:`, error);
      process.exit(1);
    }
    deleted += chunk.length;
    process.stdout.write(`\r  deleted ${deleted}/${toDelete.length} `);
  }
  process.stdout.write("\n");
  console.log(`\n✓ Deleted ${deleted} duplicate clue rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
