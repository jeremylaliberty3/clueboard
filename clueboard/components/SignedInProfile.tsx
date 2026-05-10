import Link from "next/link";

export type DBSession = {
  date: string;
  final_score: number | null;
  final_correct: boolean | null;
  final_wager: number | null;
};

export default function SignedInProfile({
  sessions,
  displayName,
}: {
  sessions: DBSession[];
  displayName: string;
}) {
  const stats = computeStats(sessions);

  return (
    <div className="flex-1 px-4 sm:px-6 py-8 max-w-3xl mx-auto w-full">
      <h1 className="font-serif text-3xl font-black text-gold-bright mb-2">
        {displayName}&rsquo;s stats
      </h1>
      <p className="text-white/60 text-sm mb-6">
        Synced across devices via your account.
      </p>

      {sessions.length === 0 ? (
        <div className="bg-board-deep p-8 rounded text-center">
          <p className="text-white/80 mb-4">
            No completed games yet. Play today&apos;s board to start tracking stats.
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
                {[...sessions].reverse().map((s) => (
                  <tr key={s.date} className="border-t border-white/5">
                    <td className="px-4 py-2">{s.date}</td>
                    <td className={`text-right font-bold px-4 py-2 ${(s.final_score ?? 0) < 0 ? "text-wrong" : "text-gold-bright"}`}>
                      {fmtMoney(s.final_score ?? 0)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {s.final_correct === null ? "—" : s.final_correct ? "✓" : "✗"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-white/40 mt-8">
            Per-category accuracy stats are coming soon.
          </p>
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

function computeStats(sessions: DBSession[]) {
  const games = sessions.length;
  const scored = sessions.map((s) => s.final_score ?? 0);
  const best = games ? Math.max(...scored) : 0;
  const avg = games ? Math.round(scored.reduce((a, b) => a + b, 0) / games) : 0;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const today = fmt.format(new Date());
  const dates = new Set(sessions.map((s) => s.date));
  let streak = 0;
  let cursor = today;
  while (dates.has(cursor)) {
    streak += 1;
    const d = new Date(cursor + "T12:00:00");
    d.setDate(d.getDate() - 1);
    cursor = fmt.format(d);
  }

  return { games, best, avg, streak };
}
