/**
 * Delete clue rows by category title from Supabase. Use to curate
 * which categories are live in the production bank.
 *
 * Run with:  cd clueboard && npx tsx --env-file=.env.local scripts/delete-categories.ts \
 *              "CATEGORY A" "CATEGORY B" ...
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const titles = process.argv.slice(2);
  if (titles.length === 0) {
    console.error('Usage: npx tsx scripts/delete-categories.ts "CATEGORY A" "CATEGORY B" ...');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  for (const title of titles) {
    const { data: existing } = await client
      .from("clues")
      .select("id")
      .eq("category", title);
    const count = existing?.length ?? 0;
    if (count === 0) {
      console.log(`  ${title}: no rows found`);
      continue;
    }
    const { error } = await client.from("clues").delete().eq("category", title);
    if (error) {
      console.error(`  ${title}: delete failed —`, error.message);
    } else {
      console.log(`  ${title}: deleted ${count} rows`);
    }
  }

  // Final summary
  const { count: total } = await client
    .from("clues")
    .select("*", { count: "exact", head: true });
  console.log(`\nClues remaining in DB: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
