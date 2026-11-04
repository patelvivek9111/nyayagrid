-- =============================================================================
-- DEPRECATED COMBINED SCRIPT — DO NOT EXECUTE
-- =============================================================================
-- WP-03E recovery replaced the prior single script (which could create a login
-- with a known placeholder secret) with a two-step process:
--
--   A. scripts/corpus/neon-corpus-readonly-role-step-a-create-role.sql
--      (Neon Console preferred; secrets never stored in git)
--   B. scripts/corpus/neon-corpus-readonly-role-step-b-grants.sql
--      (SELECT-only grants; no secrets in file)
--   V. scripts/corpus/neon-corpus-readonly-role-verify.sql
--      (non-destructive has_*_privilege verification as the restricted login)
--
-- Companion: docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'DEPRECATED: Do not execute neon-corpus-readonly-role.sql. Use Step A (Neon Console / step-a) then Step B grants, then verify.sql. See docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md';
END $$;
