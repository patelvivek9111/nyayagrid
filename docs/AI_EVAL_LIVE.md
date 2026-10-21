# Live AI evaluation suite (pinned model)

**Not a PR merge gate.** Mock `npm run eval:ai` runs on every CI push. This live suite is opt-in only so NyayaGrid never spends money accidentally.

Entry point: root `npm run eval:ai:live` → `scripts/certification/eval-ai-live.mjs` (runs `@nyayagrid/ai` then `@nyayagrid/intelligence`).

## Required environment

| Variable | Required | Default / notes |
|---|---|---|
| `EVAL_LIVE` | **Yes** (`1`) | Hard opt-in. Anything else skips the live suite. |
| `OPENAI_API_KEY` | **Yes** | OpenAI API key |
| `EVAL_LIVE_MODEL` or `OPENAI_MODEL` | No | **Pinned default: `gpt-4o-mini`** |
| `EVAL_LIVE_TIMEOUT_MS` | No | `45000` per request |
| `EVAL_LIVE_MAX_TOKENS` | No | `80000` suite ceiling |
| `EVAL_LIVE_MAX_USD` | No | `0.75` estimated USD ceiling |
| `EVAL_LIVE_REPEATS` | No | `1` (point estimate). Set `3` for min/mean/max. Bar is judged on the **mean**. |
| `EVAL_LIVE_CASE_IDS` | No | Comma-separated case ids. Isolation: skip smoke and other cases. |
| `EVAL_LIVE_WORKFLOW` | No | `case_qa` or `contradiction`. Skip the other live workflow. |
| `EVAL_RECALL_DEBUG` | No | `1` prints retrieved vs `mustCiteChunkIds` on mock runs. Live Case Q&A always prints this. |
| `EVAL_LIVE_USD_PER_1M_INPUT` | No | `0.15` (budget math only) |
| `EVAL_LIVE_USD_PER_1M_OUTPUT` | No | `0.60` (budget math only) |

Pin the model deliberately. Prefer `EVAL_LIVE_MODEL=gpt-4o-mini` in CI secrets/vars so a developer’s local `OPENAI_MODEL` cannot silently change the regression target.

Sampling: Case Q&A and contradiction live calls always send **`temperature=0`**. The runner logs the API’s `model` field (dated snapshot when present) and `system_fingerprint` on the first call.

### Recorded config fields (every live run)

The runner prints a `=== Live run config ===` block. Keep that block with any rates you store in an ops log (outside git).

| Field | Source |
|---|---|
| `prompt.case_qa` | `NYAYA_PROMPT_VERSION` |
| `prompt.contradiction` | `CONTRADICTION_ANALYSIS_PROMPT_VERSION` |
| `prompt.contract_compare` | `COMPARE_SUMMARY_PROMPT_VERSION` |
| `model.requested` | `EVAL_LIVE_MODEL` alias |
| `model.resolved` | API `model` field |
| `system_fingerprint` | API `system_fingerprint` or `(none)` |
| `rerank` | `EVAL_CASE_QA_RERANK` (`on` / `off`) |
| `temperature` | live eval temperature constant |

## Commands

```bash
# Deterministic, free, CI-safe (every PR)
npm run eval:ai

# Live OpenAI — only when explicitly enabled
EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini npm run eval:ai:live

# Range, not a single draw
EVAL_LIVE=1 EVAL_LIVE_REPEATS=3 EVAL_LIVE_MODEL=gpt-4o-mini npm run eval:ai:live
```

If `EVAL_LIVE` or `OPENAI_API_KEY` is missing, `eval:ai:live` **prints a skip message and exits 0**.

## What it checks

1. Case Q&A smoke fixtures (`packages/ai/src/evals/fixtures.ts`)
2. Golden graded cases with faithfulness / completeness / evidence_state / need_more_docs
3. Quote validator smoke
4. Baseline regression gate against mock-proven graded baselines

Budget exhaustion mid-suite fails remaining cases with a clear token/USD reason.

## Optional CI (manual / nightly)

Workflow: [`.github/workflows/eval-ai-live.yml`](../.github/workflows/eval-ai-live.yml)

- `workflow_dispatch` (manual)
- `schedule` — nightly UTC when secrets are configured
- **Not** triggered on `pull_request` or every push

Required repository secret: `OPENAI_API_KEY`
Optional variable: `EVAL_LIVE_MODEL` (defaults to `gpt-4o-mini`)

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

Use a **new** `EVAL_EXPORT_DIR` for each live packet. See [`AGENT_QUALITY_ATTORNEY_REVIEW.md`](./AGENT_QUALITY_ATTORNEY_REVIEW.md) for the human review process.
