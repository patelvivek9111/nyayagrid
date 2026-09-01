# PHASE 6T — CORPUS ENVIRONMENT RECONCILIATION

Generated: 2026-08-20T13:56:30.000Z

This document explains why PHASE 6T-CORPUS-1 reported 30 real primary authorities while the last `bench:6t` C1 snapshot reported 7 synthetic rows, and records the operational fix. **C2A was not started. 6U was not started.** Historical C1 files were not overwritten.

---

## 1. Executive Summary

The two results described **the same persistent Docker database at different times**, plus a stale C1 artifact.

| Result | When | What it measured |
|--------|------|------------------|
| **B — C1** `BASELINE_6T_C1_50_STATE.*` | 2026-08-20T02:34:08.812Z | Live `legal_authorities` **before** corpus import: **7** synthetic/unmapped rows |
| **A — CORPUS-1** | 2026-08-20T02:49:58.660Z (original) / 13:55:39.800Z (reverify) | Same DB **after** import: **30** `us-primary-corpus` + **7** synthetic |

The 30 real authorities were never missing from the certification database. They were imported into Docker PostgreSQL `nyayagrid` on host port **5433** (container `nyayagrid-postgres`). C1 was not re-run after import, and `bench:6t` was written to **overwrite** that historical empty-corpus snapshot.

Additional operational bugs made the mismatch look like two databases:

1. `research:corpus-import` did not load repo `.env`; bench runners did.
2. `t6t-corpus1.ts` left the Drizzle/postgres.js pool open, so `npm run bench:6t-corpus1` **hung after writing CORPUS-1 JSON** and did not always chain into inventory.
3. `t6t-c1.ts` hard-coded every state's corpus task as empty (`0 mapped US-state authorities`) and rewrote `jurisdiction_coverage` to `unvalidated`.
4. `t6t-inventory.ts` counted all rows together and did not label real vs synthetic coverage.

**Intended certification environment (now explicit):** persistent local Docker database `nyayagrid` at `localhost:5433`, schema `public`, `NODE_ENV=development`. Real coverage counts only `us-primary-corpus`. Synthetic R1 fixtures remain in the same DB but are excluded from real-state counts.

After the fix: import is idempotent (30 skipped), corpus1 smoke is 4/4, and `bench:6t` inventory sees **10 states / 30 real / 20 statutes / 10 cases**. Historical C1 remains frozen at 7/0.

---

## 2. Database Used by Each Command

Credentials are never logged. Identity is host / port / database name / schema only.

| Command | Cwd | Env loading (before fix) | Env loading (after fix) | Effective DB |
|---------|-----|--------------------------|-------------------------|--------------|
| `npm run research:corpus-import` | `packages/research` | **None.** Required `process.env.DATABASE_URL` or threw | Repo `.env` then optional `packages/research/.env`; fallback `localhost:5433/nyayagrid` | `localhost:5433` / `nyayagrid` / `public` |
| `npm run bench:6t-corpus1` | `benchmarks/nyaya-bench` | `loadBenchEnv()`: repo `.env` then `benchmarks/nyaya-bench/.env` | Unchanged + redacted identity log + **process.exit(0)** so the npm `&&` chain continues | Same |
| `npm run bench:6t` | `benchmarks/nyaya-bench` | Same `loadBenchEnv()` | Same + inventory prints identity; C1/write-report **refuse to overwrite** historical C1 | Same |

Observed dotenv files:

| File | Present | Role |
|------|---------|------|
| `.env` (repo root) | yes | Source of `DATABASE_URL` for benches and, after the fix, corpus-import |
| `benchmarks/nyaya-bench/.env` | **no** | No bench-specific override |
| `packages/research/.env` | **no** | No package override |
| `apps/web/.env` | yes | Next.js / app only. Same host `localhost:5433` / db `nyayagrid`. **Not loaded by these three commands.** |

`APP_ENV` is **unset** in the loaded root `.env` (`NODE_ENV=development`). That is not a second database. Docker Compose Postgres is `nyayagrid-postgres` (`5433→5432`). A separate `supabase_db_avarta` listens on host port **55022** and is **not** referenced by these commands.

No `TEST_DATABASE_URL`, no vitest DB swap, no transaction wrapper around corpus import. Search path: `"$user", public`. Current schema: `public`.

---

## 3. Why Counts Diverged

**Not two databases. Not a filter that hid 30 rows from a live `SELECT`. Not a rollback.**

Evidence:

1. **Time order.** C1 `generatedAt` is `2026-08-20T02:34:08.812Z` (7 rows). CORPUS-1 original `generatedAt` is `2026-08-20T02:49:58.660Z` (30 real + 7 synthetic in the same inventory). C1 ran ~16 minutes **before** the corpus1 baseline.
2. **Same row identities.** Re-import skipped the same UUIDs recorded in CORPUS-1 (example: PA UCC `7aa3de60-b425-4109-bc54-55bfb7bba6eb`). Those rows exist now in Docker `nyayagrid`.
3. **Live query during this phase.** `legal_authorities` = 37 = 30 `us-primary-corpus` + 2 `synthetic-fixtures` + 4 `nyaya-bench-research-overlay` + 1 `nyaya-bench-full-system`.
4. **Stale C1 files.** `bench:6t` writes `BASELINE_6T_C1_50_STATE.json/.md`. Those files were never regenerated after import, so operators reading C1 still saw “7 / 0 mapped / 51 UNVALIDATED.”
5. **C1 grader ignored live corpus.** Even a fresh C1 run marked every `T6T-{state}-10` corpus task `NEEDS_WORK` with the hard-coded sentence “Local corpus has 0 mapped US-state authorities,” and always wrote `jurisdiction_coverage` as `unvalidated`.
6. **Corpus1 process leak.** `createDb()` opens a postgres.js pool. `t6t-corpus1.ts` did not `process.exit` on success, so `bench:6t-corpus1` (`t6t-corpus1 && t6t-inventory && t6t-corpus1-report`) could hang after persisting 30 authorities. Inventory written at `03:42:43Z` (37 rows) was a **later separate process**, not proof of a second DB.

Hypothesis mapping:

| Hypothesis | Verdict |
|------------|---------|
| A. Exist in another database | **No** for the 30. They are in Docker `nyayagrid`. Host also has Supabase on 55022; these commands do not use it. |
| B. Imported into a test DB later reset | **No.** Vitest bench config has no DB. Integration tests that `DELETE legal_authorities` target `synthetic-fixtures` only, and only when `RUN_DB_TESTS=1`. |
| C. Hidden by corpus/source filtering | **Partial, C1 only.** `buildCorpusInventory` already excluded synthetics. `t6t-inventory` previously mixed totals; state mapping already ignored unmapped synthetics. C1 report used the mixed total and hard-coded empty corpus. |
| D. Deleted by benchmark setup/teardown | **No.** `bench:6t` does not truncate `legal_authorities`. It historically **did** upsert all `jurisdiction_coverage` rows to `unvalidated`. |
| E. Import transaction did not persist | **No.** Import is per-authority, auto-commit. Re-import now skips 30 persisted rows. |
| F. Inventory query excludes them incorrectly | **Was true for C1 narrative / unfiltered totals; not true for live SQL `SELECT * FROM legal_authorities`.** Fixed: real coverage is `us-primary-corpus` only. |
| G. Never present in the DB used by then-current `bench:6t` | **True at 02:34 (pre-import). False after import.** The C1 files still described 02:34. |

---

## 4. Location of Real Corpus

**Database:** Docker `nyayagrid-postgres` → `localhost:5433` / database `nyayagrid` / schema `public`.

**Provider:** `us-primary-corpus` (30 rows).

**States (3 authorities each):** CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA.

**Types:** 20 statutes, 10 cases, 0 regulations.

**Synthetic (same table, excluded from real coverage):** 7 rows (`synthetic-fixtures`, `nyaya-bench-research-overlay` with `metadata.synthetic=true`, `nyaya-bench-full-system`).

The 30 were persisted by `importAuthority()` during CORPUS-1 (original run skipped 30 because an earlier import in that environment had already committed). This reconciliation did **not** re-insert them.

---

## 5. Benchmark Cleanup Behavior

`bench:6t` = `t6t-inventory.ts && t6t-c1.ts && t6t-write-report.ts`.

| Behavior | Present? |
|----------|----------|
| Seed synthetic authorities | No |
| Truncate `legal_authorities` | **No** |
| Reset / recreate database | **No** |
| Replace corpus rows | **No** |
| Dedicated bench database | **No** — same persistent Docker `nyayagrid` |
| Clean corpus rows on completion | **No** |
| Overwrite historical C1 files | **Yes, previously.** Now frozen unless `T6T_OVERWRITE_C1=1` |
| Rewrite `jurisdiction_coverage` to `unvalidated` | **Yes, previously** (hard-coded “0 mapped” note). Skipped while C1 is frozen |

`bench:6t-corpus1` imports via production `batchImportCorpusAuthorities` (idempotent), runs smoke retrieval, writes CORPUS-1 baselines, then inventory. It does not delete real corpus rows. It now exits so inventory always runs in the same npm script.

Older R1/full-system benches ingest **matter documents** and overlay synthetic authorities; they must not be used as a reason to wipe `us-primary-corpus`.

---

## 6. Corpus Filtering

Real coverage inventory now counts **only** `source_provider = us-primary-corpus`.

| Class | Count | Used in real-state certification? |
|-------|------:|-----------------------------------|
| `us-primary-corpus` | 30 | **Yes** |
| `synthetic-fixtures` | 2 | No (R1 fixtures) |
| `nyaya-bench-research-overlay` | 4 | No (`metadata.synthetic`) |
| `nyaya-bench-full-system` | 1 | No (`metadata.synthetic`) |

`buildCorpusInventory` already used `isSyntheticBenchSource` / `US_PRIMARY_CORPUS_PROVIDER`. `t6t-inventory.ts` now uses the same split and records `environment` (redacted DB identity) on `BASELINE_6T_CORPUS_INVENTORY.json`.

---

## 7. Fix Applied

Smallest operational/configuration change. No blind re-import; no new database; no C2A.

1. **Shared env for corpus-import.** `packages/research/src/cli/load-root-env.ts` loads repo `.env` (same non-overriding contract as `loadBenchEnv`). Fallback URL matches benches: `localhost:5433/nyayagrid`.
2. **Process lifetime.** `corpus-import.ts` and `t6t-corpus1.ts` `process.exit` after success so npm `&&` chains run.
3. **Redacted DB identity** on import, corpus1, inventory, and `npm run corpus:db-identity`.
4. **Real vs synthetic inventory** in `t6t-inventory.ts` + `summarizeCorpusCoverage()`.
5. **Freeze historical C1.** `shouldPreserveHistoricalC1()` skips rewriting `BASELINE_6T_C1_50_STATE.*`, `PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md`, and `jurisdiction_coverage`. Recertification is C2A. Override only with `T6T_OVERWRITE_C1=1`.
6. **Inventory type-safety** in `buildCorpusInventory` (`sourceProvider` null, count destructure).

Intended certification target (code constant `intendedCertificationTarget()`):

```
label: persistent-local-docker-nyayagrid
host: localhost
port: 5433
database: nyayagrid
appEnv: development
realSourceProvider: us-primary-corpus
```

---

## 8. Post-Fix DB Inventory

From `npm run corpus:db-identity` and live SQL (no secrets):

| Field | Value |
|-------|------:|
| Host:port / database / schema | `localhost:5433` / `nyayagrid` / `public` |
| Total `legal_authorities` | 37 |
| Real `us-primary-corpus` | **30** |
| Synthetic (all classes) | **7** |
| Real statutes | 20 |
| Real cases | 10 |
| Real regulations | 0 |
| Real normalized `authorityState` | 30 |
| Real `courtId` | 10 |
| States with real authorities | 10 (CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA) |

---

## 9. Corpus1 Reverification

`npm run research:corpus-import` (cwd `packages/research`, DB `localhost:5433/nyayagrid`):

- **30 skipped, 0 imported, 0 new versions, 0 errors**

`npm run bench:6t-corpus1` (cwd `benchmarks/nyaya-bench`, **same DB**):

- Real primary authorities: **30**
- Smoke: **4/4 PASS** (pa-statute, pa-case, ny-macpherson, de-decoy-from-pa)
- Second import in-harness: **idempotent**
- States with meaningful coverage (≥2 real): **10**
- Process **exited**; chained inventory ran in the same command

---

## 10. 6T Inventory Reverification

`npm run bench:6t` now:

1. Writes live inventory (real/synthetic split + environment).
2. Prints frozen C1 vs live inventory; **does not overwrite C1**.
3. Skips regenerating the empty-corpus Phase 6T certification markdown.

Live inventory after this run:

| Metric | C1 historical (frozen) | Live inventory |
|--------|------------------------|----------------|
| Total rows | 7 | 37 |
| Mapped US states | 0 | **10** |
| Real primary | n/a (pre-corpus) | **30** |
| Real statutes / cases | 0 / 0 | **20 / 10** |
| 51 empty-corpus NEEDS WORK | recorded in C1 | **not expected from live inventory** |

C1 remaining `51 NEEDS WORK` is the **frozen empty-corpus architecture snapshot**, not the current corpus state.

---

## 11. Safety / Regression Impact

- Historical `BASELINE_6T_C1_50_STATE.json` / `.md` / `PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md` **unchanged** (`generatedAt` still `2026-08-20T02:34:08.812Z`).
- Real corpus rows **not deleted**.
- Synthetic R1 fixtures **retained**.
- `jurisdiction_coverage` **not** re-stamped unvalidated during this run.
- Research unit tests: 44 passed. Nyaya-bench tests: 123 passed (including C1 freeze + live inventory isolation).
- No production Ask/Draft/Research behavior change beyond CLI/bench operational wiring.
- C2A must use a **new** baseline filename. Do not unfreeze C1.

---

## 12. C2A Readiness

**Environment: ready. Certification: not started.**

C2A can use this same persistent Docker `nyayagrid` database. It currently contains the 30 real authorities and 7 synthetic fixtures. Inventory and smoke pass. C1 empty-corpus result is preserved as history.

C2A still must:

- Grade retrieval/statute/case tasks against **real** corpus (not the hard-coded C1 empty-corpus task).
- Write **new** baseline files (e.g. `BASELINE_6T_C2A_*`).
- Not claim 50-state or nationwide certification from a 10-state initial batch.
- Keep synthetics out of real coverage counts.

**Do not start C2A in this phase. Do not start 6U.**

---

## 13. Exactly One Next Phase

**PHASE 6T-C2A — CERTIFY INITIAL ELIGIBLE STATE BATCH**

Do not begin automatically.

---

## Explicit Questions

1. **Were corpus1 and bench:6t using the same database?**  
   **Yes**, once `.env` is loaded: Docker `localhost:5433/nyayagrid`. Before the fix, corpus-import did not load `.env` (could throw or follow a stray shell `DATABASE_URL`). C1 files were a **pre-import snapshot**, not a second DB.

2. **Where were the 30 authorities?**  
   Persisted in Docker `nyayagrid.public.legal_authorities` with `source_provider = us-primary-corpus`.

3. **Did any benchmark delete/reset them?**  
   **No.** `bench:6t` did not truncate corpus. It could overwrite C1 reports and coverage labels. Integration tests delete only `synthetic-fixtures` when `RUN_DB_TESTS=1`.

4. **Was the corpus1 count persisted or benchmark-local?**  
   **Persisted.** `batchImportCorpusAuthorities` → `importAuthority()` commits per authority. Smoke hits the same DB. CORPUS-1 “30 skipped” proves the rows already existed.

5. **Which database will C2A use?**  
   The same intended certification DB: **persistent local Docker `nyayagrid` at `localhost:5433`**.

6. **Does that database now contain all 30 real authorities?**  
   **Yes.** Confirmed by SQL, identity diagnostic, idempotent re-import (30 skipped), and inventory.

7. **Are synthetic authorities still excluded from real coverage?**  
   **Yes.** Inventory `realPrimaryAuthorities` / per-state counts use `us-primary-corpus` only. Synthetics remain for older R1 benches.

8. **Does re-import remain idempotent?**  
   **Yes.** 30 skipped, 0 imported, 0 duplicates, 0 errors.

9. **Can bench:6t inventory now see the 10 covered states?**  
   **Yes.** `statesWithRealAuthorities: 10` (CA, DE, FL, IL, MA, NJ, NY, PA, TX, VA).

10. **Is C2A safe to start?**  
    **Environment yes; this phase did not start it.** Start C2A only as the next dedicated phase, against this DB, with new baseline files, without overwriting C1.
