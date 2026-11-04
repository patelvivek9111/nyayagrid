# Neon corpus SELECT-only role — provisioning plan (WP-03E recovery)

**Classification:** `NYAYAGRID_WP03E_CREDENTIAL_APPROVAL_AND_LIVE_CERTIFICATION`  
**Status:** `ROLE_DESIGNED` / `SECURITY_PLAN_READY_FOR_HUMAN_APPROVAL` — **not executed** by automation  
**Authoritative corpus:** Neon project `nyayagrid-staging` (`odd-moon-90379900`), branch `production`, database `neondb`

## Purpose

Provide a reviewed least-privilege login for application research via `CORPUS_DATABASE_URL`.  
Session `default_transaction_read_only=on` (`createReadOnlyDb`) is **defense in depth only** — it is **not** least privilege and must never be treated as security certification.

## Security preflight findings (corrected)

| Issue                       | Prior state                                                   | Correction                                                                                                                |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Password in SQL             | Combined script used `PASSWORD '<SET_VIA_SECRET_MANAGER>'`    | **Removed.** Passwords never live in git. Step A fails closed unless role exists; Neon Console sets password out of band. |
| Executable-with-placeholder | Combined script could create a login with a known placeholder | Combined script now **raises EXCEPTION** if run; Step A refuses insecure CREATE                                           |
| Optional grants             | Included `legal_authority_relationships`                      | **Omitted** from required grants (not needed by current retriever)                                                        |
| Mutation-based write proof  | Commented INSERT/UPDATE/DELETE probes                         | Replaced with `has_table_privilege` checks — **no production-table mutations**                                            |
| Neon compatibility          | Raw `CREATE ROLE … PASSWORD`                                  | Prefer **Neon Console** role create; SQL Step A is bootstrap/fail-closed only                                             |

## Two-step provisioning (required)

### Step A — Administrator creates the dedicated role (secure secret mechanism)

**Preferred:** Neon Console → project `nyayagrid-staging` → branch `production` → Roles → create `nyayagrid_corpus_readonly` with a generated password stored only in the staging secret manager.

**Fallback SQL:** `scripts/corpus/neon-corpus-readonly-role-step-a-create-role.sql`

- Does **not** embed a password.
- Raises if the role is missing (forces Console path) unless the optional NOLOGIN bootstrap is explicitly uncommented by a human.
- After NOLOGIN bootstrap, enable LOGIN + password **only** in Neon Console / secret manager.

### Step B — Administrator grants only approved SELECT permissions

Run `scripts/corpus/neon-corpus-readonly-role-step-b-grants.sql` connected to `neondb` as a Neon admin.

Grants:

- `CONNECT` on database `neondb`
- `USAGE` on schema `public` (and `REVOKE CREATE` on `public` for this role)
- `SELECT` only on:
  - `public.legal_authorities`
  - `public.legal_authority_chunks`
  - `public.legal_authority_versions`
  - `public.legal_authority_citations`

Hardens role attributes: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION`, `CONNECTION LIMIT 10`, session `statement_timeout=30s`, `default_transaction_read_only=on` (defense in depth).

Does **not**:

- Grant `ALL TABLES` / default privileges
- Grant product/matter/prosecution tables
- Grant `legal_authority_relationships` (optional; future review only)
- Place any password in SQL
- Revoke PUBLIC or other application roles automatically

### Verification — restricted-role login only

Run `scripts/corpus/neon-corpus-readonly-role-verify.sql` **as** `nyayagrid_corpus_readonly` (separate authentication).

Uses `has_database_privilege` / `has_schema_privilege` / `has_table_privilege` and role membership queries.  
Does **not** attempt INSERT/UPDATE/DELETE against live tables.

## Minimum objects required by application SQL

Derived from `AuthorityHybridRetriever`, `GuardedAuthorityRetriever.loadEligibilityForHits`, `createCorpusDb` / `createReadOnlyDb`:

| Capability                  | Tables / objects                                  | Notes                                                                             |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Authority lookup / metadata | `legal_authorities`                               | jurisdiction, citation, ingestion_status, metadata JSON                           |
| Version currency            | `legal_authority_versions`                        | `valid_to IS NULL` / effective dates                                              |
| Keyword / FTS / hybrid FTS  | `legal_authority_chunks`                          | computed `to_tsvector('english', content)` + GIN `legal_authority_chunks_fts_idx` |
| Semantic / hybrid vector    | `legal_authority_chunks.embedding`                | `vector`; no HNSW/IVFFlat today                                                   |
| Citation identity / graph   | `legal_authorities` + `legal_authority_citations` | edges for traversal                                                               |
| Schema                      | `USAGE` on `public`                               | no `CREATE`                                                                       |
| SSL/TLS                     | connection string                                 | require `sslmode=require` (or Neon equivalent) in `CORPUS_DATABASE_URL`           |

### Keyword / `search_vector`

Empty `search_vector` is **not** a defect for the current retriever (uses computed tsvector + existing GIN). Do not change indexes in this WP.

### Schemas / tables intentionally not granted

`document_chunks`, `matters`, `users`, `criminal_cases`, `audit_events`, `drizzle` schema, student/guide tables, and any write-capable roles.

## Role requirements (checklist summary)

- [ ] Dedicated non-superuser login: `nyayagrid_corpus_readonly`
- [ ] No `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`, `SUPERUSER`
- [ ] `NOINHERIT` (no inherited write grants via membership)
- [ ] Not a member of `neondb_owner` / `cloud_admin` / similar
- [ ] `CONNECTION LIMIT` ≤ 10
- [ ] `CONNECT` only on `neondb`
- [ ] `USAGE` on `public`; no `CREATE` on `public`
- [ ] `SELECT` only on the four approved corpus tables
- [ ] No INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on those tables
- [ ] Password never in git / CI logs / reports / chat
- [ ] `CORPUS_DATABASE_URL` uses SSL and is **not** product `DATABASE_URL`
- [ ] Session RO + statement timeout set (defense in depth only)

## Manual approval checklist (human)

1. [ ] Security review of Step A / Step B / verify SQL and this document.
2. [ ] Confirm no password or secret appears in any repository file.
3. [ ] Create role in Neon Console (project `odd-moon-90379900`, branch `production`).
4. [ ] Store password only in staging secret manager.
5. [ ] Run Step B grants as Neon admin against `neondb`.
6. [ ] Authenticate **as** `nyayagrid_corpus_readonly` and run verify.sql.
7. [ ] Confirm verify outcomes: SELECT true on four tables; all write privilege flags false; product table SELECT false; no admin memberships.
8. [ ] Set staging `CORPUS_DATABASE_URL` (sslmode=require) to this role only.
9. [ ] Keep product `DATABASE_URL` on the staging/test product database (not Neon corpus owner).
10. [ ] Enable `FEATURE_NEON_CORPUS_RESEARCH=1` **only** in isolated staging runtime.
11. [ ] Leave production feature flag **OFF**.
12. [ ] Re-run WP-03E live Phases 4–7 (retrieval + Professional/Prosecution E2E).

## Credential rotation / revocation

1. Rotate password in Neon Console / secret manager (never commit).
2. Update staging `CORPUS_DATABASE_URL`; recycle app instances.
3. Soft revoke: `ALTER ROLE … NOLOGIN`; hard revoke: revoke table/schema/db privileges then `DROP ROLE` after drain.
4. Audit: operator, timestamp, ticket ID — never log the secret.

## Application wiring (unchanged contract)

- Product DB: `DATABASE_URL` via `getDb()`
- Corpus DB: `CORPUS_DATABASE_URL` via `createCorpusDb` → `createReadOnlyDb`
- Gate: `FEATURE_NEON_CORPUS_RESEARCH` (default OFF)
- Retriever: `GuardedAuthorityRetriever` (eligibility + quote safety)

## Explicit non-actions for automation / this agent session

- Do **not** execute Step A/B privilege SQL.
- Do **not** create/modify Neon roles, grants, or passwords.
- Do **not** use `neondb_owner` / `cloud_admin` / neonctl owner string as `CORPUS_DATABASE_URL`.
- Do **not** enable the production feature flag.
- Do **not** run schema migrations, embeddings, CourtListener, or paid AI.
- Do **not** mutate corpus/product tables to “prove” write denial.

## Gate outcomes

| Condition                                                       | Result                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Plan reviewed; credential still absent                          | `WP03E_SECURITY_PLAN_READY_FOR_HUMAN_APPROVAL` / `ROLE_PROVISIONING_REQUIRED` |
| Restricted credential present + verify pass + live staging pass | `WP03E_STAGING_RESEARCH_CERTIFIED`                                            |
| Credential present but live staging incomplete                  | `WP03E_STAGING_RESEARCH_PARTIAL`                                              |
| Plan unsafe / blocked                                           | `WP03E_SECURITY_BLOCKED`                                                      |
