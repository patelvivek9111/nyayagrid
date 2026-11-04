# WP-05 — Product / Legal Corpus Database Isolation

**Status:** STAGING PHYSICAL SEPARATION COMPLETE (2026-11-04)  
**Neon project:** `nyayagrid-staging` (`odd-moon-90379900`)

## Current staging topology

| Role                           | Neon target                                                            | Notes                                                                            |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Product (Fly `DATABASE_URL`)   | Branch `wp05-product-staging` (`br-fancy-king-auaii21k`) / DB `neondb` | Endpoint `ep-lively-lake-auyeia5m`; runtime role `nyaya_product_runtime`         |
| Legal corpus (source of truth) | Branch `production` (`br-delicate-cloud-au0md4t9`) / DB `neondb`       | Endpoint `ep-jolly-brook-auhdpay3`; **unchanged**; counts verified after cutover |
| Empty placeholder DB           | `nyayagrid_product_staging` on production branch                       | Created during preflight; **not** used by Fly                                    |

`FEATURE_NEON_CORPUS_RESEARCH` remains **OFF**.

## How separation was achieved

1. Preflight found **6 product→corpus FKs** (`matter_authorities`, `research_notes`, `research_results` → `legal_*`).
2. Created product branch from production (COW; existing project; no new paid project).
3. On **product branch only**: dropped those FKs (soft-ref) then dropped corpus tables.
4. Verified product table counts match source; corpus counts on production branch unchanged.
5. Created `nyaya_product_runtime` with table DML on product branch public schema only.
6. Staged/deployed Fly `DATABASE_URL` to product branch runtime URL; preserved image `deployment-01M6KTCX6H5ZXPHGRV8SVFD0BF` / gitSha `add3af38…`.

Evidence: `packages/research/corpus/reports/wp05-product-branch-isolation.json`, `wp05-isolation-preflight.json`.

## Schema follow-up

Migration `0029_soft_ref_corpus_fks.sql` documents the soft-ref change for future product databases. It was **not** applied to the shared production-branch corpus database (source untouched). Product branch FKs were dropped directly as destination-only DDL.

## Rollback (staging)

Point Fly `DATABASE_URL` back to production-branch pooled URL for `neondb` / `neondb_owner` (or prior secret), then `fly secrets deploy` / same-image deploy.  
Do **not** drop the production-branch corpus. Do **not** merge product-branch DDL back onto corpus.

## Remaining production gates

- Clerk automated E2E credentials
- SMTP human acknowledgment
- Explicit production approval
- Optional: set `CORPUS_DATABASE_URL` to a SELECT-only role on production branch before enabling research flag
- Rotate `nyaya_product_runtime` password (neonctl create printed a one-time password into operator logs)
