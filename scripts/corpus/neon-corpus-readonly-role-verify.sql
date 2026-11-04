-- =============================================================================
-- NyayaGrid WP-03E — non-destructive privilege verification (READ-ONLY)
-- =============================================================================
-- Run AFTER Step A + Step B, authenticated as nyayagrid_corpus_readonly
-- (separate restricted-role login). Do not use neondb_owner for "proof".
--
-- This script performs SELECT privilege probes only.
-- It does NOT attempt INSERT/UPDATE/DELETE/TRUNCATE against production tables.
-- Write denial is proven via has_table_privilege(..., 'INSERT'|'UPDATE'|...) = false.
--
-- Safe to run repeatedly. No DDL. No DCL. No data mutation.
-- =============================================================================

-- Identity
SELECT
  current_user AS login_role,
  session_user AS session_user,
  current_database() AS database,
  current_setting('transaction_read_only', true) AS txn_read_only,
  current_setting('statement_timeout', true) AS statement_timeout,
  inet_server_addr() IS NOT NULL AS has_server_addr;

-- Role attributes (self-visible subset may be limited; prefer admin mirror query below)
SELECT
  r.rolname,
  r.rolsuper,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolbypassrls,
  r.rolcanlogin,
  r.rolinherit,
  r.rolreplication,
  r.rolconnlimit
FROM pg_roles r
WHERE r.rolname = current_user;

-- No membership in write/admin roles
SELECT
  g.rolname AS granted_role
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname = current_user;

-- Database / schema privileges
SELECT
  has_database_privilege(current_user, current_database(), 'CONNECT') AS db_connect,
  has_database_privilege(current_user, current_database(), 'CREATE') AS db_create_should_be_false,
  has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create_should_be_false;

-- Approved corpus tables: SELECT true; writes false
SELECT
  t.relname AS table_name,
  has_table_privilege(current_user, format('public.%I', t.relname), 'SELECT') AS can_select,
  has_table_privilege(current_user, format('public.%I', t.relname), 'INSERT') AS can_insert,
  has_table_privilege(current_user, format('public.%I', t.relname), 'UPDATE') AS can_update,
  has_table_privilege(current_user, format('public.%I', t.relname), 'DELETE') AS can_delete,
  has_table_privilege(current_user, format('public.%I', t.relname), 'TRUNCATE') AS can_truncate,
  has_table_privilege(current_user, format('public.%I', t.relname), 'REFERENCES') AS can_references,
  has_table_privilege(current_user, format('public.%I', t.relname), 'TRIGGER') AS can_trigger
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relkind = 'r'
  AND t.relname IN (
    'legal_authorities',
    'legal_authority_chunks',
    'legal_authority_versions',
    'legal_authority_citations'
  )
ORDER BY 1;

-- Spot-check: product tables must NOT be SELECT-able by this role
SELECT
  t.relname AS product_table,
  has_table_privilege(current_user, format('public.%I', t.relname), 'SELECT') AS can_select_should_be_false
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relkind = 'r'
  AND t.relname IN (
    'matters',
    'organizations',
    'users',
    'memberships',
    'document_chunks',
    'criminal_cases',
    'audit_events'
  )
ORDER BY 1;

-- PUBLIC grants on corpus tables (informational; do not revoke PUBLIC automatically)
SELECT
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'PUBLIC'
  AND table_schema = 'public'
  AND table_name IN (
    'legal_authorities',
    'legal_authority_chunks',
    'legal_authority_versions',
    'legal_authority_citations',
    'legal_authority_relationships'
  )
ORDER BY 1, 2;

-- Bounded read smoke (metadata counts only; no content dump)
SELECT 'legal_authorities' AS src, COUNT(*)::bigint AS n FROM public.legal_authorities
UNION ALL
SELECT 'legal_authority_chunks', COUNT(*)::bigint FROM public.legal_authority_chunks
UNION ALL
SELECT 'legal_authority_versions', COUNT(*)::bigint FROM public.legal_authority_versions
UNION ALL
SELECT 'legal_authority_citations', COUNT(*)::bigint FROM public.legal_authority_citations;

-- Expected outcomes for certification:
--   db_connect=true, db_create_should_be_false=false
--   schema_usage=true, schema_create_should_be_false=false
--   approved tables: can_select=true; all write flags=false
--   product tables: can_select_should_be_false=false (or relation missing → skip)
--   rolsuper/createdb/createrole/bypassrls=false; rolcanlogin=true; no admin memberships
--   CORPUS_DATABASE_URL uses sslmode=require (checked outside SQL)
;
