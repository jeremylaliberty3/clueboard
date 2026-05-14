import { createClient } from "@supabase/supabase-js";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const c = createClient(url, anon);
  const date = process.argv[2] || "2026-05-14";

  const { data: board, error: bErr } = await c.from("daily_boards")
    .select("date, categories, clue_ids, final_clue_id, daily_double_clue_id, created_at")
    .eq("date", date)
    .maybeSingle();
  if (bErr) { console.error("board err", bErr); return; }
  if (!board) { console.error(`No daily_boards row for ${date}`); return; }
  console.log(`Row for ${date}: created ${board.created_at}`);
  console.log(`Categories: ${JSON.stringify(board.categories)}`);
  console.log(`clue_ids count: ${board.clue_ids.length}`);
  console.log(`final_clue_id: ${board.final_clue_id}`);
  console.log(`daily_double_clue_id: ${board.daily_double_clue_id}`);

  const ids = [...board.clue_ids, board.final_clue_id];
  const { data: clues, error: cErr } = await c.from("clues")
    .select("id, category, value, round")
    .in("id", ids);
  if (cErr) { console.error("clues err", cErr); return; }
  const seen = new Set((clues ?? []).map(r => r.id));
  const missing = ids.filter(id => !seen.has(id));
  console.log(`\nResolved ${clues?.length}/${ids.length} via anon key.`);
  if (missing.length) {
    console.log(`MISSING ids: ${missing.join(",")}`);
    console.log(`This is why prod falls back to algorithmic generation.`);
  } else {
    console.log(`All ids resolve via anon. Row is valid for the live app.`);
  }
}
main();
