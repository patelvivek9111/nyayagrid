# NYAYA-BENCH Synthetic Test Set V1

SYNTH - FICTIONAL TEST DOCUMENT - NOT REAL CLIENT WORK

This package contains **10 fully fictional legal matters and 100 benchmark tasks** for testing NyayaGrid.

## Important separation

- `scenarios/` contains only material that may be shown to NyayaGrid during an evaluation.
- `hidden_ground_truth/` contains the answer key and **must never be ingested into the matter being tested**.

## Included test families

Case Q&A, insufficient-information/abstention, contract comparison, non-material decoys, numeric precision, genuine contradictions, false contradictions, timelines, amendment/supersession, entity/fact reasoning, and evidence-grounded reasoning.

## Recommended Cursor behavior

1. Create one isolated synthetic matter per scenario.
2. Upload only that scenario's `documents/*.pdf`.
3. Run each task from `tasks/tasks.json`.
4. Capture answer + citations.
5. Only after execution, load the corresponding file from `hidden_ground_truth/`.
6. Grade exact facts deterministically where possible; use semantic evaluation only where needed.
7. Never expose the hidden answer key to NyayaGrid's retrieval context.

## Safety / meaning

These tests measure behavior against intentionally authored fictional ground truth. They do **not** prove legal correctness, attorney approval, or readiness for unsupervised legal use.
