# NYAYA EVIDENCE MATRIX — Baseline EM1

Synthetic-fixture evaluation only. This is **not** attorney review.

**Label:** Baseline EM1 — Evidence Matrix / Analysis Integration against **unchanged** production

This score is **not** combined with AN1, DA1, or CA1. Those baselines are not overwritten.

Companion: `PHASE_6M_EVIDENCE_MATRIX_RELIABILITY.md`, `BASELINE_EM1_EVIDENCE_MATRIX.json`

Live persist: `benchmarks/nyaya-bench/reports/runs/2026-08-19T13-56-47-498Z`

A prior attempt (`2026-08-19T13-51-33-272Z`) hit `AI_TIMEOUT_MS` default 30s on extract/contract. Official EM1 used `AI_TIMEOUT_MS=180000` only; Evidence Matrix production code was not changed.

---

## Configuration

| Field | Value |
| --- | --- |
| Mode | `evidence` (`npm run bench -- v2 run evidence`) |
| Dataset | V2 overlay, SYNTH-V2-006 + SYNTH-V2-001, **28 tasks** |
| Structured grader | `em1-2026-08-19` |
| Model | openai `gpt-4o-mini` |
| Production API | `getEvidenceIntelligence` → `buildEvidenceMatrix` |
| Git commit recorded on run | `ea3be8784fbe7c560348d63ab75b7f1fe0d32e62` |

Overlay: `datasets/v2/evidence/catalog.json`. Hidden GT: `datasets/v2/hidden_ground_truth/evidence/`.

---

## Score (Evidence Matrix only)

| | |
| --- | --- |
| Pass | 26 / 28 |
| Needs work | 0 |
| Fail | 2 |
| Infrastructure | 0 |
| Critical | 0 |
| Proposition accuracy | 1.00 |
| Provenance accuracy | 0.93 (26/28; EM009 and EM021 fail) |
| Supporting-span accuracy | 1.00 (token overlap grader; citations still lack IDs) |
| Trust-status accuracy | 1.00 on live tasks |
| Disputed-evidence accuracy | 1.00 |
| Unsupported-evidence rate | 0 |
| Proposed→verified leakage rate | 0 |
| Wrong-document attribution rate | 0 |
| Duplicate/corroboration error rate | 0 |
| Missing-evidence fabrication rate | 0 |

---

## Failures

| Task | Class | Note |
| --- | --- | --- |
| SYNTH-V2-006-EM009 | B provenance | Approved matrix citations drop `documentId` / `chunkId` (13 citations). |
| SYNTH-V2-001-EM021 | B provenance | Same (24 citations). |

---

## Live-run caveats (not score-chased)

- **EM004** `proposedContradictionCount` was **0** (detector returned no findings). The audit still shows production **includes proposed contradiction findings** as `contrary`. That trust leak was not exercised by this live detector output.
- **EM025** did not observe same-document event+fact pairing (`sameDocumentEventLinkedAsSupport` = 0). The coarse documentId join remains in production.
- Contract/Deposition Analysis still **do not appear** in the matrix (completeness, not a leak).
- Empty-matrix adversarial tasks (badge entry, invoice silence, Exhibit Z, email-as-contract) passed because the matrix does not invent issues from proposed/unverified material.

---

## Freeze

EM1 is the pre-change baseline. Do not overwrite this file after EM2.
