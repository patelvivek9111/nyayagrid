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
| `EVAL_LIVE_USD_PER_1M_INPUT` | No | `0.15` (budget math only) |
| `EVAL_LIVE_USD_PER_1M_OUTPUT` | No | `0.60` (budget math only) |

Pin the model deliberately. Prefer `EVAL_LIVE_MODEL=gpt-4o-mini` in CI secrets/vars so a developer’s local `OPENAI_MODEL` cannot silently change the regression target.

## Commands

```bash
# Deterministic, free, CI-safe (every PR)
npm run eval:ai

# Live OpenAI — only when explicitly enabled
EVAL_LIVE=1 OPENAI_API_KEY=... EVAL_LIVE_MODEL=gpt-4o-mini npm run eval:ai:live
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
npm run eval:ai -w @nyayagrid/ai
```

Then run live with tight caps while iterating:

```bash
EVAL_LIVE=1 EVAL_LIVE_MAX_USD=0.25 EVAL_LIVE_MAX_TOKENS=40000 npm run eval:ai:live
```
