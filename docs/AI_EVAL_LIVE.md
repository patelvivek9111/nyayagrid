# Live AI evaluation suite (pinned model)

**Not a PR merge gate.** Mock `npm run eval:ai` runs on every CI push. This live suite is opt-in only so NyayaGrid never spends money accidentally.

## Required environment

| Variable | Required | Default / notes |
|---|---|---|
| `EVAL_LIVE` | **Yes** (`1`) | Hard opt-in. Anything else skips the live suite. |
| `OPENAI_API_KEY` | **Yes** | OpenAI API key |
| `EVAL_LIVE_MODEL` or `OPENAI_MODEL` | No | **Pinned default: `gpt-4o-mini`** |
| `EVAL_LIVE_TIMEOUT_MS` | No | `45000` per request |
| `EVAL_LIVE_MAX_TOKENS` | No | `80000` suite ceiling |
| `EVAL_LIVE_MAX_USD` | No | `0.75` estimated USD ceiling |
| `EVAL_LIVE_REPEATS` | No | `1` (point estimate). Set `3` for min/mean/max. Bar is judged on the **mean**; a range that straddles a bar is reported, not used to pass. |
| `EVAL_LIVE_CASE_IDS` | No | Comma-separated case ids. Isolation: skip smoke and other cases. |
| `EVAL_LIVE_WORKFLOW` | No | `case_qa` or `contradiction`. Skip the other live workflow. |
| `EVAL_RECALL_DEBUG` | No | `1` prints retrieved vs `mustCiteChunkIds` on mock runs. Live Case Q&A always prints this. |
| `EVAL_LIVE_USD_PER_1M_INPUT` | No | `0.15` (budget math only) |
| `EVAL_LIVE_USD_PER_1M_OUTPUT` | No | `0.60` (budget math only) |

Pin the model deliberately. Prefer `EVAL_LIVE_MODEL=gpt-4o-mini` in CI secrets/vars so a developer’s local `OPENAI_MODEL` cannot silently change the regression target.

Sampling: Case Q&A and contradiction live calls always send **`temperature=0`** (`LIVE_EVAL_TEMPERATURE`). The runner logs the API’s `model` field (dated snapshot when present) and `system_fingerprint` on the first call. Recorded 2026-08-14 isolation: `gpt-4o-mini-2024-07-18`, `fp_9afcdcbeed`.

### Required tracker fields (every live run)

The runner prints a `=== Live run config ===` block. Copy it into the tracker **on the same row as the rates**. A live number without this block is not a trustworthy baseline.

| Field | Source |
|---|---|
| `prompt.case_qa` | `NYAYA_PROMPT_VERSION` |
| `prompt.contradiction` | `CONTRADICTION_ANALYSIS_PROMPT_VERSION` |
| `prompt.contract_compare` | `COMPARE_SUMMARY_PROMPT_VERSION` (compare workspace) |
| `model.requested` | `EVAL_LIVE_MODEL` alias |
| `model.resolved` | API `model` field (dated snapshot when present) |
| `system_fingerprint` | API `system_fingerprint` or `(none)` |
| `rerank` | `EVAL_CASE_QA_RERANK` (`on` / `off`) |
| `temperature` | `LIVE_EVAL_TEMPERATURE` |

Live 1–3 did not record resolved snapshot or prompt version in the export packet. Live 2’s packet was later overwritten. **Do not use live 2 as a configuration baseline.** Live 4 onward is the first run with snapshot + rerank + temperature recorded together; prompt version is required from this checklist onward.

## Commands

```bash
# Deterministic, free, CI-safe (every PR)
npm run eval:ai

# Live OpenAI — only when explicitly enabled
EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini npm run eval:ai:live

# Range, not a single draw (runs Case Q&A + contradiction + live compare summaries)
EVAL_LIVE=1 EVAL_LIVE_REPEATS=3 EVAL_LIVE_MODEL=gpt-4o-mini npm run eval:ai:live
```

If `EVAL_LIVE` or `OPENAI_API_KEY` is missing, `eval:ai:live` **prints a skip message and exits 0** so optional workflows do not fail when secrets are absent.

## What it checks

1. Case Q&A smoke fixtures (`packages/ai/src/evals/fixtures.ts`)
2. Golden graded cases (`graded-cases.ts`) with faithfulness / completeness / evidence_state / need_more_docs
3. Quote validator smoke
4. **Baseline regression gate** — live must not fail any dimension required by `MOCK_GRADED_BASELINES` (`baselines.ts`), which mirrors the mock-proven graded suite

Budget exhaustion mid-suite fails remaining cases with a clear token/USD reason.

## Optional CI (manual / nightly)

Workflow: [`.github/workflows/eval-ai-live.yml`](../.github/workflows/eval-ai-live.yml)

- `workflow_dispatch` (manual)
- `schedule` — nightly UTC (can be disabled by not configuring secrets)
- **Not** triggered on `pull_request` or every push

Required repository secret: `OPENAI_API_KEY`  
Optional variable: `EVAL_LIVE_MODEL` (defaults to `gpt-4o-mini` in the workflow)

## Local tip

Keep mock green first:

```bash
npm run eval:ai
```

Export a live attorney-review packet (Section B):

```bash
EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini EVAL_EXPORT_REVIEW=1 npm run eval:ai:live
```

Then run live with tight caps while iterating:

```bash
EVAL_LIVE=1 EVAL_LIVE_MAX_USD=0.25 EVAL_LIVE_MAX_TOKENS=40000 npm run eval:ai:live
```

Use a **new** `EVAL_EXPORT_DIR` for each live packet. A mock run in a shell that still has `EVAL_EXPORT_DIR` pointing at a `*live*` folder will refuse that path and write `exports-mock` instead. Root `npm run eval:ai:live` runs `@nyayagrid/ai` then `@nyayagrid/intelligence` even if the first suite misses the bar, so contract-compare live summaries are not skipped.
