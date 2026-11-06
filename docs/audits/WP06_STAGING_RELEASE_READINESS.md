# WP-06 — Staging release readiness

**Classification:** `NYAYAGRID_WP06_STAGING_RELEASE_READINESS`  
**Branch:** `nyaya/integration-checkpoint`  
**Integration HEAD:** `134f3de2693ac2bb669d53c08928d171685f2a23`  
**Integration CI tip (code):** `84d061d201f0896bef66b06b8b7a17629eb133c4` — SUCCESS https://github.com/patelvivek9111/nyayagrid/actions/runs/42199704634  
**Main baseline:** `8d99bf3081ed0914554495907be8b409c663e6d2` (PR #9 merge)  
**Verdict:** `STAGING_MIGRATION_PREFLIGHT_BLOCKED`

## Merged PRs confirmed (on main — do not re-merge via Integration)

| PR  | Merge commit | Topic                                    |
| --- | ------------ | ---------------------------------------- |
| #6  | `1549eb53…`  | Professional RBAC / legal_support harden |
| #7  | `71989c12…`  | Prosecution Memory / Graph / CoC         |
| #8  | `2453d874…`  | Contacts / Folders                       |
| #9  | `8d99bf30…`  | Billing + migrations through **0032**    |

## Priority 1 — Integration vs main divergence audit

| Metric                                         | Value                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Commits `origin/main..HEAD`                    | **123**                                                               |
| Commits `HEAD..origin/main`                    | **0** (main fully contained)                                          |
| Three-dot files `origin/main...HEAD`           | **~1521** files (large historical surface)                            |
| WP-06 tip after merge `009f8cd..HEAD`          | **4** commits / **7** files (docs + local-cert / research fixture)    |
| Historical Integration-only before merge tip   | **~118** commits (Deepening, CI, docs, E2E) — **not** WP-06 migrate scope |
| `packages/database/drizzle` vs main            | **Identical** at HEAD (0032 already on main via PR #9)                |

**WP-06 / release-relevant tip commits**

1. `009f8cd` — merge main PR #6–#9 through migration 0032 into Integration  
2. `e0e7bd0` — staging readiness runbooks / schedule evidence / gate matrix  
3. `121e73b` / `84d061d` — Integration CI guards (local-cert DB URL; synthetic fixture retain)  
4. `134f3de` — docs: CI SUCCESS recorded for tip  

**Do not merge Integration → main.** Bulk three-dot delta is unrelated historical work. Product schema through 0032 is already on main.

## Priority 2 — Staging product DB preflight (read-only)

Executable script: `scripts/migration-safety/staging-product-db-preflight.mjs`  
Remote probe used this session: Fly SSH upload of read-only identity probe (no migrate, no DDL).

| Check                                        | Result                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `APP_ENV`                                    | `staging`                                                              |
| `DATABASE_URL` present                       | yes                                                                    |
| `CORPUS_DATABASE_URL` present                | **no**                                                                 |
| URL fingerprint                              | protocol `postgresql`; **Neon host**; db name **`neondb`**; hostHash `2cc0e36063b7` |
| Probe decision                               | **`NEON_OR_CORPUS_DATABASE_REFUSED`** — no SELECT against live DB      |
| HTTP ready                                   | **HEALTHY** — `gitSha=add3af3`; `neonCorpusResearch=off`; db/storage/redis/clamav ok |
| Fly Postgres clusters                        | none (staging DB is not Fly PG)                                        |
| Deployed image journal ceiling               | **0028_prosecution_office_operations** (`when=1788600000000`) — Deepening lineage |
| Integration/main journal ceiling             | **0032_prosecution_graph_integrity_contract** (`when=1789000000000`)   |

**Corpus isolation note:** WP-03C register records Neon project `nyayagrid-staging`, db `neondb`, corpus binding historically via `DATABASE_URL`. Current Fly secret set has the same `(Neon, neondb)` shape and **no** separate `CORPUS_DATABASE_URL`. Live SQL inventory was refused so the legal corpus cannot be touched by mistake.

## Priority 3 — Can migrate safely reach 0032 on real staging?

**No — not with current evidence.**

1. **Identity unresolved.** Staging `DATABASE_URL` matches corpus refusal criteria (`neon.tech` + `neondb`). Runbook forbids migrate until product DB name is attested and is not corpus.
2. **`when` lineage collision.** Deployed image (and likely any DB migrated under WP-05 `add3af3`) journals Deepening tags at the **same** `folderMillis` values main uses for PR #6–#9:

   | `when`         | Deployed (add3af3)                         | Integration / main                         |
   | -------------- | ------------------------------------------ | ------------------------------------------ |
   | 1788300000000  | `0025_drop_professor_guide_schema`         | `0025_prosecution_case_memories`           |
   | 1788400000000  | `0026_prosecution_disclosure_deepening`    | `0026_prosecution_case_graph`              |
   | 1788500000000  | `0027_prosecution_legal_workflow`          | `0027_professional_contacts_folders`       |
   | 1788600000000  | `0028_prosecution_office_operations`       | `0028_firm_time_billing_rates`             |

   Drizzle applies only when `last.created_at < journal.when` and **never rechecks hash**. If staging DB journal already has `created_at ≥ 1788600000000` from Deepening, migrate with main SQL would **skip** main 0025–0028 and attempt only 0029–0032 against an unverified schema shape.
3. **Disposable matrix ≠ staging.** `pr09-matrix.mjs` A–G PASS proves Docker repair paths only.
4. **`migrate.ts` gap.** Runbook requires `EXPECTED_MIGRATE_DB_NAME`; `packages/database/src/migrate.ts` does **not** enforce it (only localhost / sslmode guards).
5. **Deploy lag.** Staging still runs `add3af3` (WP-05). No deploy authorized this mission.

## Priority 4 — Backup / recovery path

| Path                         | Status            | Operator action (no secrets) |
| ---------------------------- | ----------------- | ---------------------------- |
| Local disposable dump/restore | Engineering only | Not staging proof            |
| Neon managed PITR            | **NOT CERTIFIED** | See below                    |
| Fly Postgres PITR            | N/A               | No Fly PG clusters           |

**Exact operator actions (Neon Console — product project only after identity attestation):**

1. Open the Neon project that owns **product** staging (confirm it is **not** the legal corpus project used for research ingest).
2. Settings → Postgres → confirm **History window ≥ 24h** (Free plan caps at 6h — upgrade or extend if needed before migrate).
3. Before migrate: Branches → create an **isolated** restore/child branch (or snapshot) labeled `pre-0032-<UTC>` — do not overwrite primary.
4. Optional: approved private `pg_dump --format=custom` of product DB only; store outside chat; never paste URLs.
5. After failed migrate: restore to isolated branch / Instant Restore on **root** branch only per Neon docs; re-point app only after identity checks.
6. Record evidence into OPS-BACKUP-01 (`MANAGED_PITR_VERIFIED`).

**If Neon Console / project ownership credentials are unavailable:** stop. Required action = grant operator Neon project Admin (or read+branch) on the **attested product** project; engineering cannot certify PITR without that access.

## Priority 5 — GO / NO-GO

### `STAGING_MIGRATION_PREFLIGHT_BLOCKED`

**Blockers (exact):**

1. `NEON_OR_CORPUS_DATABASE_REFUSED` — staging `DATABASE_URL` is Neon + `neondb`; no `CORPUS_DATABASE_URL` dual-binding proof; live schema/journal inventory not executed.
2. `MIGRATION_WHEN_LINEAGE_COLLISION` — Deepening 0025–0028 vs main 0025–0028 share `when` values; unsafe to apply Integration/main migrate to staging without live journal+schema inventory and a written forward-repair plan.
3. `EXPECTED_MIGRATE_DB_NAME_UNENFORCED` — migrate entrypoint lacks the runbook name gate.
4. `MANAGED_PITR_NOT_CERTIFIED` — Neon history window / isolated restore branch not verified this session.
5. `OPERATOR_APPROVAL_CHECKLIST_OPEN` — `docs/operations/WP06_STAGING_MIGRATION_RUNBOOK.md` §0 unchecked.
6. `STAGING_DEPLOY_LAG` — live `gitSha=add3af3` predates PR #6–#9; migrate+app contract not co-deployed.

**Remaining approvals before any GO:**

- [ ] Operator attests product DB identity (project, branch, database name ≠ corpus) and sets `EXPECTED_MIGRATE_DB_NAME`
- [ ] Operator completes Neon PITR / isolated pre-migrate branch drill
- [ ] Engineering + operator agree forward path for Deepening↔main `when` collision after read-only inventory on **attested product** DB
- [ ] Enforce `EXPECTED_MIGRATE_DB_NAME` in migrate (or equivalent gate) before shared staging migrate
- [ ] Explicit written approval on WP06 migration runbook §0
- [ ] Coordinated deploy of main/Integration tip **with** migrate — not assumed by disposable matrix

## Monitoring (WP-05 schedule criterion)

| Run                                                                                 | Event      | Conclusion | Notes                                         |
| ----------------------------------------------------------------------------------- | ---------- | ---------- | --------------------------------------------- |
| [42119654855](https://github.com/patelvivek9111/nyayagrid/actions/runs/42119654855) | `schedule` | SUCCESS    | Probe HEALTHY; notify smtp                    |
| [42150903565](https://github.com/patelvivek9111/nyayagrid/actions/runs/42150903565) | `schedule` | SUCCESS    | Timeout → alerts smtp:accepted                |

## Gate matrix (summary)

| Gate                     | Status   | Remaining action                                      |
| ------------------------ | -------- | ----------------------------------------------------- |
| Product schema migration | BLOCKED  | Resolve identity + lineage + PITR + operator approval |
| Clerk authenticated E2E  | BLOCKED  | Operator identities (deferred)                        |
| Backup/PITR              | BLOCKED  | Neon history window + isolated restore drill          |
| Production deployment    | BLOCKED  | Staging RC first                                      |

## Safety observed this session

- No shared staging migrate
- No deploy
- No Integration → main merge
- No Neon SQL after corpus-shaped fingerprint refused
- Disposable matrix not treated as staging proof
