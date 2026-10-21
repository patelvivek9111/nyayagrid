# Nyaya Bench baselines

These are synthetic-fixture scores, **not** attorney review.

## Retained Markdown gate / baseline docs

Actively used by runners and tests (do not delete):

| Doc | Role |
| --- | --- |
| `BASELINE_6T_C1_50_STATE.md` | 50-state jurisdiction baseline |
| `BASELINE_6T_C2A_REAL_STATE_BATCH.md` | Real-state batch baseline |
| `BASELINE_6T_CORPUS1.md` | Corpus build baseline |
| `PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md` | 6T certification gate |
| `PHASE_6T_C2A_INITIAL_STATE_CERTIFICATION.md` | C2A certification gate |
| `PHASE_6T_CORPUS_BUILD.md` | Corpus build gate |
| `BASELINE_6U_FSJ1.md` / `BASELINE_6U_FSJ2.md` | Full-system jurisdiction baselines |
| `PHASE_6U_JURISDICTION_FULL_SYSTEM_BETA_GATE.md` | 6U beta gate |
| `PHASE_6U_R1_TARGETED_REMEDIATION.md` | 6U remediation gate |
| `PHASE_6V_GENERAL_QUALITY_90_PLUS.md` | 6V quality gate |

## JSON score artifacts

Historical Case Q&A / Compare / 6W JSON baselines remain under this directory (e.g. `BASELINE_A1_*.json`, `BASELINE_6W_*.json`). Prefer the Markdown gates above for human-readable certification context. Do not overwrite frozen JSON score files or raw run directories under `reports/runs/`.

`eval:ai` / `eval:ai:live` is a separate prompt/canary harness and is not replaced by these baselines.
