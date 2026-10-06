# A/B integration checkpoint — 2026-10-06

Classification: `INTEGRATION_CERTIFIED`

Main promotion: `READY_FOR_MAIN_PROMOTION`

The corpus and deepening branches merged cleanly on `nyaya/integration-checkpoint`. Deterministic product, search, Week 5, Week 6, and Week 7 gates passed, and the production web build passed. After Chat A and Chat B confirmed they were stopped, the shared runtime lock was held and the signed-in warrant and prosecution E2E suites passed against local product Postgres only. No CourtListener calls and no Neon corpus writes were made.

## Source state

| Ref | SHA |
| --- | --- |
| `main` / `origin/main` / integration base | `8c823dc701058d89c3308c0e40da9dde228ae1be` |
| Chat A `origin/nyaya/full-completion-deepening` | `238c3b30878d146082ba8ae6d69f73ef6f384028` |
| Chat B `origin/nyaya/corpus-citation-strengthening` | `7c77174666ee4ccd0882863a05a67abd607b3c00` |
| Week 7 RC commit `rc-week7-2026-10-06` | `49a8026fa4161635f269339622c045a3936ba28c` |

The Week 7 tag was not moved. The original checkout at `C:\Users\patel\Documents\nyayagrid` was not merged, cleaned, reset, or committed. It remained on `main` at `8c823dc` with the same 393 dirty entries.

The integration path already existed as a clean git worktree on `nyaya/integration-checkpoint` at `origin/main`. It contained the repository checkout, not unrelated user files. It was not deleted or recreated.

## Merges

| Merge | SHA | Conflicts |
| --- | --- | --- |
| B, non-fast-forward: Integrate corpus citation strengthening Pass 1 | `1c34e3d900bb56159722d41fba3747189e4389e5` | none |
| A, non-fast-forward: Integrate full-completion deepening Passes 1 and 2 | `78b4d345cf9720f63cc81ab8db180642d0c06032` | none |

Integration HEAD before this report: `78b4d345cf9720f63cc81ab8db180642d0c06032`. Working tree was clean after both merges. `package-lock.json` was not changed by `npm ci`.

## Corpus artifact

Committed certified snapshot `packages/research/corpus/reports/corpus-strengthening-pass1-snapshot-certified.json`:

| Field | Value |
| --- | --- |
| cases | 4680 |
| authorities | 6035 |
| extracted | 50623 |
| resolved | 6306 |
| unresolved | 44317 |
| health | GREEN |
| duplicates / orphans / missing embeddings / FAILED / NOT_PROCESSED / silent CURRENT / present-target defects | 0 |

Live Neon recheck: `NEON_LIVE_RECHECK_SKIPPED`. Local `DATABASE_URL` values point at `localhost:5433/nyayagrid`, which is the product database, not the Week 2 corpus store. No CourtListener calls and no Neon writes were made. Git merge does not change Neon data.

## Tests

| Gate | Result |
| --- | --- |
| Deepening Pass 1 | PASS. `deepening.test.ts` 8/8. Benchmark grades `D1-LF-01`, `D1-PR-01`, `D1-LONG-01`, `D1-CONSIST-01`, `D1-STALE-01`, `D1-ERR-01` passed. |
| Deepening Pass 2 | PASS. `suppression-review.test.ts` 10/10. Benchmark grades `D2-PR-WARRANT-01`, `D2-PR-WARRANT-02`, `D2-PR-MIRANDA-01`, `D2-ASK-SUPPRESS-01`, `D2-AUTH-HIER-01`, `D2-MISSING-FACTS-01` passed. Deepening bench 12/12. |
| Ask suppression | PASS. `ask-suppression-context.test.ts` 6/6. Suppression questions receive structured context with null conclusions. Non-suppression prosecution questions and law-firm Ask stay unchanged. |
| Week 5 | PASS. `WEEK5_PASS_OPEN_WEEK6`. 27/27, critical 0, high 0. Expected answers were not edited. |
| Week 6 | PASS. `WEEK6_PASS_OPEN_WEEK7`. 31/31, critical 0, high 0. |
| Week 7 | PASS. `WEEK7_PASS_READY_FOR_FINAL_CERTIFICATION`. 9/9, critical 0, high 0. External gates recorded Week 5 PASS, Week 6 PASS, production build PASS. |
| Prosecution unit | PASS. `prosecution.test.ts` 5/5 and `week3-completion.test.ts` 13/13. |
| Prosecution DB integration | Product-path covered by signed-in E2E. Vitest `RUN_DB_TESTS=1` suite was not separately invoked. |
| Law firm | PASS. `D1-LF-01` and the law-firm Ask Nyaya suppression gating test. |
| Authority hierarchy | PASS. Federal issue: SCOTUS binding, Third Circuit binding, EDPA persuasive. Pennsylvania constitutional issue: PA Supreme binding, PA Superior binding on the state trial forum. Treatment remains `UNVERIFIED`. No manual override was introduced. |
| Neon retrieval smoke | NOT RUN live. Committed final-cert artifact records Gates, Leon, Tracey, Katzin, the EDPA Google warrant opinions, and PA authorities as present. Signed-in warrant flow used the embedded source-backed catalog (`462 U.S. 213` Gates on PROBABLE_CAUSE only, treatment UNVERIFIED). |
| Browser / signed-in `e2e/pass2-warrant.spec.ts` | PASS. 1/1. Multi-warrant suppression review stays separated without decisions. |
| Browser / signed-in `e2e/prosecution.spec.ts` | PASS. 2/2. Section walkthrough and overview evidence/issue separation without guilt. |
| Production build `npm run build` (`apps/web`) | PASS. Next.js 15.5.27 compiled and generated 78 static pages. |

Decision guardrails in deepening, suppression unit tests, Ask suppression tests, and signed-in E2E: suppression conclusion null, warrant validity null, guilt conclusion null, unsupported treatment labels 0.

## Shared runtime validation

```
SHARED_RUNTIME_LOCK_HELD
workstream: INTEGRATION CHECKPOINT
operation: signed-in e2e/pass2-warrant.spec.ts and e2e/prosecution.spec.ts
services: Playwright-started Next.js on :3000, Inngest on :8288, local product Postgres :5433, MinIO :9000, Redis :6379
database: postgresql://nyayagrid:***@localhost:5433/nyayagrid (product only)
courtListener: none
neonWrites: none
expected mutations: test-created organizations, criminal cases, defendants, evidence, warrants, and related prosecution records in local product Postgres
result: PASS
```

Chat A and Chat B confirmed stopped. Signed-in validation completed. Shared runtime lock released after certification packaging.

## Diff classification

Net diff `origin/main` to `78b4d345cf9720f63cc81ab8db180642d0c06032`. Unexpected paths: none.

`B_CORPUS` (8):

- `scripts/tmp-pass1-edpa-recovery.cjs`
- `scripts/tmp-pass1-end-census.cjs`
- `scripts/tmp-pass1-final-cert.cjs`
- `scripts/tmp-pass1-finish-stuck-processing.cjs`
- `scripts/tmp-pass1-forum-warrant-targets.cjs`
- `scripts/tmp-pass1-neon-identity.cjs`
- `scripts/tmp-pass1-repair-court-map.cjs`
- `scripts/tmp-queue2-cite-demand-multi-ingest.cjs`

`REPORT` (34), all under `packages/research/corpus/reports/`:

- `corpus-strengthening-pass1-blocked.json`
- `corpus-strengthening-pass1-chat-a-handoff-resume.json`
- `corpus-strengthening-pass1-chat-a-handoff.json`
- `corpus-strengthening-pass1-demand-discovery.json`
- `corpus-strengthening-pass1-edpa-ingest.json`
- `corpus-strengthening-pass1-edpa-recovery.json`
- `corpus-strengthening-pass1-end-census.json`
- `corpus-strengthening-pass1-end-reresolve.json`
- `corpus-strengthening-pass1-existing-warrant-scan.json`
- `corpus-strengthening-pass1-final-cert.json`
- `corpus-strengthening-pass1-final-reresolve.json`
- `corpus-strengthening-pass1-final.json`
- `corpus-strengthening-pass1-forum-c-court-repair.json`
- `corpus-strengthening-pass1-forum-court-repair.json`
- `corpus-strengthening-pass1-forum-ingest-a.json`
- `corpus-strengthening-pass1-forum-ingest-b.json`
- `corpus-strengthening-pass1-forum-ingest-b1.json`
- `corpus-strengthening-pass1-forum-ingest-c.json`
- `corpus-strengthening-pass1-forum-warrant-targets.json`
- `corpus-strengthening-pass1-neon-identity-resume.json`
- `corpus-strengthening-pass1-pa-court-repair.json`
- `corpus-strengthening-pass1-pa-retry-court-repair.json`
- `corpus-strengthening-pass1-pa-retry.json`
- `corpus-strengthening-pass1-quota-probe.json`
- `corpus-strengthening-pass1-resume-complete.json`
- `corpus-strengthening-pass1-resume-key-missing.json`
- `corpus-strengthening-pass1-scotus5-ingest.json`
- `corpus-strengthening-pass1-scotus5-reresolve.json`
- `corpus-strengthening-pass1-snapshot-certified.json`
- `corpus-strengthening-pass1-snapshot.json`
- `corpus-strengthening-pass1-stuck-processing-closeout.json`
- `corpus-strengthening-pass1-zero-cl-resolve-dry.json`
- `corpus-strengthening-pass1-zero-cl-resolve.json`
- `week2-corpus-access-recovery.json`

`A_PRODUCT` (20):

- `apps/web/src/app/api/v1/prosecution/cases/[caseId]/[resource]/route.ts`
- `apps/web/src/components/prosecution/case-section.tsx`
- `apps/web/src/components/prosecution/warrant-review.tsx`
- `packages/intelligence/src/index.ts`
- `packages/intelligence/src/week4/ask-context.ts`
- `packages/intelligence/src/deepening/consistency.ts`
- `packages/intelligence/src/deepening/decompose-matter.ts`
- `packages/intelligence/src/deepening/evidence-scope.ts`
- `packages/intelligence/src/deepening/fixtures.ts`
- `packages/intelligence/src/deepening/freshness.ts`
- `packages/intelligence/src/deepening/index.ts`
- `packages/intelligence/src/deepening/whole-matter.ts`
- `packages/intelligence/src/prosecution/index.ts`
- `packages/intelligence/src/prosecution/memory.ts`
- `packages/intelligence/src/prosecution/postgres.ts`
- `packages/intelligence/src/prosecution/suppression-catalog.ts`
- `packages/intelligence/src/prosecution/suppression-fixtures.ts`
- `packages/intelligence/src/prosecution/suppression-holding-screen.json`
- `packages/intelligence/src/prosecution/suppression-review.ts`
- `packages/intelligence/src/prosecution/suppression-source-backed.ts`

`APPROVED_SHARED` (1):

- `packages/search/src/nyaya.ts`

`TEST` (14):

- `benchmarks/nyaya-bench/datasets/deepening/catalog.ts`
- `benchmarks/nyaya-bench/package.json`
- `benchmarks/nyaya-bench/runner/deepening.ts`
- `benchmarks/nyaya-bench/tests/deepening.test.ts`
- `benchmarks/nyaya-bench/vitest.config.ts`
- `e2e/pass2-warrant.spec.ts`
- `e2e/prosecution.spec.ts`
- `packages/intelligence/src/deepening/deepening.test.ts`
- `packages/intelligence/src/prosecution/prosecution.integration.test.ts`
- `packages/intelligence/src/prosecution/suppression-review.test.ts`
- `packages/search/src/ask-suppression-context.test.ts`
- `scripts/pass2-db-warrant-validate.mjs`
- `scripts/pass2-gen-source-backed.cjs`
- `scripts/pass2-holding-screen-strict.cjs`

`UNEXPECTED`: none.

Chat A did not modify corpus paths. Chat B did not modify `apps/web`, product intelligence, migrations, the lockfile, or the root package manifest.

## Security

No secrets, CourtListener token, Neon password, or `DATABASE_URL` value were committed. No migration was added. The lockfile did not drift. Operational reports name the Neon host `ep-jolly-brook-auhdpay3-pooler.c-10.us-east-1.aws.neon.tech` and state that a key was missing. They do not contain the key or a connection string.

## Known limitations

- F.Supp.2d lookup normalization still fails the exact string-match gate (`EDPA_LOOKUP_LIMITATION` in the certified snapshot). No shared architecture change was made.
- Treatment on the pass authorities remains unverified. Unsupported treatment labels in the deepening tests are 0.
- Civil claims, defenses, and counterclaims have no schema. Deepening only pattern-matches those words in `decompose-matter.ts`.
- Discovery production ledger is thin.
- Trial preparation is absent or thin.
- Nyaya Memory automatic refresh is incomplete.
- Paid-model certification is pending.
- Live Neon Week 2 corpus health was not re-queried in this session (`NEON_LIVE_RECHECK_SKIPPED`). Signed-in product E2E used embedded source-backed warrant authorities, not a live Neon read.

## Priority

- P0: none for this checkpoint. Signed-in E2E passed.
- P1: Read-only Neon health and warrant-authority retrieval when a corpus connection string is available. Do not replay ingestion.
- P2: F.Supp.2d normalization, treatment verification, and the structural gaps listed above.

## Tag and promotion

`rc-deepening-pass2-2026-10-06` is created at the certification commit on `nyaya/integration-checkpoint`. `rc-week7-2026-10-06` remains at `49a8026fa4161635f269339622c045a3936ba28c`.

`nyaya/integration-checkpoint` and the new tag are pushed. `main` is not updated.

After this checkpoint is promoted to `main`, recreate the Chat A and Chat B branches from that main before Deepening Pass 3. The next structural target is civil claims, defenses, and counterclaims. That work needs schema coordination and must wait until this checkpoint is on `main`.

## Signed-in validation checklist

| Check | Result |
| --- | --- |
| Warrant detail flow | PASS |
| Suppression issues remain separated | PASS |
| Multi-warrant isolation | PASS |
| Cross-defendant evidence isolation | PASS |
| Ask Nyaya suppression wiring | PASS (`ask-suppression-context.test.ts` + signed-in suppressionReview payload used by Ask) |
| Suppression conclusion | null |
| Warrant-validity conclusion | null |
| Guilt conclusion | null |
| CourtListener calls during E2E | none |
| Neon corpus writes during E2E | none |