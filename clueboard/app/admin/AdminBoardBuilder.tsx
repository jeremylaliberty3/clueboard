"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  adminSaveBoardAction,
  adminDeleteBoardAction,
  adminUpdateClueAction,
  adminSwapClueValueAction,
  adminRenameCategoryAction,
  type AdminCatalog,
  type AdminCategory,
  type AdminClue,
  type StagedBoard,
} from "@/lib/admin-actions";

type Composer = {
  date: string;
  /** Picked categories in order — up to 6. */
  categories: AdminCategory[];
  /** clueId picked as Daily Double, or null. */
  ddClueId: number | null;
  /** Final clue id, or null. */
  finalClueId: number | null;
};

function tomorrow(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function AdminBoardBuilder({ catalog }: { catalog: AdminCatalog }) {
  const [view, setView] = useState<"calendar" | "builder">("calendar");
  const [catalogState, setCatalogState] = useState(catalog);
  const [composer, setComposer] = useState<Composer>({
    date: tomorrow(catalog.today),
    categories: [],
    ddClueId: null,
    finalClueId: null,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [styleOpen, setStyleOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [hideUsed, setHideUsed] = useState(false);
  const [showFinalPicker, setShowFinalPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stagedDates = useMemo(
    () => Object.keys(catalogState.staged).sort(),
    [catalogState.staged],
  );

  const filteredByStyle = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Record<string, AdminCategory[]> = {};
    for (const [style, cats] of Object.entries(catalogState.categoriesByStyle)) {
      const filtered = cats.filter((c) => {
        if (hideUsed && c.usedOn.length > 0) return false;
        if (!q) return true;
        if (c.name.toLowerCase().includes(q)) return true;
        return c.clues.some(
          (cl) => cl.clue.toLowerCase().includes(q) || cl.answer.toLowerCase().includes(q),
        );
      });
      if (filtered.length) out[style] = filtered;
    }
    return out;
  }, [catalogState.categoriesByStyle, search, hideUsed]);

  const loadStaged = (date: string) => {
    const board = catalogState.staged[date];
    if (!board) return;
    const cats: AdminCategory[] = [];
    for (const catName of board.categories) {
      const found = Object.values(catalogState.categoriesByStyle)
        .flat()
        .find((c) => c.name === catName);
      if (found) cats.push(found);
    }
    setComposer({
      date,
      categories: cats,
      ddClueId: board.dailyDoubleClueId,
      finalClueId: board.finalClueId,
    });
    setError(null);
    setSavedAt(null);
  };

  /** Open the builder for a specific date — loads existing staged board if any, else empty. */
  const openBuilderFor = (date: string) => {
    if (catalogState.staged[date]) {
      loadStaged(date);
    } else {
      setComposer({ date, categories: [], ddClueId: null, finalClueId: null });
      setError(null);
      setSavedAt(null);
    }
    setView("builder");
  };

  const addCategory = (cat: AdminCategory) => {
    if (composer.categories.some((c) => c.name === cat.name)) return;
    if (composer.categories.length >= 6) {
      setError("Already 6 categories. Remove one first.");
      return;
    }
    setComposer({ ...composer, categories: [...composer.categories, cat] });
    setError(null);
  };

  const removeCategoryAt = (idx: number) => {
    const removed = composer.categories[idx];
    const nextCats = composer.categories.filter((_, i) => i !== idx);
    const removedIds = new Set(removed.clues.map((c) => c.id));
    setComposer({
      ...composer,
      categories: nextCats,
      ddClueId: composer.ddClueId && removedIds.has(composer.ddClueId) ? null : composer.ddClueId,
    });
  };

  const moveCategory = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= composer.categories.length) return;
    const next = [...composer.categories];
    [next[idx], next[target]] = [next[target], next[idx]];
    setComposer({ ...composer, categories: next });
  };

  const save = async () => {
    setError(null);
    if (composer.categories.length !== 6) {
      setError("Need exactly 6 categories.");
      return;
    }
    if (!composer.finalClueId) {
      setError("Pick a Final Clue.");
      return;
    }
    if (!composer.ddClueId) {
      setError("Pick a Daily Double cell.");
      return;
    }
    const clueIds: number[] = [];
    for (const cat of composer.categories) {
      for (const cl of cat.clues) clueIds.push(cl.id);
    }
    setSaving(true);
    const result = await adminSaveBoardAction({
      date: composer.date,
      categories: composer.categories.map((c) => c.name),
      clueIds,
      finalClueId: composer.finalClueId,
      dailyDoubleClueId: composer.ddClueId,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
    // Refresh staged map locally so the date now shows as "scheduled"
    const next: StagedBoard = {
      date: composer.date,
      categories: composer.categories.map((c) => c.name),
      clueIds,
      finalClueId: composer.finalClueId,
      dailyDoubleClueId: composer.ddClueId,
    };
    setCatalogState((prev) => ({
      ...prev,
      staged: { ...prev.staged, [composer.date]: next },
    }));
    // Return to the calendar so you can see the just-scheduled date.
    setView("calendar");
  };

  const del = async () => {
    if (!confirm(`Delete the staged board for ${composer.date}?`)) return;
    const result = await adminDeleteBoardAction(composer.date);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCatalogState((prev) => {
      const nextStaged = { ...prev.staged };
      delete nextStaged[composer.date];
      return { ...prev, staged: nextStaged };
    });
    setSavedAt(null);
  };

  const dateIsPast = composer.date <= catalogState.today;
  const finalClue = composer.finalClueId
    ? catalogState.finalClues.find((f) => f.id === composer.finalClueId) ?? null
    : null;

  return (
    <main className="min-h-screen bg-board text-white">
      <header className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-serif text-xl font-black text-gold-bright">
            Clueboard
          </Link>
          <span className="text-white/40 text-sm">/ admin</span>
          {view === "builder" && (
            <button
              onClick={() => setView("calendar")}
              className="text-xs px-3 py-1 border border-white/20 rounded hover:bg-white/10"
            >
              ← Calendar
            </button>
          )}
        </div>
        <div className="text-xs text-white/40">
          Today {catalogState.today} · Dev-only
        </div>
      </header>

      {view === "calendar" && (
        <CalendarView
          today={catalogState.today}
          staged={catalogState.staged}
          onPickDate={openBuilderFor}
        />
      )}

      {view === "builder" && (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_28rem] gap-6 p-6">
        {/* LEFT: catalog */}
        <section className="min-w-0">
          <div className="flex gap-3 mb-4 items-center flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search category, clue, or answer…"
              className="flex-1 min-w-64 px-4 py-2 rounded bg-white/5 border border-white/15 text-white placeholder-white/35 focus:outline-none focus:border-gold"
            />
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={hideUsed}
                onChange={(e) => setHideUsed(e.target.checked)}
              />
              Hide used
            </label>
          </div>

          <div className="space-y-3">
            {Object.entries(filteredByStyle).map(([style, cats]) => {
              const open = styleOpen[style] ?? true;
              return (
                <div key={style} className="border border-white/10 rounded">
                  <button
                    onClick={() => setStyleOpen((s) => ({ ...s, [style]: !open }))}
                    className="w-full px-4 py-2 flex justify-between items-center bg-white/5 hover:bg-white/10 text-left"
                  >
                    <span className="font-bold text-gold-bright uppercase tracking-wide text-sm">
                      {style} <span className="text-white/40 font-normal">({cats.length})</span>
                    </span>
                    <span className="text-white/40">{open ? "−" : "+"}</span>
                  </button>
                  {open && (
                    <ul className="divide-y divide-white/5">
                      {cats.map((cat) => (
                        <CategoryRow
                          key={cat.name}
                          cat={cat}
                          isExpanded={!!expanded[cat.name]}
                          onToggle={() =>
                            setExpanded((s) => ({ ...s, [cat.name]: !s[cat.name] }))
                          }
                          onAdd={() => addCategory(cat)}
                          alreadyOnBoard={composer.categories.some(
                            (c) => c.name === cat.name,
                          )}
                          onSaveEdit={async (clueId, clueText, answerText) => {
                            const r = await adminUpdateClueAction({
                              id: clueId,
                              clue: clueText,
                              answer: answerText,
                            });
                            if (!r.ok) {
                              alert(r.error);
                              return false;
                            }
                            setCatalogState((prev) => patchClueInState(prev, clueId, { clue: clueText, answer: answerText }));
                            return true;
                          }}
                          onSwapValue={async (clueId, newValue) => {
                            const r = await adminSwapClueValueAction({ clueId, newValue });
                            if (!r.ok) {
                              alert(r.error);
                              return false;
                            }
                            setCatalogState((prev) => {
                              // The source clue moves to newValue; the
                              // target clue (if any) moves to the source's
                              // old value, returned as swappedNewValue.
                              let after = patchClueInState(prev, clueId, { value: newValue });
                              if (r.swappedId != null && r.swappedNewValue != null) {
                                after = patchClueInState(after, r.swappedId, { value: r.swappedNewValue });
                              }
                              // Re-sort each affected category by value.
                              const nextStyles = { ...after.categoriesByStyle };
                              for (const [s, cs] of Object.entries(nextStyles)) {
                                nextStyles[s] = cs.map((c) => ({
                                  ...c,
                                  clues: [...c.clues].sort((a, b) => (a.value ?? 0) - (b.value ?? 0)),
                                }));
                              }
                              return { ...after, categoriesByStyle: nextStyles };
                            });
                            return true;
                          }}
                          onRename={async (oldName, newName) => {
                            const r = await adminRenameCategoryAction({ oldName, newName });
                            if (!r.ok) {
                              alert(r.error);
                              return false;
                            }
                            setCatalogState((prev) => {
                              const nextStyles = { ...prev.categoriesByStyle };
                              for (const [s, cs] of Object.entries(nextStyles)) {
                                nextStyles[s] = cs.map((c) =>
                                  c.name === oldName
                                    ? {
                                        ...c,
                                        name: newName,
                                        clues: c.clues.map((cl) => ({ ...cl, category: newName })),
                                      }
                                    : c,
                                );
                              }
                              return { ...prev, categoriesByStyle: nextStyles };
                            });
                            // Also rename in the composer if it's currently picked.
                            setComposer((cmp) => ({
                              ...cmp,
                              categories: cmp.categories.map((c) =>
                                c.name === oldName
                                  ? {
                                      ...c,
                                      name: newName,
                                      clues: c.clues.map((cl) => ({ ...cl, category: newName })),
                                    }
                                  : c,
                              ),
                            }));
                            return true;
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {Object.keys(filteredByStyle).length === 0 && (
              <div className="text-white/40 text-sm">No matching categories.</div>
            )}
          </div>
        </section>

        {/* RIGHT: composer */}
        <aside className="lg:sticky lg:top-6 self-start space-y-4">
          <div className="border border-gold rounded p-4 bg-white/5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-xl text-gold-bright font-black">Board for</h2>
              <input
                type="date"
                value={composer.date}
                onChange={(e) =>
                  setComposer({ ...composer, date: e.target.value })
                }
                className="bg-white/5 border border-white/15 rounded px-2 py-1 text-sm"
              />
            </div>

            {dateIsPast && (
              <div className="text-wrong text-xs mb-3">
                Date is today or in the past. Save will be refused.
              </div>
            )}

            {catalogState.staged[composer.date] && (
              <div className="text-xs text-white/60 mb-3">
                Already scheduled — saving overwrites the existing row.{" "}
                <button onClick={del} className="text-wrong underline">
                  Delete
                </button>
              </div>
            )}

            <div className="space-y-2 mb-4">
              {composer.categories.map((cat, idx) => (
                <div
                  key={cat.name}
                  className="border border-white/10 rounded px-3 py-2 bg-board/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm uppercase tracking-wide text-gold-bright truncate">
                      {idx + 1}. {cat.name}
                    </span>
                    <div className="flex gap-1 text-xs">
                      <button
                        onClick={() => moveCategory(idx, -1)}
                        disabled={idx === 0}
                        className="px-1.5 py-0.5 border border-white/20 rounded disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveCategory(idx, 1)}
                        disabled={idx === composer.categories.length - 1}
                        className="px-1.5 py-0.5 border border-white/20 rounded disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeCategoryAt(idx)}
                        className="px-1.5 py-0.5 border border-wrong/40 text-wrong rounded"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {cat.clues.map((cl) => {
                      const isDD = composer.ddClueId === cl.id;
                      return (
                        <button
                          key={cl.id}
                          onClick={() =>
                            setComposer({
                              ...composer,
                              ddClueId: isDD ? null : cl.id,
                            })
                          }
                          title={`${cl.clue}\n→ ${cl.answer}`}
                          className={`text-xs px-2 py-1 rounded border ${
                            isDD
                              ? "border-gold-bright bg-gold-bright/20 text-gold-bright font-bold"
                              : "border-white/15 hover:bg-white/10"
                          }`}
                        >
                          ${cl.value}
                          {isDD ? " ★DD" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {composer.categories.length < 6 && (
                <div className="border border-dashed border-white/15 rounded px-3 py-4 text-center text-xs text-white/40">
                  Pick {6 - composer.categories.length} more categor
                  {6 - composer.categories.length === 1 ? "y" : "ies"} from the left.
                </div>
              )}
            </div>

            {/* Final clue */}
            <div className="border-t border-white/10 pt-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white/60 uppercase tracking-wide">Final Clue</span>
                <button
                  onClick={() => setShowFinalPicker((v) => !v)}
                  className="text-xs underline text-gold-bright"
                >
                  {showFinalPicker ? "Close" : finalClue ? "Change" : "Pick"}
                </button>
              </div>
              {finalClue ? (
                <div className="text-sm">
                  <div className="text-gold-bright font-bold uppercase tracking-wide text-xs">
                    {finalClue.category}
                  </div>
                  <div className="text-white/85 mt-1">{finalClue.clue}</div>
                  <div className="text-white/50 text-xs mt-1">→ {finalClue.answer}</div>
                </div>
              ) : (
                <div className="text-xs text-white/40">None picked.</div>
              )}
              {showFinalPicker && (
                <div className="mt-3 max-h-72 overflow-y-auto border border-white/10 rounded">
                  {catalogState.finalClues.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setComposer({ ...composer, finalClueId: f.id });
                        setShowFinalPicker(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs border-b border-white/5 hover:bg-white/10 ${
                        composer.finalClueId === f.id ? "bg-gold-bright/10" : ""
                      }`}
                    >
                      <div className="text-gold-bright font-bold uppercase tracking-wide">
                        {f.category}
                      </div>
                      <div className="text-white/85 mt-0.5">{f.clue}</div>
                      <div className="text-white/40 mt-0.5">→ {f.answer}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="text-wrong text-sm mb-2">{error}</div>}
            {savedAt && (
              <div className="text-correct text-sm mb-2">Saved at {savedAt}.</div>
            )}

            <button
              onClick={save}
              disabled={saving || dateIsPast}
              className="w-full bg-gold-bright text-board font-bold px-4 py-2 rounded hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save board"}
            </button>
          </div>

          {stagedDates.length > 0 && (
            <div className="border border-white/10 rounded p-4">
              <h3 className="text-sm font-bold text-gold-bright uppercase tracking-wide mb-2">
                Staged boards
              </h3>
              <ul className="text-xs space-y-1">
                {stagedDates.map((d) => {
                  const isPast = d <= catalogState.today;
                  return (
                    <li key={d}>
                      <button
                        onClick={() => loadStaged(d)}
                        className={`text-left w-full hover:text-white ${
                          isPast ? "text-white/30" : "text-white/70"
                        }`}
                      >
                        {d}
                        {isPast ? " (locked)" : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────────────

type DayStatus = "scheduled" | "today" | "past" | "empty";

function statusFor(date: string, today: string, hasStagedBoard: boolean): DayStatus {
  if (date === today) return "today";
  if (date < today) return "past";
  return hasStagedBoard ? "scheduled" : "empty";
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function CalendarView({
  today,
  staged,
  onPickDate,
}: {
  today: string;
  staged: Record<string, StagedBoard>;
  onPickDate: (date: string) => void;
}) {
  // Anchor month: parse `today` directly to avoid TZ drift.
  const [year, month] = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return [y, m - 1]; // month is 0-indexed for Date()
  }, [today]);
  const [cursor, setCursor] = useState({ year, month });

  const monthDays = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const last = new Date(cursor.year, cursor.month + 1, 0);
    const startDow = first.getDay(); // 0 = Sunday
    const cells: Array<{ date: string | null; day: number | null }> = [];
    for (let i = 0; i < startDow; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= last.getDate(); d++) {
      cells.push({ date: ymd(new Date(cursor.year, cursor.month, d)), day: d });
    }
    // Pad to a multiple of 7
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    return cells;
  }, [cursor]);

  const counts = useMemo(() => {
    let scheduled = 0, empty = 0, past = 0;
    for (const cell of monthDays) {
      if (!cell.date) continue;
      const s = statusFor(cell.date, today, !!staged[cell.date]);
      if (s === "scheduled") scheduled++;
      else if (s === "empty") empty++;
      else if (s === "past") past++;
    }
    return { scheduled, empty, past };
  }, [monthDays, staged, today]);

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-serif text-3xl text-gold-bright font-black">{monthName}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const nm = cursor.month === 0 ? 11 : cursor.month - 1;
              const ny = cursor.month === 0 ? cursor.year - 1 : cursor.year;
              setCursor({ year: ny, month: nm });
            }}
            className="px-3 py-1.5 border border-white/20 rounded hover:bg-white/10"
          >
            ←
          </button>
          <button
            onClick={() => setCursor({ year, month })}
            className="px-3 py-1.5 border border-white/20 rounded hover:bg-white/10 text-xs"
          >
            Today
          </button>
          <button
            onClick={() => {
              const nm = cursor.month === 11 ? 0 : cursor.month + 1;
              const ny = cursor.month === 11 ? cursor.year + 1 : cursor.year;
              setCursor({ year: ny, month: nm });
            }}
            className="px-3 py-1.5 border border-white/20 rounded hover:bg-white/10"
          >
            →
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-xs text-white/60 mb-4">
        <span><Dot color="bg-correct" /> Scheduled: {counts.scheduled}</span>
        <span><Dot color="bg-gold-bright" /> Today</span>
        <span><Dot color="bg-white/20" /> Past: {counts.past}</span>
        <span><Dot color="bg-white/5 border border-white/15" /> Unstarted: {counts.empty}</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-white/40 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {monthDays.map((cell, i) => {
          if (!cell.date) return <div key={i} className="aspect-square" />;
          const status = statusFor(cell.date, today, !!staged[cell.date]);
          const board = staged[cell.date];
          const styles =
            status === "today" ? "bg-gold-bright/20 border-gold-bright text-gold-bright"
            : status === "scheduled" ? "bg-correct/15 border-correct/40 hover:bg-correct/25"
            : status === "past" ? "bg-white/5 border-white/10 text-white/40"
            : "bg-board/40 border-white/10 hover:bg-white/5 text-white/70";

          return (
            <button
              key={i}
              onClick={() => onPickDate(cell.date!)}
              className={`aspect-square border rounded p-2 flex flex-col items-start text-left ${styles}`}
              title={
                board
                  ? `${cell.date}\n${board.categories.join(", ")}`
                  : cell.date
              }
            >
              <span className="font-bold">{cell.day}</span>
              <span className="text-[10px] mt-auto uppercase tracking-wide opacity-80">
                {status === "today" ? "In progress"
                  : status === "scheduled" ? "Complete"
                  : status === "past" ? "Past"
                  : "Unstarted"}
              </span>
              {board && status !== "past" && (
                <span className="text-[10px] text-white/50 truncate w-full">
                  {board.categories[0]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} align-middle mr-1`} />;
}

/** Helper: patch a single clue inside the nested catalog state. */
function patchClueInState(
  state: AdminCatalog,
  clueId: number,
  patch: Partial<AdminClue>,
): AdminCatalog {
  const nextStyles = { ...state.categoriesByStyle };
  for (const [s, cs] of Object.entries(nextStyles)) {
    nextStyles[s] = cs.map((c) => ({
      ...c,
      clues: c.clues.map((cl) => (cl.id === clueId ? { ...cl, ...patch } : cl)),
    }));
  }
  return { ...state, categoriesByStyle: nextStyles };
}

function CategoryRow({
  cat,
  isExpanded,
  onToggle,
  onAdd,
  alreadyOnBoard,
  onSaveEdit,
  onSwapValue,
  onRename,
}: {
  cat: AdminCategory;
  isExpanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  alreadyOnBoard: boolean;
  onSaveEdit: (clueId: number, clue: string, answer: string) => Promise<boolean>;
  onSwapValue: (clueId: number, newValue: 200 | 400 | 600 | 800 | 1000) => Promise<boolean>;
  onRename: (oldName: string, newName: string) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(cat.name);
  const [renameSaving, setRenameSaving] = useState(false);

  return (
    <li className="px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="flex-1 min-w-0 bg-white/5 border border-gold/40 rounded px-2 py-1 text-sm"
              autoFocus
            />
            <button
              disabled={renameSaving}
              onClick={async () => {
                setRenameSaving(true);
                const ok = await onRename(cat.name, nameDraft);
                setRenameSaving(false);
                if (ok) setRenaming(false);
              }}
              className="text-xs px-2 py-1 bg-gold-bright text-board font-bold rounded disabled:opacity-50"
            >
              {renameSaving ? "…" : "Save"}
            </button>
            <button
              onClick={() => {
                setNameDraft(cat.name);
                setRenaming(false);
              }}
              className="text-xs px-2 py-1 border border-white/20 rounded"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={onToggle} className="flex-1 text-left flex items-center gap-2 min-w-0">
            <span className="text-white/40 text-xs">{isExpanded ? "▾" : "▸"}</span>
            <span className="font-bold truncate">{cat.name}</span>
            {cat.usedOn.length > 0 && (
              <span className="text-xs text-white/50 shrink-0">
                · used {cat.usedOn.length}× ({cat.usedOn.slice(-2).join(", ")}
                {cat.usedOn.length > 2 ? "…" : ""})
              </span>
            )}
          </button>
        )}
        {!renaming && (
          <>
            <button
              onClick={() => setRenaming(true)}
              className="text-xs text-white/40 hover:text-gold-bright shrink-0"
              title="Rename category"
            >
              ✎
            </button>
            <button
              onClick={onAdd}
              disabled={alreadyOnBoard}
              className={`text-xs px-2 py-1 rounded border shrink-0 ${
                alreadyOnBoard
                  ? "border-white/10 text-white/30"
                  : "border-gold-bright text-gold-bright hover:bg-gold-bright/10"
              }`}
            >
              {alreadyOnBoard ? "On board" : "Add"}
            </button>
          </>
        )}
      </div>
      {isExpanded && (
        <ul className="mt-2 space-y-1 pl-6">
          {cat.clues.map((cl) => (
            <EditableClueRow
              key={cl.id}
              clue={cl}
              onSave={onSaveEdit}
              onSwapValue={onSwapValue}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function EditableClueRow({
  clue,
  onSave,
  onSwapValue,
}: {
  clue: AdminClue;
  onSave: (clueId: number, clue: string, answer: string) => Promise<boolean>;
  onSwapValue: (clueId: number, newValue: 200 | 400 | 600 | 800 | 1000) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [clueText, setClueText] = useState(clue.clue);
  const [answerText, setAnswerText] = useState(clue.answer);
  const [saving, setSaving] = useState(false);
  const [swapping, setSwapping] = useState(false);

  if (!editing) {
    return (
      <li className="text-xs">
        <div className="flex gap-2 items-start">
          <select
            value={clue.value ?? 200}
            disabled={swapping}
            onChange={async (e) => {
              const next = Number(e.target.value) as 200 | 400 | 600 | 800 | 1000;
              if (next === clue.value) return;
              setSwapping(true);
              await onSwapValue(clue.id, next);
              setSwapping(false);
            }}
            className="bg-board border border-white/15 rounded px-1 py-0.5 text-gold-bright font-bold w-16 shrink-0 disabled:opacity-50"
            title="Change value — swaps with whichever clue currently has this value."
          >
            <option value={200}>$200</option>
            <option value={400}>$400</option>
            <option value={600}>$600</option>
            <option value={800}>$800</option>
            <option value={1000}>$1000</option>
          </select>
          <div className="flex-1 min-w-0">
            <div className="text-white/85">{clue.clue}</div>
            <div className="text-white/40">→ {clue.answer}</div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-white/40 hover:text-gold-bright shrink-0"
          >
            edit
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="text-xs border border-gold/30 rounded p-2 bg-white/5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-gold-bright font-bold">${clue.value}</span>
      </div>
      <label className="text-white/40 text-[10px] uppercase">Clue</label>
      <textarea
        value={clueText}
        onChange={(e) => setClueText(e.target.value)}
        className="w-full bg-board/60 border border-white/15 rounded px-2 py-1 text-xs mb-2"
        rows={2}
      />
      <label className="text-white/40 text-[10px] uppercase">Answer</label>
      <input
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        className="w-full bg-board/60 border border-white/15 rounded px-2 py-1 text-xs mb-2"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => {
            setClueText(clue.clue);
            setAnswerText(clue.answer);
            setEditing(false);
          }}
          className="text-xs px-2 py-1 border border-white/20 rounded"
        >
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(clue.id, clueText, answerText);
            setSaving(false);
            if (ok) setEditing(false);
          }}
          className="text-xs px-3 py-1 bg-gold-bright text-board font-bold rounded disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}
