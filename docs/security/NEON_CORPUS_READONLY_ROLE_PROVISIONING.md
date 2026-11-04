# Neon corpus SELECT-only role — provisioning plan (WP-03E)

**Classification:** `NYAYAGRID_WP03E_NEON_STAGING_RESEARCH_CERTIFICATION`  
**Status:** `ROLE_DESIGNED` — **not executed** in this session  
**Authoritative corpus:** Neon project `nyayagrid-staging` (`odd-moon-90379900`), branch `production`, database `neondb`

## Purpose

Provide a reviewed least-privilege login for application research via `CORPUS_DATABASE_URL`.  
Session `default_transaction_read_only=on` (`createReadOnlyDb`) is an extra guard only — it is **not** least privilege.

## Discovery (this session)

| Check                                      | Result                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Equivalent restricted login role           | **Absent** — login roles observed: `cloud_admin`, `neon_service`, `neondb_owner` only |
| `CORPUS_DATABASE_URL` in local/process env | **Absent**                                                                            |
| PUBLIC table grants on `legal_authority*`  | **None**                                                                              |
| RLS on corpus tables                       | **Disabled** on all five tables                                                       |
| Privileged neonctl owner                   | **Must not** be used as the app credential                                            |

Do **not** create a duplicate role if a future review finds an equivalent SELECT-only login; verify grants instead.

## Minimum objects required by application SQL

Derived from `AuthorityHybridRetriever`, `GuardedAuthorityRetriever.loadEligibilityForHits`, and citation-edge storage:

| Capability                       | Tables / objects                                                    | Notes                                                                    |
| -------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Authority lookup / metadata      | `public.legal_authorities`                                          | Filters: jurisdiction, citation, ingestion_status, metadata JSON         |
| Version currency                 | `public.legal_authority_versions`                                   | `valid_to IS NULL` / effective dates                                     |
| Full-text / keyword / hybrid FTS | `public.legal_authority_chunks`                                     | Query uses **computed** `to_tsvector('english', content)`                |
| Semantic / hybrid vector         | `public.legal_authority_chunks.embedding`                           | `vector` type; **no** HNSW/IVFFlat index today (seq scan)                |
| Citation identity lookup         | `public.legal_authorities` (+ optional `legal_authority_citations`) | Citation filter on authorities; edges in citations table                 |
| Citation graph traversal         | `public.legal_authority_citations`                                  | SELECT for resolved edges                                                |
| Relationship metadata (optional) | `public.legal_authority_relationships`                              | Not required by hybrid search path; grant SELECT for future graph tools  |
| Schema                           | `USAGE` on `public`                                                 | No `CREATE`                                                              |
| Extension types                  | `vector` extension already installed                                | Role needs ability to read `vector` columns (table SELECT is sufficient) |

### Keyword / `search_vector` finding

- Column `legal_authority_chunks.search_vector` population was previously measured at **0**.
- Live application FTS does **not** use `search_vector`; it uses `to_tsvector('english', c.content)` matching GIN index `legal_authority_chunks_fts_idx`.
- Therefore empty `search_vector` is **not** a keyword-search defect for the current retriever. Do not alter indexes in this work package.

### Schemas intentionally **not** granted

Product / matter / student / guide tables (`document_chunks`, `matters`, `users`, …), `drizzle` schema, and any write-capable roles.

## Role requirements

- Dedicated non-superuser login role (proposed name: `nyayagrid_corpus_readonly`).
- **No** `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`, `SUPERUSER`.
- `LOGIN` with password (or Neon role auth).
- `CONNECTION LIMIT` recommended: `10` (app pool max is 3; headroom for probes).
- Database: `CONNECT` on `neondb` only.
- Schema: `USAGE` on `public` only; **revoke** `CREATE` on `public` for this role.
- Tables: `SELECT` only on the five corpus tables listed above — **no** blanket `GRANT SELECT ON ALL TABLES`.
- **No** `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER` / ownership.
- **No** membership in `neondb_owner` or other write-capable roles.
- Do **not** automatically revoke PUBLIC or existing application privileges.

## Approval and provisioning procedure (human-operated)

1. **Approve** this document + `scripts/corpus/neon-corpus-readonly-role.sql` in change review.
2. Operator authenticates to Neon as an admin capable of `CREATE ROLE` (outside CI / agent session).
3. Run the SQL script **once** against branch `production` / database `neondb` (or Neon console equivalent).
4. Store the role password in the staging secret manager as `CORPUS_DATABASE_URL` only (never as product `DATABASE_URL`).
5. **Verify** (still as a separate check, before enabling product traffic):
   - `SELECT` succeeds on the five tables.
   - `INSERT`/`UPDATE`/`DELETE` fail.
   - Role attrs: `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolbypassrls=false`.
   - Role is **not** member of write roles (`pg_auth_members`).
6. Enable `FEATURE_NEON_CORPUS_RESEARCH=1` **only** in an isolated staging/test runtime.
7. Leave production feature flag **OFF** until a later explicit production certification WP.

## Credential rotation / revocation

1. `ALTER ROLE nyayagrid_corpus_readonly PASSWORD '…'` (or Neon rotate).
2. Update staging secret `CORPUS_DATABASE_URL`; recycle app instances.
3. Revocation: `REVOKE ALL ON … FROM nyayagrid_corpus_readonly;` then `DROP ROLE` after connections drain; or `NOLOGIN` for soft revoke.
4. Audit: record operator, timestamp, ticket ID; never log the password.

## Query timeouts / connection limits

- App already sets `statement_timeout` ≈ 30s and `application_name=nyayagrid-corpus-ro`.
- Optional DB-side: `ALTER ROLE … SET statement_timeout = '30s';` and `SET default_transaction_read_only = on` as defense in depth (still not a substitute for SELECT-only grants).

## Explicit non-actions for WP-03E agent session

- Do **not** execute privilege-changing SQL from automation.
- Do **not** use `neondb_owner` / neonctl connection string as `CORPUS_DATABASE_URL`.
- Do **not** enable the feature flag in production.
- Do **not** run schema migrations, embeddings, CourtListener, or paid AI.

## Post-provision acceptance gate

After a real restricted credential exists, resume live Phases 3–7 of WP-03E. Until then the package result is `WP03E_CREDENTIAL_PROVISIONING_REQUIRED`.
