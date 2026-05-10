"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "@/lib/storage";

export default function AnonProfile() {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  if (history === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60">Loading…</div>
      </div>
    );
  }

  const stats = computeStats(history);

  return (
    <div className="flex-1 px-4 sm:px-6 py-8 max-w-3xl mx-auto w-full">
      <h1 className="font-serif text-3xl font-black text-gold-bright mb-2">
        Your stats
      </h1>
      <p className="text-white/60 text-sm mb-6">
        Stored locally in this browser.{" "}
        <Link href="/login" className="underline hover:text-white">Sign in</Link>{" "}
        to sync across devices.
      </p>

      {history.length === 0 ? (
        <div className="bg-board-deep p-8 rounded text-center">
          <p className="text-white/80 mb-4">
            No games played yet. Play today&apos;s board to start tracking stats.
          </p>
          <Link
            href="/play"
            className="inline-block px-6 py-3 bg-gold-bright text-board font-bold rounded hover:brightness-110"
          >
            Play today&apos;s board
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <Stat label="Games" value={String(stats.games)} />
            <Stat label="Best score" value={fmtMoney(stats.best)} />
            <Stat label="Average" value={fmtMoney(stats.avg)} />
            <Stat label="Current streak" value={String(stats.streak)} />
          </div>

          <h2 className="font-serif text-xl font-black text-gold-bright mb-3">History</h2>
          <div className="bg-board-deep rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-board-darker text-white/60 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-right px-4 py-2">Score</th>
                  <th className="text-right px-4 py-2">Final</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.date} className="border-t border-white/5">
                    <td className="px-4 py-2">{h.date}</td>
                    <td className={`text-right font-bold px-4 py-2 ${h.finalScore < 0 ? "text-wrong" : "text-gold-bright"}`}>
                      {fmtMoney(h.finalScore)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {h.finalCorrect === null ? "—" : h.finalCorrect ? "✓" : "✗"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="font-serif text-xl font-black text-gold-bright mt-8 mb-3">By category</h2>
          <div className="bg-board-deep rounded p-4 space-y-2">
            {stats.categories.map((c) => (
              <div key={c.tag} className="flex items-center gap-3">
                <div className="w-32 text-sm truncate">{c.tag}</div>
                <div className="flex-1 bg-board-darker rounded h-3 overflow-hidden">
                  <div className="h-full bg-gold-bright" style={{ width: `${c.pct}%` }} />
                </div>
                <div className="text-xs text-white/60 w-20 text-right">
                  {c.correct}/{c.total} ({c.pct}%)
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-board-deep p-4 rounded text-center">
      <div className="text-white/60 text-xs uppercase tracking-wide mb-1">{label}</div>
      <div className="font-serif font-black text-2xl text-gold-bright">{value}</div>
    </div>
  );
}

function fmtMoney(n: number) {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}

function computeStats(history: HistoryEntry[]) {
  const games = history.length;
  const best = history.reduce((m, h) => Math.max(m, h.finalScore), -Infinity);
  const avg = games ? Math.round(history.reduce((s, h) => s + h.finalScore, 0) / games) : 0;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const today = fmt.format(new Date());
  const dates = new Set(history.map((h) => h.date));
  let streak = 0;
  let cursor = today;
  while (dates.has(cursor)) {
    streak += 1;
    const d = new Date(cursor + "T12:00:00");
    d.setDate(d.getDate() - 1);
    cursor = fmt.format(d);
  }

  const map = new Map<string, { correct: number; total: number }>();
  for (const h of history) {
    for (const pc of h.perCategory) {
      const cur = map.get(pc.categoryTag) ?? { correct: 0, total: 0 };
      cur.correct += pc.correct;
      cur.total += pc.total;
      map.set(pc.categoryTag, cur);
    }
  }
  const categories = Array.from(map.entries())
    .map(([tag, v]) => ({
      tag, correct: v.correct, total: v.total,
      pct: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);

  return { games, best: best === -Infinity ? 0 : best, avg, streak, categories };
}
