# Prompt eval harness

Smoke-test the AI prompts against golden sets so we don't ship a prompt
edit that quietly regresses one of the modes.

This is **opt-in**, not part of CI. Every run hits the deployed Gemini
endpoints and burns real tokens. The CI typecheck / lint / unit-test job
stays free; this is a manual step when you change a prompt template or
when a question_reports spike suggests something broke.

## Usage

```bash
# Against local dev (next dev running on :3000) — all four modes
PROMPT_EVAL_BASE_URL=http://localhost:3000 npm run eval

# Against the deployed app, save the JSON for diffing
PROMPT_EVAL_BASE_URL=https://nycu-ep-general-physics-tutor.vercel.app \
PROMPT_EVAL_VERSION=v2 \
npm run eval > eval-v2.json

# One mode only (comma-separate for a subset)
PROMPT_EVAL_BASE_URL=... npm run eval -- --only chat
PROMPT_EVAL_BASE_URL=... npm run eval -- --only exam,oral

# Attribute the run to a different student row in token_usage / attempts
PROMPT_EVAL_BASE_URL=... npm run eval -- --student-id 11111111-2222-4333-8444-555555555555

# Validate request builders without calling the server (no BASE_URL needed)
npm run eval -- --dry-run

# preview only: run a single golden chapter
PROMPT_EVAL_BASE_URL=... npm run eval -- --only preview --chapter 4
```

The human-readable table goes to **stderr**, the JSON blob to **stdout**,
so `> file.json` keeps the table on your terminal. Exit code is non-zero
if any check fails, so this composes with `&&` in a release script.

Every request carries a fixed `studentId`
(`0000e7a1-0000-4000-8000-000000000001`) unless overridden, so harness
traffic is easy to filter out of `token_usage`, `chat_messages` and
`attempts`. The id must be a UUID (`student_profiles.id` is `uuid`).

## Layout

```
scripts/eval/
├── run.mjs            CLI, orchestration, summary table, exit code
├── lib.mjs            fetch wrappers, UI-message-stream reader, text checks, usage/cost
├── modes/
│   ├── preview.mjs    /api/preview
│   ├── chat.mjs       /api/chat
│   ├── exam.mjs       /api/exam
│   └── oral.mjs       /api/oral-exam
└── golden/
    ├── preview.json   5 chapters: shape + recall anchors
    ├── chat.json      7 fixed questions (力學 / 熱學 / 電磁, one misconception)
    ├── exam.json      midterm + final, canned short answers
    └── oral.json      chapters [5], canned answers per question kind
```

Each mode module exports `name`, `plan(ctx)` (builds request bodies from
fixtures for `--dry-run`) and `run(ctx)` (hits the server, returns rows).
A row is `{ mode, label, ok, checks: { name: bool }, durationMs,
httpStatus, usage, costUsd, ...extras }`; `ok` is the AND of `checks`.

## What it checks

**preview** (`golden/preview.json`, unchanged from the original harness)

- `shape`: between `minConcepts` and `maxConcepts` concept entries.
- `recall`: any of `mustMentionAny` appears in the stringified concepts.

**chat** (`golden/chat.json`) — POSTs each question in the UIMessage
`parts` format the route expects, drains the UI message stream and
grades the concatenated `text-delta` chunks:

- `nonEmpty`, `length` (`minChars`..`maxChars`, defaults 80..6000)
- `zhDominant`: CJK share of letter-like characters ≥ `minCjkRatio`
  (0.5) after stripping `$…$`, `$$…$$` and code, so formulas don't
  count as English prose
- `citesChapter`: `Ch\d\d` / `Ch 4` / `第 4 章` / `第四章`
- `noMetaLeak`: no `The user` / `Now I` / `I will` / `I need to` / `My plan`
- `latexBalanced`: even number of unescaped `$`, balanced `$$`
- `recall` (optional per case): any of `mustMentionAny` present

**exam** (`golden/exam.json`) — `generate` for midterm and final, then
`grade` with a canned answer set (MC → `"A"`, short answers → one
plausible sentence, any `interactive_optics` question → sliders at their
`initial` values via `opticsResults`):

- generate: `count` (15 regular questions; optics extras allowed),
  `idsSequential`, `mcOptions` (4 each), `chapterRange`
  (midterm 1–16, final 17–37), `pointsSum` (80–100)
- grade: `perQuestion` (one result per question id),
  `earnedWithinPoints`, `totals` (totalScore ≈ Σ earned, maxScore ≈ Σ
  points, ±1), `gradeLetter` (A+…F), `feedbackZh`

**oral** (`golden/oral.json`) — `start` with `chapters: [5]`, one
`turn` per question with a canned answer keyed by `kind` (following
examiner follow-ups with canned replies), a synthetic cap probe, then
`finish`:

- start: `threeQuestions`, `kindsInOrder` (concept, derivation,
  application), `noModelAnswer` (no `modelAnswer` / `rubric` in the
  public question list), `chapterScope`, `hasPayload`
- turn: `actionValid` (`followup` | `next`), `replyNonEmpty`, `replyZh`,
  `followUpsCounted`
- cap-probe: a transcript already carrying 2 examiner follow-ups must
  be closed with `action: "next"` and `followUpsUsed: 2` (the route
  short-circuits without an LLM call)
- finish: `threeResults`, `subScoresInRange` (0–4 / 0–3 / 0–3),
  `earnedConsistent`, `totals` (max 30), `gradeLetter`, `feedbackZh`,
  `revealsModelAnswer`

`mustMentionAny` everywhere is a recall floor, not an exact match. Add
anchors when a prompt change starts dropping a topic; don't tighten them
preemptively or every minor reword breaks the harness.

## Token cost

The table has `tokens in+out` and `≈cost` columns. They're filled only
when a response carries a `usage` block (none of the four routes does
today — chat's UI stream has no `messageMetadata`, the JSON routes log
usage server-side via `logUsage()` instead), otherwise they read `n/a`.
Pricing mirrors `MODEL_RATES` in `src/lib/usage-log.ts`; for real
per-run cost use the admin panel's "🧪 Prompt 版本用量" table and filter
by the harness `studentId`.

## Comparing versions

Save the JSON from one run, bump `PROMPT_VERSION`, re-run, diff:

```bash
PROMPT_EVAL_VERSION=v1 ... > eval-v1.json
# (edit the prompt, redeploy, set PROMPT_VERSION=v2 in Vercel)
PROMPT_EVAL_VERSION=v2 ... > eval-v2.json
diff <(jq '.results[] | {mode, label, ok, checks}' eval-v1.json) \
     <(jq '.results[] | {mode, label, ok, checks}' eval-v2.json)
```

Preview rows still carry the legacy `chapter` / `conceptCount` /
`shapeOk` / `recallOk` fields, so older jq recipes keep working.

## Adding a mode

1. Drop a new `golden/<mode>.json`.
2. Add `modes/<mode>.mjs` exporting `name`, `plan(ctx)` and `run(ctx)`
   (use `postJson` / `postStream` / `makeResult` from `lib.mjs`).
3. Register it in the `MODES` map in `run.mjs`.
4. Run `--dry-run` to make sure the builders validate, then reference
   it from a release-time runbook.

For modes where a regex check isn't strong enough (exam grading quality,
reflection feedback), consider an LLM-as-judge step that asks Gemini to
score the output 1–5 against a rubric. Skipped here to keep the harness
dependency-free.
