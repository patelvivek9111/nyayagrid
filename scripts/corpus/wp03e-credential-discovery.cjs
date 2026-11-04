/**
 * WP-03E credential discovery — presence only. Never prints URL/password/tokens.
 * Exit 0 always. Emits JSON suitable for the certification report.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function processPresent(key) {
  const v = process.env[key];
  return Boolean(v && String(v).trim());
}

function fileKey(rel, key) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) return "FILE_ABSENT";
  const t = fs.readFileSync(p, "utf8");
  const m = t.match(new RegExp("^\\s*" + key + "\\s*=(.*)$", "mi"));
  if (!m) return "KEY_ABSENT";
  let raw = String(m[1] || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  if (!raw || raw.startsWith("#")) return "EMPTY";
  return "SET";
}

async function probeRoles() {
  const r = spawnSync(
    "npx",
    ["neonctl", "connection-string", "production", "--project-id", "odd-moon-90379900"],
    { encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    return {
      probe: "FAILED",
      restrictedRoleExists: false,
      loginRoleNames: [],
      note: "Could not open neonctl metadata connection",
    };
  }
  const postgres = require("postgres");
  const url = (r.stdout || "").trim();
  const sql = postgres(url, {
    max: 1,
    ssl: "require",
    connect_timeout: 20,
    connection: {
      application_name: "wp03e-cred-discovery-meta",
      options: "-c default_transaction_read_only=on -c statement_timeout=30000",
    },
  });
  try {
    return await sql.begin("READ ONLY", async (tx) => {
      const [who] = await tx`
        SELECT current_user AS usr, current_database() AS db`;
      const roles = await tx`
        SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
        FROM pg_roles
        WHERE rolcanlogin
           OR rolname ILIKE '%corpus%'
           OR rolname ILIKE '%readonly%'
           OR rolname ILIKE '%read_only%'
        ORDER BY 1`;
      const candidates = roles.filter(
        (row) =>
          /corpus|readonly|read_only|research_ro/i.test(String(row.rolname)) &&
          row.rolsuper === false &&
          row.rolcreatedb === false &&
          row.rolcreaterole === false &&
          row.rolbypassrls === false,
      );
      return {
        probe: "OK",
        database_identity: {
          database: who.db,
          probeUser: who.usr,
          note: "probe_user_is_not_app_credential",
        },
        loginRoleNames: roles.map((row) => row.rolname),
        restrictedRoleExists: candidates.length > 0,
        restrictedCandidateNames: candidates.map((row) => row.rolname),
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

(async () => {
  const files = [".env", ".env.local", ".env.staging", ".env.staging.local", "apps/web/.env.local"];
  const fileScan = {};
  let corpusInAnyFile = false;
  for (const f of files) {
    const status = fileKey(f, "CORPUS_DATABASE_URL");
    fileScan[f] = {
      CORPUS_DATABASE_URL: status,
      FEATURE_NEON_CORPUS_RESEARCH: fileKey(f, "FEATURE_NEON_CORPUS_RESEARCH"),
    };
    if (status === "SET") corpusInAnyFile = true;
  }

  const credential_present = processPresent("CORPUS_DATABASE_URL") || corpusInAnyFile;
  let roleProbe = { probe: "SKIPPED", restrictedRoleExists: false };
  try {
    roleProbe = await probeRoles();
  } catch (err) {
    roleProbe = {
      probe: "FAILED",
      restrictedRoleExists: false,
      errorClass: String(err && err.message ? err.message : err).slice(0, 120),
    };
  }

  const result = {
    classification: "NYAYAGRID_WP03E_NEON_STAGING_RESEARCH_CERTIFICATION",
    generatedAt: new Date().toISOString(),
    mutations: 0,
    neonWrites: 0,
    courtListenerHttpCalls: 0,
    paidAiCalls: 0,
    credential_present,
    credential_scope: credential_present ? "UNKNOWN_UNTIL_ROLE_VERIFIED" : "ABSENT",
    database_identity: roleProbe.database_identity ?? null,
    role_name: roleProbe.restrictedCandidateNames?.[0] ?? null,
    SELECT_only_verified: false,
    write_privileges_absent: false,
    connection_available: false,
    neonctl_owner_not_treated_as_app_credential: true,
    session_read_only_not_least_privilege: true,
    roleProbe: {
      probe: roleProbe.probe,
      restrictedRoleExists: roleProbe.restrictedRoleExists,
      loginRoleNames: roleProbe.loginRoleNames ?? [],
      restrictedCandidateNames: roleProbe.restrictedCandidateNames ?? [],
    },
    processEnv: {
      CORPUS_DATABASE_URL: processPresent("CORPUS_DATABASE_URL"),
      DATABASE_URL: processPresent("DATABASE_URL"),
      FEATURE_NEON_CORPUS_RESEARCH: processPresent("FEATURE_NEON_CORPUS_RESEARCH"),
    },
    fileScan,
    finalResult: credential_present
      ? "CREDENTIAL_PRESENT_REQUIRES_SELECT_ONLY_PROOF"
      : "WP03E_CREDENTIAL_PROVISIONING_REQUIRED",
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.log(
    JSON.stringify(
      {
        classification: "NYAYAGRID_WP03E_NEON_STAGING_RESEARCH_CERTIFICATION",
        credential_present: false,
        finalResult: "WP03E_CREDENTIAL_PROVISIONING_REQUIRED",
        errorClass: String(err && err.message ? err.message : err).slice(0, 200),
      },
      null,
      2,
    ),
  );
});
