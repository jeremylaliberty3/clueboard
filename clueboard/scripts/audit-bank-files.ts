import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const c = createClient(url, key);
  const { data: rows } = await c.from("clues").select("category, round").eq("round", "single");
  const dbCats = new Set((rows ?? []).map((r) => r.category));

  const dir = "data/generated";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));

  type FileInfo = { file: string; cats: number; clues: number; subject: string; approved: boolean; inDB: number; notInDB: number; sample: string[] };
  const infos: FileInfo[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    let json: any;
    try { json = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { continue; }
    const cats = Array.isArray(json) ? json : (json.categories ?? json.cats ?? []);
    if (!Array.isArray(cats)) continue;
    const m = f.match(/-([a-z_]+)\.(?:approved\.)?json$/);
    const subject = m ? m[1] : "?";
    const approved = f.includes(".approved.");
    let inDB = 0, notInDB = 0;
    const sample: string[] = [];
    for (const cat of cats) {
      const name = cat.category || cat.name || cat.title;
      if (!name) continue;
      if (dbCats.has(name)) inDB++;
      else { notInDB++; if (sample.length < 3) sample.push(name); }
    }
    const clues = cats.reduce((acc: number, c: any) => acc + (c.clues?.length ?? 0), 0);
    infos.push({ file: f, cats: cats.length, clues, subject, approved, inDB, notInDB, sample });
  }

  infos.sort((a, b) => b.notInDB - a.notInDB);
  let totalNotInDB = 0, totalCats = 0;
  console.log(`Categories currently in DB: ${dbCats.size}\n`);
  console.log("File-by-file:");
  console.log("subject         approved  cats  notInDB  inDB  example_not_in_db");
  for (const i of infos) {
    totalCats += i.cats;
    totalNotInDB += i.notInDB;
    console.log(
      `${i.subject.padEnd(15)} ${(i.approved ? "yes" : "—").padEnd(8)} ${String(i.cats).padStart(4)}  ${String(i.notInDB).padStart(7)}  ${String(i.inDB).padStart(4)}  ${i.sample.join(" | ").slice(0, 70)}`,
    );
  }
  console.log(`\nTotals across files: ${totalCats} category-records (with duplicates across approved/unapproved), ${totalNotInDB} not currently imported.`);
}
main();
