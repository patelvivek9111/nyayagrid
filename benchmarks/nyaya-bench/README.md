# Nyaya Bench

End-to-end reliability suite for NyayaGrid. Datasets are fictional SYNTH fixtures. This is **not** attorney review and is **not** a Harvey-level close-out.

## What this measures vs `eval:ai`

| Harness                            | Purpose                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run eval:ai` / `eval:ai:live` | Fast prompt/model/canary evaluation on golden snippets. **Keep this.**                                         |
| NYAYA-BENCH Case Q&A (`case-qa`)   | Full-PDF ingest + retrieval + `askNyayaAboutMatter`. Baseline A / A.1.                                         |
| NYAYA-BENCH full-system            | Routes a task through the real Compare / Contradiction / Timeline / Graph / Memory / Research / Draft pathway. |
| NYAYA-BENCH agents                 | `NyayaOrchestrator.runTask` → `createAgentRun` / `executeAgentRun`.                                            |

Do not replace `eval:ai` with NYAYA-BENCH.

## Isolation rule

NyayaGrid may ingest **only** `datasets/<v>/scenarios/<id>/documents/`.

`hidden_ground_truth/` is opened **only after** `reports/runs/<id>/answers/<taskId>.json` exists.

`review_packets/` is never ingested.

## Commands

```bash
npm run bench -- v1 list
npm run bench -- v1 run SYNTH-001 SYNTH-001-Q001
npm run bench -- v1 run SYNTH-001 --mode case-qa
npm run bench -- v1 run SYNTH-001 --mode full-system
npm run bench -- v2 --mode full-system-fs
npm run bench -- v2 run full-system-fs
npm run bench -- v1 run SYNTH-001 --mode compare
npm run bench -- regrade 2026-08-18T03-14-16-862Z 2026-08-18T03-20-13-556Z
npm run bench -- smoke-subsystems
```

`regrade` copies saved answers into a **new** run directory and grades with the current graders. Original run artifacts are not overwritten.

`replay` still writes grades into the same directory; prefer `regrade` for Baseline A.1.

Mode without `run` lists the catalog. Do not run 500 full-system live calls unless intended.

Modes with no compatible V1/V2 tasks (`graph`, `memory`, `research`, `draft`, `agents`) return `NOT_APPLICABLE_TO_SUBSYSTEM` unless a smoke override is used. See `SUBSYSTEM_ROUTING.md`.

## Scoring

Each applicable task is `pass` / `needs_work` / `fail`. Fixtures and expected facts are never edited to make the suite green.
