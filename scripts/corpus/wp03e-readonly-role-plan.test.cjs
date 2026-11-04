/**
 * Static tests for the WP-03E SELECT-only Neon provisioning plan (recovery).
 * Does not connect to Neon and does not execute privilege SQL.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const paths = {
  doc: path.join(root, "docs/security/NEON_CORPUS_READONLY_ROLE_PROVISIONING.md"),
  deprecated: path.join(root, "scripts/corpus/neon-corpus-readonly-role.sql"),
  stepA: path.join(root, "scripts/corpus/neon-corpus-readonly-role-step-a-create-role.sql"),
  stepB: path.join(root, "scripts/corpus/neon-corpus-readonly-role-step-b-grants.sql"),
  verify: path.join(root, "scripts/corpus/neon-corpus-readonly-role-verify.sql"),
};

for (const [name, p] of Object.entries(paths)) {
  assert.ok(fs.existsSync(p), `missing ${name}: ${p}`);
}

const doc = fs.readFileSync(paths.doc, "utf8");
const deprecated = fs.readFileSync(paths.deprecated, "utf8");
const stepA = fs.readFileSync(paths.stepA, "utf8");
const stepB = fs.readFileSync(paths.stepB, "utf8");
const verify = fs.readFileSync(paths.verify, "utf8");

function hasExecutablePasswordClause(sqlText) {
  // Strip line comments, then look for CREATE ROLE ... PASSWORD '...'
  const withoutLineComments = sqlText
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return /CREATE\s+ROLE[\s\S]{0,400}PASSWORD\s+'/i.test(withoutLineComments);
}

// Deprecated combined script must refuse execution and must not contain executable passwords.
assert.match(deprecated, /DEPRECATED/i);
assert.match(deprecated, /RAISE EXCEPTION/i);
assert.equal(hasExecutablePasswordClause(deprecated), false);
assert.doesNotMatch(deprecated, /SET_VIA_SECRET_MANAGER/);

// Step A: no embedded password; fail-closed if role missing.
assert.match(stepA, /STEP_A_INCOMPLETE|Neon Console/i);
assert.equal(hasExecutablePasswordClause(stepA), false);
assert.doesNotMatch(stepA, /SET_VIA_SECRET_MANAGER/);
assert.match(stepA, /Never CREATE ROLE \.\.\. PASSWORD with a placeholder/i);

// Step B: SELECT-only approved tables; no relationships (optional omitted); no password.
assert.match(stepB, /GRANT SELECT ON TABLE/);
assert.match(stepB, /legal_authorities/);
assert.match(stepB, /legal_authority_chunks/);
assert.match(stepB, /legal_authority_versions/);
assert.match(stepB, /legal_authority_citations/);
assert.match(stepB, /intentionally OMITTED/);
{
  const stepBActive = stepB
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  assert.doesNotMatch(stepBActive, /legal_authority_relationships/);
  assert.doesNotMatch(stepBActive, /GRANT SELECT ON ALL TABLES/i);
  assert.match(stepBActive, /GRANT SELECT ON TABLE/);
}
assert.doesNotMatch(stepB, /GRANT ALL\b/i);
assert.equal(hasExecutablePasswordClause(stepB), false);
assert.match(stepB, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE/);
assert.match(stepB, /NOINHERIT/);
assert.match(stepB, /CONNECTION LIMIT 10/);
assert.match(stepB, /GRANT CONNECT ON DATABASE neondb/);
assert.match(stepB, /REVOKE CREATE ON SCHEMA public/);
assert.match(stepB, /must not be a member of write\/admin roles/i);

// Verify: privilege functions; no mutation probes.
assert.match(verify, /has_table_privilege/);
assert.match(verify, /has_database_privilege/);
assert.match(verify, /has_schema_privilege/);
assert.match(verify, /Does NOT attempt INSERT\/UPDATE\/DELETE/i);
assert.doesNotMatch(verify, /^\s*INSERT INTO/im);
assert.doesNotMatch(verify, /^\s*UPDATE\b/im);
assert.doesNotMatch(verify, /^\s*DELETE FROM/im);
assert.doesNotMatch(verify, /^\s*TRUNCATE\b/im);

// Doc: two-step + checklist + SSL + gate outcome.
assert.match(doc, /SECURITY_PLAN_READY_FOR_HUMAN_APPROVAL/);
assert.match(doc, /Two-step provisioning/i);
assert.match(doc, /Manual approval checklist/i);
assert.match(doc, /sslmode=require/);
assert.match(doc, /has_table_privilege/);
assert.match(doc, /legal_authority_relationships/);
assert.match(doc, /Do \*\*not\*\* execute Step A\/B privilege SQL/i);
assert.match(doc, /CORPUS_DATABASE_URL/);
assert.match(doc, /NOINHERIT/);

console.log(
  JSON.stringify({
    ok: true,
    tests: 1,
    assertions: "readonly_role_plan_static_recovery",
    artifacts: Object.keys(paths),
  }),
);
