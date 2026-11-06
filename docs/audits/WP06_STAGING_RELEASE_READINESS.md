# WP-06 — Staging release readiness

**Classification:** `NYAYAGRID_WP06_STAGING_RELEASE_READINESS`  
**Branch:** `nyaya/integration-checkpoint`  
**Integration HEAD (this report):** see git tip after WP-06 docs push  
**Main baseline:** `8d99bf3081ed0914554495907be8b409c663e6d2` (PR #9 merge)

## Merged PRs confirmed

| PR  | Merge commit | Topic                                    |
| --- | ------------ | ---------------------------------------- |
| #6  | `1549eb53…`  | Professional RBAC / legal_support harden |
| #7  | `71989c12…`  | Prosecution Memory / Graph / CoC         |
| #8  | `2453d874…`  | Contacts / Folders                       |
| #9  | `8d99bf30…`  | Billing + migrations through **0032**    |

## Staging database

| Check                                       | Result                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Direct SQL read-only inventory              | **UNAVAILABLE** this session (no authorized staging product DB URL in Integration workspace)                     |
| HTTP ready probe                            | **HEALTHY** `200` — database/storage/redis/clamav ok; `ocr=disabled`; `neonCorpusResearch=off`; `appEnv=staging` |
| Product vs corpus isolation (config signal) | Ready payload shows corpus research off; migrate runbook forbids corpus URL                                      |
| Disposable migrate A–G through 0032         | **ALL PASS** (`node scripts/migration-safety/pr09-matrix.mjs`)                                                   |
| Shared staging migrate executed             | **NO** — awaiting operator approval                                                                              |

## Monitoring (WP-05 schedule criterion)

| Run                                                                                 | Event      | Workflow                   | Conclusion | Notes                                                            |
| ----------------------------------------------------------------------------------- | ---------- | -------------------------- | ---------- | ---------------------------------------------------------------- |
| [42119654855](https://github.com/patelvivek9111/nyayagrid/actions/runs/42119654855) | `schedule` | Staging continuous monitor | SUCCESS    | Probe **HEALTHY**; notify smtp; coverage true                    |
| [42150903565](https://github.com/patelvivek9111/nyayagrid/actions/runs/42150903565) | `schedule` | Staging continuous monitor | SUCCESS    | Probe timeout → alerts **smtp:accepted** (failure/recovery path) |

**Two genuine `event=schedule` successes:** SATISFIED.  
**OPS-MON-01 overall:** remains PARTIAL (on-call ack / vendor paging not fully certified).

## Gate matrix

| Gate                     | Status            | Evidence                                              | Remaining action                                   | Owner          |
| ------------------------ | ----------------- | ----------------------------------------------------- | -------------------------------------------------- | -------------- |
| Product schema migration | PARTIAL           | Disposable A–G PASS; staging migrate not applied      | Operator-approved staging migrate via WP06 runbook | Operator + Eng |
| Professional workflows   | PARTIAL           | CI E2E + billing matrix; DevAuth ≠ Clerk              | Clerk staging E2E identities                       | Eng + Operator |
| Prosecution workflows    | PARTIAL           | Memory/Graph smokes + matrix F isolation              | Clerk prosecution E2E                              | Eng + Operator |
| Clerk authenticated E2E  | BLOCKED           | `DEFERRED_OPERATOR_ACTION`                            | Create 4 staging users + MFA                       | Operator       |
| Scheduled monitoring     | PARTIAL           | Two schedule SUCCESS; SMTP deliveries on unhealthy    | On-call ack rehearsal                              | Operator       |
| Legal research           | BLOCKED / PARTIAL | Local fixtures only; staging `neonCorpusResearch=off` | WP-03E corpus read role + grounding cert           | Eng + Operator |
| OCR/ClamAV               | PARTIAL           | Staging clamav live/ok; OCR disabled on ready         | Decide OCR policy; staging OCR cert                | Operator + Eng |
| Backup/PITR              | PARTIAL           | Local dump/restore docs; managed PITR uncertified     | Authorized restore branch drill                    | Operator       |
| Terms/Privacy            | PARTIAL           | Engineering complete; attorney sign-off pending       | Attorney review                                    | Legal          |
| Production deployment    | BLOCKED           | No prod deploy                                        | Staging RC first                                   | Operator       |

## Estimates (requirements inventory = 54; recount matches)

1. **Core implementation:** ~70% — PRs #6–#9 on main; remaining polish not release-unique.
2. **Product verification:** ~45% — disposable/CI strong; Clerk staging E2E missing.
3. **Staging certification:** ~35% — host HEALTHY; migrate 0028–0032 not applied/approved; research off.
4. **Production readiness:** ~15% — no prod deploy, no MFA prod, no PITR drill.

## Highest-priority next action

**Operator-approve and execute staging product DB migrate through 0032** using `docs/operations/WP06_STAGING_MIGRATION_RUNBOOK.md` after backup verification — then Clerk E2E identity provisioning.
