# Facilitator notes — do not send this file to reviewers

## Status

READY-FOR-HUMAN-REVIEW. No attorney scores are in `completed/` yet. Do not declare DOGFOOD PASS.

## Do not send reviewers

- `datasets/**/hidden_ground_truth/`
- FW1 grader expected answers
- This file’s post-review keys
- Real client documents
- API keys, `.env`, audit logs with file text

## How to run a session

1. `npm run dogfood:pack -w @nyayagrid/nyaya-bench` (0 model calls).
2. Zip `dogfood/dist/packets/DF-xx` plus `REVIEWER_INSTRUCTIONS.md`, `RUBRIC.md`, `REVIEW_PACKET.md`, and `forms/*.csv`.
3. Assign 2–3 matters per reviewer (see suggested load in `catalog.ts`).
4. Optional live Case: seed the SYNTH documents in a professional workspace. FEATURE_AGENTS=0. Do **not** rerun V3.1 or the full 12-matter FW suite for this pack.
5. If you generate live outputs, put them in `dogfood/dist/packets/DF-xx/outputs/` and tell the reviewer that path. Budget ~$0.09 per FW-style matter from the last performance gate; six matters would be on the order of **~$0.5** if you insist on a fresh live pass. Not required to start review.
6. Collect CSVs into `dogfood/completed/` named `{reviewer}_reviews.csv` and `{reviewer}_issues.csv`.
7. `npm run dogfood:aggregate -w @nyayagrid/nyaya-bench`.
8. **After** scores are in, you may compare privately to FW1 / V2 hidden truth. Never average away CRITICAL.

## Late wire

`sources-late/` is for the revise-with-new-evidence pass. Give it to the reviewer only after they have scored the first draft.

## Human-only actions

A model or operator cannot:

- Decide “would I send this to a client with light editing?”
- Close DOGFOOD PASS
- Waive a CRITICAL fabrication finding
- Score legal-reasoning usefulness as an admitted lawyer

Operator scoring of source-faithfulness is allowed as advisory Layer 1 only.
