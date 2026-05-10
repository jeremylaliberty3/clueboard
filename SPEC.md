# Clueboard — Build Spec

A daily trivia game in the style of classic American TV trivia shows. Every day, all users see the same board of 6 categories × 5 clues, written by Claude in a Jeopardy-style declarative voice and grounded in facts drawn from freely-licensed public trivia datasets. Users play once per day and share a Wordle-style score card. Optional sign-in saves stats and history.

**Domain:** [clueboard.app](https://clueboard.app) (registered via Cloudflare Registrar).

This spec is the source of truth for the build. The original brainstorm lives in [jeopardy_spec.md](jeopardy_spec.md) for reference; where the two disagree, this file wins.

---

## 1. Product summary

- One shared board per calendar day (US Eastern reset).
- 6 categories, 5 clues each ($200/$400/$600/$800/$1000), max regulation score $9,000.
- After the board: one **Final Clue** with a user-set wager (0 to current score).
- Free-form text answers; multi-layer validation pipeline (see §6).
- One scored attempt per day, resumable mid-game.
- **Sign-in is optional.** Anyone can play today's board anonymously and copy their score card. Signing in (Google OAuth) is only required to persist stats, streaks, and history across devices. Users can sign up *after* completing the board to save that day's score retroactively.
- Share-only social: copy/paste an emoji score card. No friends list, no leaderboards.
- Visual aesthetic inspired by classic TV trivia boards: deep blue board, gold values.

Out of scope for MVP: friends/lobbies, leaderboards, hints, multiple difficulties, audio, archive of past boards, Daily Doubles.

---

## 2. Branding & trademark posture

The product is named **Clueboard**, deliberately chosen to avoid trademark conflict with Sony's "JEOPARDY!" mark. The following rules govern all user-facing surfaces:

**Do:**
- Use the name "Clueboard" everywhere — UI, OAuth consent screens, social sharing, app stores.
- Credit the underlying source datasets factually on the About page and footer:
  > *Trivia content sourced from the [Open Trivia Database](https://opentdb.com) (CC BY-SA 4.0) and [The Trivia API](https://the-trivia-api.com) (CC BY 4.0), then rewritten in our own voice. Clueboard is an independent project; not affiliated with, endorsed by, or sponsored by Sony Pictures Television or Jeopardy Productions, Inc.*
- Use a generic deep-blue + gold visual palette for the board (the colors themselves aren't trademarked in isolation).

**Don't:**
- Don't use the word "Jeopardy" in the product name, domain, page titles, OG image, favicon, headings, or marketing copy. Reserve it for factual data-source credits only.
- Don't use the JEOPARDY! logo, wordmark, or any official show artwork anywhere.
- Don't use the "Think!" music or any audio sourced from the show.
- Don't name in-game phases after show-specific trademarks. The phase after the main board is called **Final Clue**, not "Final Jeopardy" (which is a registered mark).

This posture keeps the product safe for indefinite operation, including monetization later.

---

## 3. Tech stack

| Component | Tool |
|---|---|
| Framework | Next.js 16 (App Router) |
| Hosting | Vercel |
| Domain | clueboard.app (Cloudflare Registrar) |
| Database | Supabase Postgres |
| Auth | Supabase Auth (Google OAuth) |
| Styling | Tailwind CSS + shadcn/ui |
| LLM judge (validation layer 5) | Claude Haiku via Anthropic API |
| Source fact bank | Open Trivia DB + The Trivia API (one-time fetch, periodic refresh) |
| Clue authoring | Claude (Sonnet/Haiku) — designs categories and rewrites source facts as Jeopardy-style clues |

Server components for the marketing page and profile shell. Client components for the interactive board and clue modal. Game state writes go through Next.js Route Handlers / Server Actions, never direct from client to Supabase, so answer validation and scoring stay server-side and tamper-resistant.

---

## 4. Data model (Supabase)

```
clues
  id              bigint pk
  category        text
  clue            text
  answer          text
  value           int                 -- 200, 400, 600, 800, 1000, or null for Final Clue
  round           text                -- 'single' | 'final'
  air_date        date
  category_tag    text                -- normalized topic for per-category stats

daily_boards
  date            date pk             -- US/Eastern calendar date
  category_ids    bigint[]            -- 6 categories selected for the day
  clue_ids        bigint[]            -- 30 single-round clue ids, in fixed order
  final_clue_id   bigint              -- one Final Clue
  seed            int                 -- numeric seed = YYYYMMDD

users                                 -- managed by Supabase Auth; profile extension below

profiles
  user_id         uuid pk fk -> auth.users
  display_name    text
  created_at      timestamptz

game_sessions                         -- only created for authenticated users
  id              uuid pk
  user_id         uuid fk
  date            date
  state           jsonb               -- per-clue answers, correctness, current score
  final_wager     int
  final_answer    text
  final_correct   bool
  final_score     int
  status          text                -- 'in_progress' | 'completed'
  started_at      timestamptz
  completed_at    timestamptz
  unique(user_id, date)

-- Anonymous players keep their in-progress state in localStorage only.
-- On sign-up after completion, the localStorage state is posted to a Server Action
-- that re-validates and writes a single completed game_sessions row for that user/date.
```

`game_sessions.state` shape:

```jsonc
{
  "answers": {
    "<clue_id>": { "answer": "user typed", "correct": true, "value": 400, "answered_at": "..." }
  },
  "score": 2400,
  "phase": "board" | "final_wager" | "final_clue" | "done"
}
```

---

## 5. Daily board generation

- Reset time: **midnight US/Eastern**. The board for date `D` is the one served between `D 00:00 ET` and `D+1 00:00 ET`.
- Eligible clues: `round = 'single'`, all five standard dollar values present in the chosen category, no malformed text.
- Selection: deterministic seeded random using `seed = YYYYMMDD` (Eastern). Pick 6 categories, then pick one clue per ($200/$400/$600/$800/$1000) within each.
- Final Clue: one `round = 'final'` clue selected with the same seed.
- Generation runs as a Vercel Cron job at 00:00 ET daily, writing one row to `daily_boards`. Lazy fallback: if a request arrives and no row exists, generate on the fly inside a Server Action and upsert.

---

## 6. Scoring rules

- Correct answer: **+ clue value** added to score.
- Wrong answer: **− clue value** subtracted from score. Score may go negative.
- No timer. No skip — a clue is only "answered" once submitted.
- Any clue can be selected in any order while it's unanswered.
- **Final Clue:**
  - Wager input range: `0 ≤ wager ≤ max(0, current_score)`. If current score ≤ 0, max wager is 0.
  - User sees only the **category** before submitting wager; then sees the clue and submits an answer.
  - Correct: wager added. Wrong: wager subtracted.
- Final score = score after Final Clue.

---

## 7. Answer validation pipeline

Identical to the layered design in [jeopardy_spec.md](jeopardy_spec.md). Summary:

1. Normalize + exact / substring match.
2. Levenshtein similarity (≥0.75 pass, ≥0.88 confident).
3. Jaccard token overlap (≥0.4 pass, ≥0.6 confident).
4. Soundex phonetic match (≥0.5 codes, ≥0.75 score).
5. Claude Haiku LLM judge fallback returning `{correct, confidence, reason}`.

All five layers run **server-side** inside a Server Action so the user can't tamper with verdicts or read the correct answer client-side before submitting.

---

## 8. Pages and routes

```
/                       Landing — short description + "Play today's board" CTA
/play                   Today's board (anonymous OR signed-in)
/profile                Personal stats (signed in only; redirect to /login if anon)
/login                  OAuth start (Google)
/auth/callback          Supabase OAuth callback
/about                  About + data source credit
/privacy                Privacy policy (required for OAuth approval)
/terms                  Terms of service (required for OAuth approval)
```

### 8.1 Landing (`/`)
- Hero: "Clueboard — a daily trivia puzzle. One board, one shot, every day."
- Short paragraph describing the game (6 categories, 30 clues, Final Clue, share your score).
- Primary CTA: **Play today's board** → `/play` (no auth required).
- Secondary CTA in header: **Sign in** → for users who already have an account and want their score saved.
- Footer: links to About, Privacy, Terms, plus the data source credit line.

### 8.2 Play (`/play`)
The core experience. Two view modes sharing identical state:
- **Grid view** (default ≥768px): 6 columns × 5 rows, classic trivia board layout. Answered cells show ✓ / ✗ in place of dollar value.
- **Accordion view** (default <768px): six full-width category cards; tap to expand and reveal $200–$1000 chips. Header row of 5 dots shows progress at a glance.
- View choice persists in localStorage.

**Header (persistent across both views):**
- Clueboard logo (small)
- Current score
- Clues completed (e.g. `12 / 30`)
- View toggle button

**Clue modal (shared between views):**
- Category + dollar value
- Clue text
- Free-text input + Submit
- After submit: brief correct/incorrect flash. On wrong, show the correct answer for ~2s before closing.

**Final Clue phase** (after all 30 clues submitted):
1. Full-screen card: "Final Clue" + category name + wager input (`0` to `max(0, score)`) + Submit Wager.
2. Reveal clue + answer input.
3. Submit → result screen.

**Resumability:**
- Signed-in users: every submission updates `game_sessions.state` server-side. Resumable across devices. Locked when Final Clue is submitted (`status = 'completed'`).
- Anonymous users: state is persisted to localStorage on every submission. Resumable on the same device/browser only. Locked once Final Clue is submitted.

**Anonymous → signed-in migration:** if an anonymous user signs in *while a game is in progress or just completed*, the client posts the localStorage state to a Server Action (`migrateAnonymousSession`) that re-validates each answer against today's board and writes a single `game_sessions` row for that user/date. If a row already exists for that user/date (they played earlier on another device), the existing row wins and the localStorage state is discarded.

### 8.3 Result screen (after Final Clue)
Shown inline at `/play` when the game is complete (signed-in: `status = 'completed'`; anonymous: localStorage flag):
- Final score (large, gold on blue).
- Wordle-style emoji grid (6×5) using 🟦 correct / 🟥 incorrect, plus a separate line for the Final Clue.
- "Copy score card" button → copies plain text (works for anonymous and signed-in users alike):
  ```
  Clueboard — Sat May 09, 2026
  $4,200

  🟦🟥🟦🟦🟦
  🟥🟦🟥🟦🟦
  🟦🟦🟦🟥🟦
  🟦🟥🟦🟦🟦
  🟦🟦🟥🟦🟥
  🟦🟦🟦🟦🟦
  Final: 🟦  (+$2,000)

  clueboard.app
  ```
- Stats teaser:
  - **Signed-in users:** current streak, best score, link to full profile.
  - **Anonymous users:** "Sign up to save this score and track your stats" with a Google sign-in button. Signing up here triggers the anonymous → signed-in migration described above.

### 8.4 Profile (`/profile`)
- **All-time stats:** games played, average score, best score, accuracy %, current streak, max streak.
- **Score history calendar:** GitHub-contributions-style heatmap of daily final scores. Hover/tap a day to see that day's score.
- **Per-category stats:** strongest and weakest topics by accuracy, using `clues.category_tag`. Bar list, ~top 10 / bottom 10.
- Sign out button.

### 8.5 About / Privacy / Terms
Static pages. About has the data-source credit and trademark disclaimer (see §2). Privacy and Terms are required for OAuth approval (see §13).

---

## 9. Visual design

**Aesthetic:** classic TV trivia board — deep blue, gold values — without using any show-specific assets.
- **Palette:** deep board blue (`#060CE9` family), gold/yellow values (`#D69F4C` / `#FFCC00`), white text.
- **Typography:** clean serif (e.g. Playfair Display or Source Serif) for category names and clue text; clean sans (Inter) for UI chrome and body. Dollar values rendered bold gold.
- **Logo:** custom Clueboard wordmark — gold serif on blue tile. Distinct from any show logo.
- **Board cells:** flat blue tiles, gold values, subtle border. Answered cells fade to a darker blue with ✓ or ✗ gold glyph.
- **Modal:** royal-blue background, large clue text centered, gold border.
- Modern niceties: 8–12px rounded corners on cards/buttons, smooth fade transitions between modal states. No skeuomorphic chalkboard.

---

## 10. Auth flow

- Supabase Auth with Google as the only OAuth provider. (Apple Sign-In intentionally excluded to avoid the $99/yr Apple Developer fee.)
- `/login` page with one Google OAuth button.
- Callback at `/auth/callback` (Next.js Route Handler) finishes Supabase session.
- Middleware protects **only `/profile`** (redirects to `/login` if anonymous). `/play` is fully accessible to anonymous users.
- On first sign-in, create a `profiles` row with `display_name` derived from OAuth name.
- If the sign-in callback detects an anonymous in-progress or completed session in localStorage (passed via a return-to URL parameter or read by the client right after callback), it triggers `migrateAnonymousSession` before redirecting.

---

## 11. Anti-cheat / integrity

- All answer validation, scoring, and wager logic run server-side (Server Actions / Route Handlers). This applies equally to anonymous and signed-in users — anonymous users still hit the same server endpoint, they just don't get a `game_sessions` row.
- The correct answer is **never** sent to the client until after a clue is submitted.
- `daily_boards.clue_ids` is exposed to the client only as `(category, value, clue_text)` triples; raw answer text is server-only.
- Signed-in users can only have one `game_sessions` row per `(user_id, date)` (enforced by unique constraint).
- Server checks: clue belongs to today's board; clue isn't already answered (for signed-in users, checked against DB; for anonymous, the client-supplied prior state is re-validated); wager is in range; phase transitions are valid.
- Note: anonymous play is inherently trust-the-client for state continuity (someone could clear localStorage and replay). That's acceptable since anonymous scores aren't recorded anywhere — they only matter for the share card the user copies for themselves.

---

## 12. Build phases

1. **Foundation:** Next.js + Tailwind + shadcn scaffold; Supabase project; OAuth working; protected routes; clueboard.app pointed at Vercel.
2. **Data import:** one-shot script to ingest the jwolle1 dataset into `clues`; tag categories.
3. **Daily board generator:** seeded SQL function + Vercel Cron + lazy fallback.
4. **Validation pipeline:** layers 1–4 in TypeScript; layer 5 wired to Anthropic SDK with prompt caching on the system prompt.
5. **Play page (grid + accordion + modal):** end-to-end gameplay through 30 clues with server-side scoring.
6. **Final Clue phase + result screen + share card.**
7. **Profile page:** stats, calendar heatmap, per-category breakdown.
8. **Landing + About/Privacy/Terms + visual design pass + Clueboard logo.**
9. **Google OAuth production approval** (verification process for the consent screen).
10. **QA:** edge cases (negative scores, $0 wager, refresh mid-game, switching views mid-clue, timezone boundary).

---

## 13. Open questions to revisit later

- **Privacy policy / terms** — required for Google OAuth production approval. Pages live at `/privacy` and `/terms`, linked from the footer and the sign-in screen. Drafts to be written before submitting the OAuth app for production review (use a generator like getterms.io or hand-write a short version).
- **Category tagging strategy** for per-category stats — deferred. Decide manual list vs. LLM-derived when we get to the Profile page phase.
- **Archive / friends / leaderboard** — deferred. Revisit post-MVP.
