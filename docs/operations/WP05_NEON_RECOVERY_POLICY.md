# WP-05 — Neon recovery policy & backup retention

**Status:** Documented. Staging managed PITR historically `PASS_WITH_EVIDENCE`.  
**Do not re-run** staging PITR unless a regression is suspected or retention evidence expired and a new rehearsal is explicitly approved.

## Retention (observed / interim)

| Scope                         | Retention                         | Notes                                                                 |
| ----------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Neon Free history (staging)   | ~6 hours (`21600` seconds)        | PITR older than retention is unavailable without plan upgrade         |
| Interim local dump policy     | 24h RPO / 4h RTO                  | `npm run ops:backup-rehearse` / `ops:backup-freshness`                |
| Target managed production RPO | ≤5 minutes                        | NOT CERTIFIED — no production Fly/Neon app                            |
| Target managed production RTO | ≤1 hour app failover              | NOT CERTIFIED                                                         |

## Recovery rules (non-negotiable)

1. **Never** restore over the Neon corpus/`production` branch used for legal authorities.
2. **Never** point product `DATABASE_URL` at the corpus branch.
3. Create isolated recovery branches for PITR; verify RO counts/digests before any cutover.
4. Product staging branch (`wp05-product-staging` / `br-fancy-king-auaii21k`) is the only staging product target.
5. Corpus branch remains immutable for product runtime writes (`neonCorpusWrites` must stay 0).
6. Production restore is **NOT VERIFIED** until a separately approved production environment exists.

## Historical staging evidence (preserve)

- `packages/research/corpus/reports/wp05-pitr-verification.json` → `PASS_WITH_EVIDENCE`
- Checkpoint `2026-11-04T16:20:37Z` / LSN `0/A866C288` / branch created `2026-11-04T16:21:13Z`
- Four-table counts: 35863 / 80842 / 129160 / 6993; orphans 0
- Operator procedure: `docs/operations/WP05_MANAGED_PITR_OPERATOR_ACTION.md`

## When to re-verify

Re-run only if:

- Neon plan/retention settings change, or
- Product schema / restore tooling changes in a way that invalidates prior evidence, or
- Explicit regression investigation is approved

Otherwise treat staging PITR as **HISTORICAL_VERIFIED**.
