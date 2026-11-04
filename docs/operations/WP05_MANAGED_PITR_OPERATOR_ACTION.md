# WP-05 — Managed PITR operator action

**Status:** STAGING `PASS_WITH_EVIDENCE` — production PITR/restore **NOT VERIFIED**.

## Verified staging evidence (do not re-invent)

| Item                          | Evidence                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Result                        | `packages/research/corpus/reports/wp05-pitr-verification.json` → `PASS_WITH_EVIDENCE` |
| Historical recovery timestamp | `2026-11-04T16:20:37Z`                                                                |
| Parent LSN                    | `0/A866C288`                                                                          |
| Recovery branch               | `wp05-pitr-rehearsal-20261104` / `br-odd-haze-au3z053l`                               |
| Parent corpus branch          | `production` / `br-delicate-cloud-au0md4t9`                                           |
| Branch created                | `2026-11-04T16:21:13Z` (checkpoint predates creation; Δ≈36s)                          |
| Four-table counts             | authorities 35863 / citations 80842 / chunks 129160 / versions 6993                   |
| Sample digests                | match for authorities + citations; orphans 0                                          |
| `neonCorpusWrites`            | 0                                                                                     |

Register: `OPS-BACKUP-01` → `STAGING_VERIFIED: true`, `PRODUCTION_VERIFIED: false`.

## If re-verification is required

1. Do **not** create billable Neon compute without explicit approval.
2. If a prior rehearsal branch expired, request approval for a new isolated PITR branch only.
3. Run:

```powershell
$env:PRODUCTION_DATABASE_URL="<corpus-branch-ro-url>"
$env:PITR_DATABASE_URL="<recovery-branch-ro-url>"
$env:PITR_HISTORICAL_TIMESTAMP="<iso-from-neon>"
$env:PITR_BRANCH_CREATED_AT="<iso-branch-created>"
$env:PITR_PARENT_LSN="<lsn-if-shown>"
$env:NEON_HISTORY_RETENTION_HOURS="6"
npm run ops:pitr-verify
```

## Acceptance

- `result` = `PASS_WITH_EVIDENCE`
- Recovery point before branch creation
- Four `legal_*` counts match; digests match where computed
- Production/corpus branch unmodified

## Production gap

Matched production Fly + production Neon restore remains **NOT VERIFIED** until a separately approved production environment exists.
