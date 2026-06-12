# Prompt eval harness

Smoke-test the AI prompts against a golden set so we don't ship a prompt
edit that quietly regresses one of the modes.

This is **opt-in**, not part of CI. Every run hits the deployed Gemini
endpoint and burns real tokens. The CI typecheck / lint / unit-test job
stays free; this is a manual step when you change a prompt template or
when a question_reports spike suggests something broke.

## Usage

```bash
# Against the deployed app
PROMPT_EVAL_BASE_URL=https://nycu-ep-general-physics-tutor.vercel.app \
PROMPT_EVAL_VERSION=v2 \
node scripts/eval/run.mjs > eval-v2.json

# Against local dev (next dev running on :3000)
PROMPT_EVAL_BASE_URL=http://localhost:3000 \
node scripts/eval/run.mjs

# Run only one chapter
PROMPT_EVAL_ONLY=4 PROMPT_EVAL_BASE_URL=... node scripts/eval/run.mjs
```

Exit code is non-zero if any case fails the shape / recall check, so
this composes with `&&` in a release script.

## Comparing versions

Save the JSON from one run, bump `PROMPT_VERSION`, re-run, diff:

```bash
PROMPT_EVAL_VERSION=v1 ... > eval-v1.json
# (edit the prompt, redeploy, set PROMPT_VERSION=v2 in Vercel)
PROMPT_EVAL_VERSION=v2 ... > eval-v2.json
diff <(jq '.results[] | {chapter, ok, conceptCount}' eval-v1.json) \
     <(jq '.results[] | {chapter, ok, conceptCount}' eval-v2.json)
```

Cross-reference with the admin panel's "🧪 Prompt 版本用量" table to
see cost per call alongside the quality signal.

## What it checks

For each `cases[i]` in `golden/preview.json`:

- **shape**: the response has between `minConcepts` and `maxConcepts`
  concept entries.
- **recall**: any of `mustMentionAny` appears anywhere in the
  stringified concept array. Don't pin exact wording — physics phrasing
  varies and Gemini is sampling.

`mustMentionAny` is a recall floor, not an exact match. Add anchors
when a prompt change starts dropping a topic; don't tighten them
preemptively or every minor reword breaks the harness.

## Adding a mode

1. Drop a new `golden/<mode>.json` following the same schema.
2. Add a new POST-and-parse block in `run.mjs` for the route.
3. Reference it from a release-time runbook.

For modes where a regex check isn't strong enough (exam grading,
reflection feedback), consider an LLM-as-judge step that asks Gemini to
score the output 1–5 against a rubric. Skipped here to keep the
skeleton dependency-free.
