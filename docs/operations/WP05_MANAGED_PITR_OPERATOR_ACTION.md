# WP-05 — Exact operator action for managed PITR certification

**Status:** OPEN — historical checkpoint metadata not independently verified in this session.

## Already verified (do not re-invent)

| Item                                       | Evidence                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Recovery branch name                       | `wp05-pitr-rehearsal-20261104`                                                 |
| Recovery branch id                         | `br-odd-haze-au3z053l`                                                         |
| Parent                                     | `production` / `br-delicate-cloud-au0md4t9`                                    |
| Created                                    | 2026-11-04T11:21:13 (operator report)                                          |
| Auto-delete                                | 2026-11-05T11:21:13                                                            |
| Prior count match                          | `legal_authorities` 35863 / `legal_authority_citations` 80842 on both branches |
| Staging live inventory (production branch) | `packages/research/corpus/reports/wp05-staging-db-inventory.json`              |

## Missing evidence (blocks full PITR certification)

1. Exact **historical recovery timestamp** or **parent LSN** chosen in Neon Console.
2. Read-only connection string for the recovery branch (`PITR_DATABASE_URL`).
3. Confirmation recovery point **\<** branch creation time.
4. Sample id-digest compare for chunks/versions tables against production branch.

## Single required operator action

1. Open Neon Console → project `nyayagrid-staging` (`odd-moon-90379900`).
2. Open branch `wp05-pitr-rehearsal-20261104` **before auto-delete**.
3. Copy the displayed PITR timestamp and/or parent LSN (do not guess).
4. Copy a read-only connection string for that branch.
5. On a trusted machine (deploy worktree):

```powershell
$env:PRODUCTION_DATABASE_URL="<production-branch-ro-url>"
$env:PITR_DATABASE_URL="<recovery-branch-ro-url>"
$env:PITR_HISTORICAL_TIMESTAMP="<iso-from-neon>"
$env:PITR_BRANCH_CREATED_AT="2026-11-04T11:21:13.000Z"
$env:PITR_PARENT_LSN="<lsn-if-shown>"
$env:NEON_HISTORY_RETENTION_HOURS="6"
npm run ops:pitr-verify
```

## Acceptance test

- Report `result` = `PASS_WITH_EVIDENCE`
- `checks.recoveryPointBeforeCreation` = `true`
- Corpus table counts match for all four `legal_*` tables
- Sample digests match where computed
- `neonCorpusWrites` remains `0`
- Production branch not modified

## If the recovery branch already expired

Do **not** silently create billable compute. Request explicit approval to create a new isolated PITR rehearsal branch, then repeat this action.
