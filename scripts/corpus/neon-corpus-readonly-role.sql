-- =============================================================================
-- NyayaGrid WP-03E — Neon corpus SELECT-only role (REVIEW / MANUAL ONLY)
-- =============================================================================
-- DO NOT EXECUTE from CI or agent sessions without explicit human approval.
-- Target: Neon project nyayagrid-staging (odd-moon-90379900), branch production,
--         database neondb.
-- Companion: docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md
-- =============================================================================

BEGIN;

-- 1) Login role — least privilege attributes
-- Replace <SET_VIA_SECRET_MANAGER> before running; never commit a real password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nyayagrid_corpus_readonly') THEN
    CREATE ROLE nyayagrid_corpus_readonly
      LOGIN
      PASSWORD '<SET_VIA_SECRET_MANAGER>'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
      NOREPLICATION
      CONNECTION LIMIT 10;
  ELSE
    RAISE NOTICE 'Role nyayagrid_corpus_readonly already exists — verify grants instead of recreating';
  END IF;
END $$;

-- Defense in depth (does not replace table SELECT-only grants)
ALTER ROLE nyayagrid_corpus_readonly SET default_transaction_read_only = on;
ALTER ROLE nyayagrid_corpus_readonly SET statement_timeout = '30s';
ALTER ROLE nyayagrid_corpus_readonly SET application_name = 'nyayagrid-corpus-ro';

-- 2) Database CONNECT only (neondb). Adjust database name if different.
GRANT CONNECT ON DATABASE neondb TO nyayagrid_corpus_readonly;

-- 3) Schema USAGE only — no CREATE
GRANT USAGE ON SCHEMA public TO nyayagrid_corpus_readonly;
REVOKE CREATE ON SCHEMA public FROM nyayagrid_corpus_readonly;

-- 4) SELECT only on required corpus tables (no ALL TABLES blanket grant)
GRANT SELECT ON TABLE
  public.legal_authorities,
  public.legal_authority_chunks,
  public.legal_authority_versions,
  public.legal_authority_citations,
  public.legal_authority_relationships
TO nyayagrid_corpus_readonly;

-- Explicitly ensure write privileges are absent (idempotent safety)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.legal_authorities,
  public.legal_authority_chunks,
  public.legal_authority_versions,
  public.legal_authority_citations,
  public.legal_authority_relationships
FROM nyayagrid_corpus_readonly;

-- 5) Do NOT grant default privileges that would inherit future write tables:
--    intentionally omitted: ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES
--    Prefer re-running an explicit GRANT SELECT list when new corpus tables are added.

COMMIT;

-- =============================================================================
-- Post-provision verification (run as the new role; expect SELECT ok / DML fail)
-- =============================================================================
-- SET ROLE nyayagrid_corpus_readonly;
-- SELECT current_user, current_database();
-- SELECT COUNT(*) FROM public.legal_authorities LIMIT 1;
-- SELECT COUNT(*) FROM public.legal_authority_chunks LIMIT 1;
-- -- Expect ERROR:
-- -- INSERT INTO public.legal_authorities DEFAULT VALUES;
-- -- UPDATE public.legal_authorities SET title = title WHERE false;
-- -- DELETE FROM public.legal_authorities WHERE false;
--
-- Attribute checks (as admin):
-- SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit, rolinherit
-- FROM pg_roles WHERE rolname = 'nyayagrid_corpus_readonly';
-- SELECT r.rolname AS member, g.rolname AS grants_via
-- FROM pg_auth_members m
-- JOIN pg_roles r ON r.oid = m.member
-- JOIN pg_roles g ON g.oid = m.roleid
-- WHERE r.rolname = 'nyayagrid_corpus_readonly';
-- =============================================================================
