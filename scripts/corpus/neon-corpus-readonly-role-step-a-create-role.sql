-- =============================================================================
-- NyayaGrid WP-03E — STEP A: create restricted login role (MANUAL / HUMAN ONLY)
-- =============================================================================
-- DO NOT EXECUTE from CI or agent sessions.
-- DO NOT paste a real password into this file, git, tickets, logs, or chat.
--
-- Neon-preferred path (recommended):
--   Neon Console → Project nyayagrid-staging (odd-moon-90379900)
--   → Branch production → Roles → New role
--   Name: nyayagrid_corpus_readonly
--   Generate a strong password in the secret manager / Neon UI only.
--   Do not grant this role membership in neondb_owner or other write roles.
--
-- This SQL is a fallback template for operators who must use SQL instead of the
-- Console. It is INTENTIONALLY incomplete: it will not create a usable login
-- until the operator sets the password OUT OF BAND.
--
-- Companion: docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md
-- Next: scripts/corpus/neon-corpus-readonly-role-step-b-grants.sql
-- =============================================================================

-- Guard: refuse accidental execution that would create a role with a known
-- placeholder password. Operators must create the role via Neon Console OR
-- uncomment and run the NOLOGIN bootstrap below, then set password out of band.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nyayagrid_corpus_readonly') THEN
    RAISE NOTICE 'Role nyayagrid_corpus_readonly already exists — skip Step A; proceed to Step B grants + verification.';
  ELSE
    RAISE EXCEPTION
      'STEP_A_INCOMPLETE: Create role nyayagrid_corpus_readonly via Neon Console (preferred) or uncomment the NOLOGIN bootstrap block in neon-corpus-readonly-role-step-a-create-role.sql. Never CREATE ROLE ... PASSWORD with a placeholder.';
  END IF;
END $$;

-- Optional SQL bootstrap (NOLOGIN, no password). Uncomment ONLY after human approval.
-- After this succeeds, set LOGIN + password exclusively via Neon Console / secret
-- manager (never by editing PASSWORD into this repository file).
--
-- CREATE ROLE nyayagrid_corpus_readonly
--   NOLOGIN
--   NOSUPERUSER
--   NOCREATEDB
--   NOCREATEROLE
--   NOINHERIT
--   NOBYPASSRLS
--   NOREPLICATION
--   CONNECTION LIMIT 10;
--
-- Then in Neon Console: enable login + set password for nyayagrid_corpus_readonly.
-- Then run Step B grants.
