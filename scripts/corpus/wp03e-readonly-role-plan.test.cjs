/**
 * Static tests for the WP-03E SELECT-only Neon provisioning plan.
 * Does not connect to Neon and does not execute privilege SQL.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const sqlPath = path.join(root, "scripts/corpus/neon-corpus-readonly-role.sql");
const docPath = path.join(root, "docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md");

assert.ok(fs.existsSync(sqlPath), "provisioning SQL must exist");
assert.ok(fs.existsSync(docPath), "provisioning doc must exist");

const sql = fs.readFileSync(sqlPath, "utf8");
const doc = fs.readFileSync(docPath, "utf8");

assert.match(sql, /DO NOT EXECUTE/i);
assert.match(sql, /nyayagrid_corpus_readonly/);
assert.match(sql, /NOSUPERUSER/);
assert.match(sql, /NOCREATEDB/);
assert.match(sql, /NOCREATEROLE/);
assert.match(sql, /NOBYPASSRLS/);
assert.match(sql, /NOINHERIT/);
assert.match(sql, /CONNECTION LIMIT 10/);
assert.match(sql, /GRANT CONNECT ON DATABASE neondb/);
assert.match(sql, /GRANT USAGE ON SCHEMA public/);
assert.match(sql, /REVOKE CREATE ON SCHEMA public/);
assert.match(sql, /GRANT SELECT ON TABLE/);

for (const table of [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
  "legal_authority_relationships",
]) {
  assert.match(sql, new RegExp(table));
}

assert.doesNotMatch(sql, /GRANT SELECT ON ALL TABLES/i);
assert.doesNotMatch(sql, /GRANT ALL\b/i);
assert.doesNotMatch(sql, /GRANT INSERT/i);
assert.doesNotMatch(sql, /GRANT UPDATE/i);
assert.doesNotMatch(sql, /GRANT DELETE/i);
assert.doesNotMatch(sql, /WITH GRANT OPTION/i);
assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE/);

assert.match(doc, /ROLE_DESIGNED/);
assert.match(doc, /least-privilege/i);
assert.match(doc, /CORPUS_DATABASE_URL/);
assert.match(doc, /search_vector/);
assert.match(doc, /to_tsvector/);
assert.match(doc, /legal_authority_chunks_fts_idx/);
assert.match(doc, /Do \*\*not\*\* execute privilege-changing SQL/i);
assert.match(doc, /WP03E_CREDENTIAL_PROVISIONING_REQUIRED/);
assert.match(doc, /rotation/i);

console.log(
  JSON.stringify({
    ok: true,
    tests: 1,
    assertions: "readonly_role_plan_static",
    sqlPath: "scripts/corpus/neon-corpus-readonly-role.sql",
    docPath: "docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md",
  }),
);
