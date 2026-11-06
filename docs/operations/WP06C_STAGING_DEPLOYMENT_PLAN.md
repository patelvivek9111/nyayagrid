# WP-06C — Staging deployment / migrate plan

**Classification:** `NYAYAGRID_WP06C_STAGING_DATABASE_RECONCILIATION`  
**Target:** Neon `odd-moon-90379900` / branch `br-fancy-king-auaii21k` / db `neondb`  
**Backup:** `br-soft-star-au0por2i` (`wp06-pre-migration-backup`)  
**Code:** `nyaya/integration-checkpoint` tip including migration **0034**

## Checklist (order)

1. **Target identity** — env gates match project/branch/endpoint/db; role not corpus.
2. **Backup verification** — confirm `wp06-pre-migration-backup` exists and is unexpired; accept recovery procedure.
3. **Read-only preflight** — `staging-product-db-preflight.mjs` with attested env; journal still 19 / max `1788200000000`.
4. **Migration sequence** — `npm run db:migrate` applies **0034 → 0025…0033** (not 0033 alone).
5. **Schema contract** — contacts/folders/memories/graph `node_kind`/billing columns/isolation FKs.
6. **App deploy** — deploy Integration tip compatible with post-0033 schema (same release train as migrate).
7. **Health** — `GET https://staging.nyayagrid.com/api/health/ready` → HEALTHY.
8. **Restore procedure** — on failure: freeze → use backup branch or PITR within history window → integrity → re-attest → forward only.
9. **Approval checkpoint** — runbook §0 signed; no production.

## Out of scope

Production deploy; corpus writes; Integration→main wholesale merge.
