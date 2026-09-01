# BASELINE FS2 — Full-system (after one Draft guard)

**Run:** `reports/runs/2026-08-19T17-54-31-465Z`  
**Mode:** `full-system-fs`  
**Grader:** `fs1-2026-08-19`  
**Attorney reviewed:** no (synthetic only)

## Counts

| PASS | NEEDS WORK | FAIL | INFRA | CRITICAL |
| --- | --- | --- | --- | --- |
| 31 | 1 | 0 | 0 | 0 |

## Production change (after FS1)

One Draft trust-boundary: `applySourceLimitationGuard` plus prompt labeling of instructions as non-evidence. FS1 JSON was not overwritten.

## FS1 → FS2

| Task | FS1 | FS2 |
| --- | --- | --- |
| FS020 | FAIL | PASS |
| FS029 | FAIL | NEEDS WORK (disclosure only; unprocessed not treated as ready) |
| All other scored tasks | PASS | PASS |

No PASS → FAIL.

FS029 remains a completeness residual: Ask said evidence was insufficient without naming the `uploaded` amendment.
