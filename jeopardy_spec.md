# Daily Jeopardy — Product Spec

## Overview

A daily Jeopardy-style trivia game playable in the browser. Every day, all users see the same board of 6 categories and 5 questions each, drawn from a real Jeopardy clue dataset. Users answer in free-form text, receive a final score, and can share a result card with friends. There are no lobbies, no live competition, and no real-time connections — just a shared daily puzzle with a personal score at the end.

---

## Game Format

- 6 categories per board, 5 clues each (30 total)
- Clue values: $200, $400, $600, $800, $1,000
- Maximum possible score: $9,000
- One board per day, identical for all users
- Free-form text answers (not multiple choice)
- Shareable score card generated on completion (Wordle-style grid)

---

## Data Source

Questions are sourced from a community-maintained dataset of ~538,000 real Jeopardy clues (Seasons 1–41), available on GitHub. The dataset is imported once into a Supabase database. A daily board is generated deterministically using the current date as a numeric seed, ensuring every user receives the same 6 categories regardless of when they load the page.

Only Single Jeopardy (round 1) clues with all five standard dollar values present are eligible for selection, ensuring every board is structurally complete.

---

## Answer Validation — Layer-Based Pipeline

User answers are evaluated by passing through a series of increasingly sophisticated layers. Each layer short-circuits if it reaches a confident verdict, so the expensive LLM layer only fires when all heuristic layers are inconclusive. This keeps latency low and costs minimal.

### Layer 1 — Normalize and Exact Match

Both the user's answer and the correct answer are normalized before any comparison:
- Convert to lowercase
- Strip punctuation
- Remove common Jeopardy phrasing ("what is", "who is", "the", "a", "an")
- Collapse whitespace

After normalization, the two strings are compared directly. A substring containment check also runs, but is gated by a minimum length requirement: the user's answer must be at least 60% as long as the correct answer and at least 3 characters to prevent single-character inputs from passing.

**Strengths:** Zero latency, zero cost, fully deterministic.
**Limitation:** Cannot handle synonyms, abbreviations, or alternate phrasings.

---

### Layer 2 — Fuzzy Matching (Levenshtein Distance)

Levenshtein distance measures the minimum number of single-character edits (insertions, deletions, substitutions) needed to transform one string into another. A similarity ratio is computed as:

```
similarity = 1 - (edit_distance / max(len(a), len(b)))
```

Answers with a similarity score of 0.75 or above pass this layer. Answers scoring 0.88 or above are accepted with high confidence and skip all remaining layers.

**Strengths:** Handles typos and minor misspellings gracefully.
**Limitation:** Structurally different but semantically equivalent answers (e.g. "The Beatles" vs "Beatles") may still fail. Threshold tuning is important — too loose and wrong answers slip through, too tight and legitimate typos are rejected.

---

### Layer 3 — Token Overlap (Jaccard Similarity)

Both strings are split into word tokens after removing stop words. The Jaccard similarity score is calculated as:

```
score = |intersection| / |union|
```

Answers scoring 0.4 or above pass, and answers scoring 0.6 or above are accepted with high confidence. Stop words filtered before comparison include: "the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "at", "to", "for", "with", "by".

**Strengths:** Word-order agnostic; handles partial answers well. "Abraham Lincoln the president" would match "Abraham Lincoln" cleanly.
**Limitation:** No semantic understanding. "Not Napoleon" scores highly against "Napoleon" without additional guards.

---

### Layer 4 — Phonetic Matching (Soundex)

Each word in both answers is converted to a Soundex code — a rule-based representation of how a word sounds, reducing words to a letter followed by three digits representing consonant groups. The proportion of the correct answer's codes that appear in the user's answer codes is used as the score.

Answers where 50% or more of the correct answer's phonetic codes are matched, and where the overall score is 0.75 or above, pass this layer.

**Strengths:** Handles phonetically plausible misspellings of names, such as "Chaikovsky" matching "Tchaikovsky."
**Limitation:** Can produce false positives for words that sound similar but are unrelated. For non-English proper nouns, Double Metaphone is a more accurate alternative to basic Soundex.

---

### Layer 5 — LLM Judge

If all four heuristic layers fail to reach a confident verdict, the answer is escalated to an LLM (Claude Haiku in production for cost efficiency). The model is given the question, the correct answer, and the user's answer, and instructed to return a structured JSON verdict:

```json
{ "correct": true, "confidence": 0.95, "reason": "brief explanation" }
```

The prompt applies the following rules, calibrated to match real Jeopardy judging standards:

**Accept:**
- Abbreviations and symbols where the meaning is unambiguous (e.g. "Au" for Gold, "NYC" for New York City)
- Alternate widely-recognised names or titles (e.g. "Lincoln" for "Abraham Lincoln")
- Phonetically plausible misspellings — where a native English speaker sounding out the correct answer could reasonably produce the user's spelling (e.g. "Linkon", "Beethofen")

**Reject:**
- Spellings that are phonetically implausible — i.e. sounding out the user's spelling does not produce something recognisably close to the correct answer (e.g. "Linkni" does not sound like "Lincoln")
- Vague or incomplete answers that do not uniquely identify the correct response
- Any answer where a reasonable person would say it does not sound like the right answer when spoken aloud

The key test applied by the model: *if you slowly read the user's answer aloud, does it sound like the correct answer?* If not, the answer is rejected.

**Strengths:** Handles abbreviations, alternate names, edge cases, and nuanced phonetic reasoning that rules-based layers cannot.
**Limitation:** Highest latency and cost of all layers. Non-deterministic across runs. Should only fire for genuinely ambiguous cases (~10–20% of all answers in practice).

---

### Pipeline Summary

| Layer | Method | Catches |
|---|---|---|
| 1 | Normalize + exact match | Correct answers with minor formatting differences |
| 2 | Levenshtein fuzzy match | Typos and character-level misspellings |
| 3 | Jaccard token overlap | Word-order variation, partial correct answers |
| 4 | Soundex phonetic match | Phonetic misspellings of names |
| 5 | LLM judge | Abbreviations, alternate names, edge cases |

Each layer short-circuits on a confident match. The LLM is a fallback of last resort, not a default.

---

## UI Design

The board supports two view modes that share identical underlying state. Switching views mid-game preserves all answered clues and the current score. The default view is determined by screen width on load, and the user's preference is persisted in localStorage.

```
Default: grid view on screens ≥ 768px, accordion on smaller screens
```

### Grid View (Desktop-first)

The classic Jeopardy board layout. Six category headers appear as a horizontal row, with five rows of dollar-value cells beneath them. Answered clues display a green check (correct) or red cross (incorrect) in place of the dollar value. The board overflows horizontally on narrow screens and is scrollable.

Best suited to desktop and tablet users who want the authentic board feel and benefit from larger screens where all six columns are comfortably visible.

### Accordion View (Mobile-first)

Each of the six categories is rendered as a full-width card. Tapping a card expands it inline to reveal the five dollar-value chips for that category. Each chip displays its dollar value when unanswered, and a green or red indicator once attempted. A row of five progress dots in the card header shows completion at a glance without requiring the category to be expanded.

Best suited to mobile users. Tap targets are large, category names are never truncated, and no horizontal scrolling is required.

### Shared Clue Modal

Both views open the same modal when a clue is selected. The modal displays the category name, dollar value, and full clue text. The user types their answer into a text input and submits. After submission, the modal briefly displays whether the answer was correct (with the correct answer shown on a wrong response) before closing and returning the user to the board.

### Score and Sharing

The current score and clue completion count are displayed persistently in the header across both views. On completing all 30 clues, a result banner is shown with the final score and a "Copy score card" button. The copied text is a Wordle-style grid using 🟦 for correct and 🟥 for incorrect, along with the date and a link to the game.

---

## Tech Stack (Zero-Cost Architecture)

| Component | Tool |
|---|---|
| Question dataset | jwolle1/jeopardy_clue_dataset (GitHub, one-time import) |
| Database | Supabase free tier |
| Daily board logic | Supabase SQL function (seeded random selection) |
| Frontend | React, hosted on Vercel or Netlify free tier |
| Answer validation (layers 1–4) | Client-side JavaScript, no dependencies |
| Answer validation (layer 5) | Gemini Flash free tier or Anthropic API |
| Score storage | Supabase (anonymous user token via localStorage) |
