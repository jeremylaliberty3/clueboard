// Quick judgment tests. Run with: npx tsx scripts/test-judge.ts
import { judgeAnswer } from "../lib/validation";

const cases: Array<{ user: string; correct: string; want: boolean; note?: string }> = [
  // Reported failures from 2026-05-12
  { user: "van gogg",     correct: "Vincent van Gogh",       want: true,  note: "typo in last name" },
  { user: "Dali",         correct: "Salvador Dalí",          want: true,  note: "missing diacritic" },
  { user: "Ferdinand",    correct: "Archduke Franz Ferdinand", want: true, note: "last name only" },
  { user: "Ferdidnand",   correct: "Archduke Franz Ferdinand", want: true, note: "last name only + typo" },

  // Regression: things that should stay correct
  { user: "Lincoln",      correct: "Abraham Lincoln",        want: true  },
  { user: "Adams",        correct: "John Quincy Adams",      want: true  },
  { user: "Roosevelt",    correct: "Theodore Roosevelt",     want: true  },
  { user: "what is paris", correct: "Paris",                 want: true  },
  { user: "Vincent van Gogh", correct: "Vincent van Gogh",   want: true  },

  // Regression: things that should stay wrong
  { user: "Washington",   correct: "Abraham Lincoln",        want: false },
  { user: "Picasso",      correct: "Salvador Dalí",          want: false },
  { user: "Napoleon",     correct: "Archduke Franz Ferdinand", want: false },
  { user: "the",          correct: "Abraham Lincoln",        want: false },
  { user: "",             correct: "Abraham Lincoln",        want: false },
  { user: "a",            correct: "Adams",                  want: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const v = judgeAnswer(c.user, c.correct);
  const ok = v.correct === c.want;
  const tag = ok ? "PASS" : "FAIL";
  if (ok) pass++; else fail++;
  console.log(
    `${tag}  "${c.user}" vs "${c.correct}"  expected=${c.want} got=${v.correct} (L${v.layer}: ${v.reason})${c.note ? "  // " + c.note : ""}`,
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
