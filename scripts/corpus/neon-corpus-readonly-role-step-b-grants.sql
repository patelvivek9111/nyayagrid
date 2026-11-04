-- =============================================================================
-- NyayaGrid WP-03E — STEP B: SELECT-only grants (MANUAL / HUMAN ONLY)
-- =============================================================================
-- DO NOT EXECUTE from CI or agent sessions without explicit human approval.
-- Prerequisite: role nyayagrid_corpus_readonly exists with LOGIN + password set
--               out of band (Neon Console / secret manager). No passwords here.
-- Target: Neon project nyayagrid-staging (odd-moon-90379900), branch production,
--         database neondb (connect to neondb before running).
-- Companion: docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md
-- =============================================================================

-- Fail closed if Step A was skipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'nyayagrid_corpus_readonly' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'STEP_B_BLOCKED: nyayagrid_corpus_readonly must exist with LOGIN before grants. Complete Step A via Neon Console.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
    WHERE r.rolname = 'nyayagrid_corpus_readonly'
      AND g.rolname IN ('neondb_owner', 'cloud_admin', 'neon_superuser')
  ) THEN
    RAISE EXCEPTION
      'STEP_B_BLOCKED: nyayagrid_corpus_readonly must not be a member of write/admin roles.';
  END IF;
END $$;

-- Defense in depth only (NOT a substitute for SELECT-only table grants).
ALTER ROLE nyayagrid_corpus_readonly SET default_transaction_read_only = on;
ALTER ROLE nyayagrid_corpus_readonly SET statement_timeout = '30s';
ALTER ROLE nyayagrid_corpus_readonly SET application_name = 'nyayagrid-corpus-ro';
ALTER ROLE nyayagrid_corpus_readonly CONNECTION LIMIT 10;
ALTER ROLE nyayagrid_corpus_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;

-- Database CONNECT (neondb only). Run while connected to neondb.
GRANT CONNECT ON DATABASE neondb TO nyayagrid_corpus_readonly;

-- Schema USAGE only — no CREATE on public for this role.
GRANT USAGE ON SCHEMA public TO nyayagrid_corpus_readonly;
REVOKE CREATE ON SCHEMA public FROM nyayagrid_corpus_readonly;

-- SELECT only on approved corpus tables required by GuardedAuthorityRetriever /
-- AuthorityHybridRetriever. No ALL TABLES. No product/matter tables.
-- legal_authority_relationships intentionally OMITTED (not required by current
-- search path; add later only with explicit review).
GRANT SELECT ON TABLE
  public.legal_authorities,
  public.legal_authority_chunks,
  public.legal_authority_versions,
  public.legal_authority_citations
TO nyayagrid_corpus_readonly;

-- Ensure write privileges are absent on the approved tables (idempotent).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.legal_authorities,
  public.legal_authority_chunks,
  public.legal_authority_versions,
  public.legal_authority_citations
FROM nyayagrid_corpus_readonly;

-- Explicit non-grants (do not uncomment without a new security review):
-- GRANT SELECT ON TABLE public.legal_authority_relationships TO ...;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO ...;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ...;

-- =============================================================================
-- After Step B: store connection string ONLY in staging secret manager as
-- CORPUS_DATABASE_URL (sslmode=require). Never as product DATABASE_URL.
-- Then run: scripts/corpus/neon-corpus-readonly-role-verify.sql
-- as the restricted role login (separate authentication).
-- =============================================================================
