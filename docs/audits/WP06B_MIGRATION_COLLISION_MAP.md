# WP-06B — Deepening ↔ main migration collision map

**Classification:** `NYAYAGRID_WP06B_STAGING_DATABASE_RECONCILIATION`  
**Rule:** Do not edit historical `when` values or rewrite previously applied migration SQL.

## Timestamp collision (same `folderMillis`)

| `when`        | Deployed staging image (`add3af3`) Deepening tag                     | Main / Integration tag                                           | Collision                          | Required reconciliation                                                                                                                        |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1788300000000 | `0025_drop_professor_guide_schema` — DROP student/guide tables       | `0025_prosecution_case_memories` — CREATE memories               | **YES** — different SQL, same when | Forward-only: rely on **0029** idempotent CREATE memories; do not re-run Deepening drop; do not restore dropped professor tables automatically |
| 1788400000000 | `0026_prosecution_disclosure_deepening` — ALTER discovery/disclosure | `0026_prosecution_case_graph` — stub→reviewable graph + archives | **YES**                            | **0030/0031/0032** graph upgrade/repair; preserve Deepening columns                                                                            |
| 1788500000000 | `0027_prosecution_legal_workflow` — ALTER warrants/procedure/etc.    | `0027_professional_contacts_folders` — contacts/folders          | **YES**                            | **0029** CREATE contacts/folders IF NOT EXISTS; keep Deepening ALTERs                                                                          |
| 1788600000000 | `0028_prosecution_office_operations` — ALTER cases/tasks supervision | `0028_firm_time_billing_rates` — billing columns                 | **YES**                            | **0029** billing columns IF NOT EXISTS; keep Deepening ALTERs                                                                                  |
| 1788700000000 | _(absent on Deepening image)_                                        | `0029_repair_journaled_schema`                                   | No collision                       | Applies after Deepening ceiling                                                                                                                |
| 1788800000000 | —                                                                    | `0030_repair_prosecution_graph_0026`                             | No collision                       | Graph repair                                                                                                                                   |
| 1788900000000 | —                                                                    | `0031_migration_safety_assertions`                               | No collision                       | Fail-closed assertions + stub upgrade                                                                                                          |
| 1789000000000 | —                                                                    | `0032_prosecution_graph_integrity_contract`                      | No collision                       | Isolation FKs                                                                                                                                  |
| 1789100000000 | —                                                                    | `0033_deepening_main_reconciliation` (**new**)                   | No collision                       | Assert main contract present; allow Deepening markers; fail-closed on stub/unknown graph                                                       |

## Drizzle behavior (root cause)

Migrator applies journal entry iff `last.created_at < folderMillis`. It does **not** recheck SQL hashes. If Deepening hashes already occupy 1788300000000–1788600000000, main 0025–0028 SQL is skipped forever.

## Schema expectations

| Area                      | Main intended                          | Deepening historical                     | After 0029–0033                                                                                      |
| ------------------------- | -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Contacts/Folders          | tables + org FKs                       | absent                                   | present                                                                                              |
| Billing                   | billable/rates/totals                  | absent                                   | present                                                                                              |
| Prosecution Memory        | `prosecution_case_memories`            | absent                                   | present                                                                                              |
| Graph                     | reviewable `node_kind` + isolation FKs | unchanged stub from 0018 unless upgraded | reviewable + FKs                                                                                     |
| Disclosure deepening cols | absent                                 | `title` etc. on discovery                | **preserved**                                                                                        |
| Professor/Guide tables    | present (0007/0009)                    | dropped by Deepening 0025                | remain dropped if Deepening applied — out of WP-06B product migrate scope; separate product decision |

## Identifier confirmation

`0033` unused on `main`, `nyaya/integration-checkpoint`, `nyaya/full-completion-deepening-v2`, `nyaya/corpus-citation-strengthening-v2`.
