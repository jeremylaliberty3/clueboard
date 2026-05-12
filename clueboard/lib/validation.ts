// Layered answer validation pipeline. Layers 1-4 (heuristic, deterministic).
// Layer 5 (LLM judge) is deferred for MVP.

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were",
  "of", "in", "on", "at", "to", "for", "with", "by",
  "and", "or", "what", "who", "whom", "whose", "which",
]);

const JEOPARDY_PREFIXES = [
  "what is", "what are", "what was", "what were",
  "who is", "who are", "who was", "who were",
  "where is", "where are", "where was", "where were",
  "when is", "when are", "when was", "when were",
  "why is", "why are", "why was", "why were",
  "how is", "how are", "how was", "how were",
];

export function normalize(s: string): string {
  let out = (s || "").toLowerCase().trim();
  // strip diacritics so "Dali" matches "Dalí", "naïve" matches "naive", etc.
  out = out.normalize("NFD").replace(/\p{M}/gu, "");
  for (const p of JEOPARDY_PREFIXES) {
    if (out.startsWith(p + " ")) {
      out = out.slice(p.length + 1);
      break;
    }
  }
  // strip punctuation
  out = out.replace(/[^\p{L}\p{N}\s]/gu, " ");
  // collapse whitespace
  out = out.replace(/\s+/g, " ").trim();
  // strip leading articles
  out = out.replace(/^(the|a|an)\s+/, "");
  return out;
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

// Layer 1: exact / substring with length guard.
function exactOrSubstring(user: string, correct: string): boolean | null {
  const u = normalize(user);
  const c = normalize(correct);
  if (!u) return false;
  if (u === c) return true;
  if (c.includes(u) || u.includes(c)) {
    if (u.length >= 3 && u.length >= 0.6 * c.length) return true;
  }
  return null; // inconclusive
}

// Layer 2: Levenshtein.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[a.length];
}

function levenshteinScore(user: string, correct: string): number {
  const u = normalize(user);
  const c = normalize(correct);
  if (!u || !c) return 0;
  const d = levenshtein(u, c);
  return 1 - d / Math.max(u.length, c.length);
}

// Layer 3: Jaccard token overlap.
function jaccard(user: string, correct: string): number {
  const a = new Set(tokens(user));
  const b = new Set(tokens(correct));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

// Layer 4: Soundex.
function soundex(word: string): string {
  const w = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (!w) return "";
  const map: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };
  let result = w[0];
  let prev = map[w[0]] || "";
  for (let i = 1; i < w.length && result.length < 4; i++) {
    const ch = w[i];
    const code = map[ch] || "";
    if (code && code !== prev) result += code;
    if (code) prev = code;
    else prev = "";
  }
  return (result + "000").slice(0, 4);
}

function soundexScore(user: string, correct: string): number {
  const u = tokens(user);
  const c = tokens(correct);
  if (!c.length || !u.length) return 0;
  const uCodes = new Set(u.map(soundex));
  const cCodes = c.map(soundex);
  let matched = 0;
  for (const code of cCodes) if (uCodes.has(code)) matched++;
  return matched / cCodes.length;
}

// Layer 3.5: token-level fuzzy match. Every user token (≥3 chars, non-stop)
// must have Levenshtein similarity ≥ 0.75 to *some* correct-answer token
// (≥3 chars). Catches:
//   - last-name-only answers ("Ferdinand" → "Archduke Franz Ferdinand")
//   - typos inside a multi-word answer ("van gogg" → "Vincent van Gogh")
// without globally loosening thresholds. A single garbage token still
// fails because it has to match *something* in the correct answer.
function tokenFuzzy(user: string, correct: string): { ok: boolean; score: number } {
  const uTokens = tokens(user).filter((t) => t.length >= 3);
  const cTokens = tokens(correct).filter((t) => t.length >= 3);
  if (!uTokens.length || !cTokens.length) return { ok: false, score: 0 };
  let total = 0;
  for (const ut of uTokens) {
    let best = 0;
    for (const ct of cTokens) {
      const d = levenshtein(ut, ct);
      const score = 1 - d / Math.max(ut.length, ct.length);
      if (score > best) best = score;
    }
    if (best < 0.75) return { ok: false, score: best };
    total += best;
  }
  return { ok: true, score: total / uTokens.length };
}

export type Verdict = {
  correct: boolean;
  layer: 1 | 2 | 3 | 4;
  reason: string;
};

export function judgeAnswer(userAnswer: string, correctAnswer: string): Verdict {
  // Layer 1
  const exact = exactOrSubstring(userAnswer, correctAnswer);
  if (exact === true) return { correct: true, layer: 1, reason: "exact/substring match" };
  if (exact === false) return { correct: false, layer: 1, reason: "empty answer" };

  // Layer 2
  const lev = levenshteinScore(userAnswer, correctAnswer);
  if (lev >= 0.88) return { correct: true, layer: 2, reason: `levenshtein ${lev.toFixed(2)}` };

  // Layer 3
  const jac = jaccard(userAnswer, correctAnswer);
  if (jac >= 0.6) return { correct: true, layer: 3, reason: `jaccard ${jac.toFixed(2)}` };

  // Layer 3.5 — token-level fuzzy (handles partial answers + typos)
  const tok = tokenFuzzy(userAnswer, correctAnswer);
  if (tok.ok) return { correct: true, layer: 3, reason: `token-fuzzy ${tok.score.toFixed(2)}` };

  // Layer 4
  const snd = soundexScore(userAnswer, correctAnswer);
  if (snd >= 0.75) return { correct: true, layer: 4, reason: `soundex ${snd.toFixed(2)}` };

  // Soft passes (less confident) — accept Levenshtein 0.75+ as a final fallback.
  if (lev >= 0.75) return { correct: true, layer: 2, reason: `levenshtein ${lev.toFixed(2)} (soft)` };
  if (jac >= 0.4) return { correct: true, layer: 3, reason: `jaccard ${jac.toFixed(2)} (soft)` };

  return { correct: false, layer: 4, reason: `lev ${lev.toFixed(2)}, jac ${jac.toFixed(2)}, snd ${snd.toFixed(2)}` };
}
