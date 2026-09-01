#!/usr/bin/env npx tsx
/**
 * Phase 6W staging operations proof.
 * Uses a disposable Postgres database (never the benchmark/live nyayagrid DB).
 * Never prints secret values.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  conversations,
  documents,
  drafts,
  graphEdges,
  graphNodes,
  legalAuthorities,
  matterMemories,
  matters,
  users,
} from "@nyayagrid/database";
import { createStorageProviderFromEnv } from "@nyayagrid/documents";
import { storageKeyForOrganization } from "@nyayagrid/permissions";
import {
  collectProductionConfigProblems,
  getFeatureFlags,
  isExplicitLocalDevAuthAllowed,
  resolveAppEnvDetailed,
  summarizeConfig,
} from "@nyayagrid/platform";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const STAGING_DB = "nyayagrid_staging_6w";
const RESTORE_DB = "nyayagrid_staging_6w_restore";
const STAGING_BUCKET = "nyayagrid-staging-6w";
const POSTGRES = process.env.POSTGRES_CONTAINER ?? "nyayagrid-postgres";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(repoRoot, "tmp", "6w-ops", stamp);
const baselinesDir = join(repoRoot, "benchmarks", "nyaya-bench", "baselines");

type Check = { name: string; status: "PASS" | "NEEDS_WORK" | "BLOCKED" | "CRITICAL"; detail: string };
const checks: Check[] = [];

function record(name: string, status: Check["status"], detail: string) {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name} — ${detail}`);
}

function applyDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envPresence(name: string): "SET" | "UNSET" {
  const value = process.env[name];
  return value && value.trim().length > 0 ? "SET" : "UNSET";
}

function redactDatabaseUrl(raw: string | undefined) {
  if (!raw) return { configured: false };
  try {
    const url = new URL(raw);
    return {
      configured: true,
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, ""),
      hasUser: Boolean(url.username),
      hasPassword: Boolean(url.password),
    };
  } catch {
    return { configured: true, parseError: true };
  }
}

function docker(args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8" });
}

function psql(database: string, sql: string) {
  return docker([
    "exec",
    POSTGRES,
    "psql",
    "-U",
    "nyayagrid",
    "-d",
    database,
    "-tA",
    "-c",
    sql,
  ]).trim();
}

function scanSecrets(): { hits: number; files: string[] } {
  const patterns = [
    /sk_live_[A-Za-z0-9]+/,
    /sk_test_[A-Za-z0-9]{20,}/,
    /whsec_[A-Za-z0-9]+/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/,
  ];
  const files: string[] = [];
  const roots = [
    join(repoRoot, "apps"),
    join(repoRoot, "packages"),
    join(repoRoot, "scripts"),
    join(repoRoot, "docs"),
    join(repoRoot, "benchmarks", "nyaya-bench", "baselines"),
  ];
  const skip = new Set(["node_modules", ".next", "dist", "tmp", "coverage"]);
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|md|json|yml|yaml|example|env)$/i.test(entry.name)) continue;
      if (entry.name === ".env") continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      if (entry.name.endsWith(".example")) continue;
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (patterns.some((re) => re.test(text))) files.push(full.replace(repoRoot + "\\", "").replace(repoRoot + "/", ""));
    }
  }
  for (const root of roots) walk(root);
  return { hits: files.length, files };
}

async function main() {
applyDotEnv(join(repoRoot, ".env"));
mkdirSync(outDir, { recursive: true });

const resolution = resolveAppEnvDetailed();
const flags = getFeatureFlags();
const flagsStaging = getFeatureFlags({ ...process.env, APP_ENV: "staging" });
const flagsProduction = getFeatureFlags({ ...process.env, APP_ENV: "production" });
const summary = summarizeConfig();
const productionProblems = collectProductionConfigProblems({
  ...process.env,
  APP_ENV: "production",
});
const stagingProblems = collectProductionConfigProblems({
  ...process.env,
  APP_ENV: "staging",
  AUTH_PROVIDER: process.env.AUTH_PROVIDER === "dev" ? "clerk" : process.env.AUTH_PROVIDER,
});

const envMatrix = {
  localDevelopment: {
    NODE_ENV: "development",
    APP_ENV: "development",
    notes: "DevAuth allowed only when APP_ENV is explicitly development. Stand-ins expected.",
  },
  testBenchmark: {
    NODE_ENV: "test",
    APP_ENV: process.env.APP_ENV ?? "development",
    database: redactDatabaseUrl(process.env.DATABASE_URL),
    notes: "Benchmark/certification DB is localhost:5433/nyayagrid. Not used as staging proof.",
  },
  staging: {
    NODE_ENV: "production",
    APP_ENV: "staging",
    database: { host: "localhost", port: "5433", database: STAGING_DB, identity: "disposable-staging-6w" },
    objectStorage: { provider: "minio", bucket: STAGING_BUCKET, endpoint: "http://localhost:9000" },
    clerk: envPresence("CLERK_SECRET_KEY") === "SET" && envPresence("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") === "SET",
    inngest: envPresence("INNGEST_SIGNING_KEY") === "SET" && envPresence("INNGEST_EVENT_KEY") === "SET",
    openai: envPresence("OPENAI_API_KEY") === "SET",
    featureAgents: flagsStaging.agents,
    authMode: "clerk required (DevAuth refused)",
    devAuth: isExplicitLocalDevAuthAllowed({ APP_ENV: "staging" }),
    storageMode: "minio + ALLOW_MINIO_IN_PRODUCTION rehearsal",
  },
  production: {
    NODE_ENV: "production",
    APP_ENV: "production",
    database: "managed postgres + pgvector (EXTERNAL)",
    objectStorage: "private S3 or operator-backed MinIO (EXTERNAL)",
    clerk: "required",
    inngest: "Inngest Cloud registration required",
    featureAgents: flagsProduction.agents,
    authMode: "clerk",
    devAuth: false,
    notes: "Boot throws unless collectProductionConfigProblems is empty.",
  },
  effectiveLocal: {
    appEnv: resolution.appEnv,
    appEnvSource: resolution.source,
    summary,
    presence: {
      DATABASE_URL: envPresence("DATABASE_URL"),
      AUTH_PROVIDER: process.env.AUTH_PROVIDER ?? "unset",
      CLERK_SECRET_KEY: envPresence("CLERK_SECRET_KEY"),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: envPresence("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
      CLERK_WEBHOOK_SECRET: envPresence("CLERK_WEBHOOK_SECRET"),
      INNGEST_SIGNING_KEY: envPresence("INNGEST_SIGNING_KEY"),
      INNGEST_EVENT_KEY: envPresence("INNGEST_EVENT_KEY"),
      INNGEST_DEV: process.env.INNGEST_DEV ?? "unset",
      OPENAI_API_KEY: envPresence("OPENAI_API_KEY"),
      REDIS_URL: envPresence("REDIS_URL"),
      SMTP_HOST: envPresence("SMTP_HOST"),
      S3_BUCKET: process.env.S3_BUCKET ? "SET" : "UNSET",
      S3_ENDPOINT: process.env.S3_ENDPOINT ? "SET" : "UNSET",
    },
    flags,
    productionProblemCount: productionProblems.length,
    stagingProblemCount: stagingProblems.length,
  },
};

record(
  "feature_agents_off",
  flagsStaging.agents === false && flagsProduction.agents === false ? "PASS" : "CRITICAL",
  `staging=${flagsStaging.agents} production=${flagsProduction.agents}`,
);
record(
  "devauth_staging",
  isExplicitLocalDevAuthAllowed({ APP_ENV: "staging" }) === false ? "PASS" : "CRITICAL",
  "DevAuth identity is unavailable for APP_ENV=staging",
);
record(
  "corpus_import_default",
  !["1", "true", "yes", "on"].includes((process.env.ALLOW_AUTHORITY_HTTP_IMPORT ?? "").toLowerCase())
    ? "PASS"
    : "CRITICAL",
  "ALLOW_AUTHORITY_HTTP_IMPORT unset/false for this process",
);

let postgresUp = false;
try {
  const ids = docker(["ps", "-q", "-f", `name=^/${POSTGRES}$`]).trim();
  postgresUp = Boolean(ids);
  record("postgres_container", postgresUp ? "PASS" : "BLOCKED", postgresUp ? POSTGRES : "not running");
} catch (error) {
  record("postgres_container", "BLOCKED", error instanceof Error ? error.message : "docker unavailable");
}

const liveUrl = process.env.DATABASE_URL ?? "";
if (liveUrl.includes(`/${STAGING_DB}`) === false && liveUrl.includes("/nyayagrid")) {
  record(
    "benchmark_db_isolation",
    "PASS",
    "Ops proof targets disposable staging DBs, not the certification database name nyayagrid",
  );
}

const counts: Record<string, number> = {};
let backupMeta: Record<string, unknown> = {};

if (postgresUp) {
  try {
    psql("postgres", `DROP DATABASE IF EXISTS ${STAGING_DB} WITH (FORCE);`);
    psql("postgres", `DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE);`);
    psql("postgres", `CREATE DATABASE ${STAGING_DB};`);
    psql(STAGING_DB, `CREATE EXTENSION IF NOT EXISTS vector;`);
    psql(STAGING_DB, `CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    record("staging_db_created", "PASS", STAGING_DB);

    const migrateUrl = `postgresql://nyayagrid:nyayagrid@localhost:5433/${STAGING_DB}`;
    const migrate = spawnSync("npm", ["run", "db:migrate"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: migrateUrl },
      encoding: "utf8",
      shell: true,
    });
    if (migrate.status !== 0) {
      record("migrations", "CRITICAL", (migrate.stderr || migrate.stdout || "migrate failed").slice(0, 400));
    } else {
      const applied = psql(
        STAGING_DB,
        "SELECT count(*) FROM drizzle.__drizzle_migrations;",
      );
      const extensions = psql(
        STAGING_DB,
        "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto') ORDER BY 1;",
      );
      const indexes = psql(
        STAGING_DB,
        "SELECT count(*) FROM pg_indexes WHERE schemaname='public';",
      );
      record(
        "migrations",
        Number(applied) >= 13 ? "PASS" : "NEEDS_WORK",
        `applied=${applied} expected>=13 extensions=${extensions.replaceAll("\n", ",")} indexes=${indexes}`,
      );
      record("pgvector", extensions.includes("vector") ? "PASS" : "CRITICAL", extensions);

      const db = createDb(migrateUrl);
      try {
        const [owner] = await db
          .insert(users)
          .values({
            authSubject: "6w-staging-owner",
            email: "owner-6w@example.nyayagrid.local",
            name: "6W Staging Owner",
          })
          .returning();
        if (!owner) throw new Error("owner insert failed");
        const created = await createOrganizationWithDefaults(db, {
          name: "6W Staging Firm",
          slug: `6w-staging-${Date.now().toString(36)}`,
          type: "firm",
          ownerUserId: owner.id,
        });
        const [client] = await db
          .insert(clients)
          .values({
            organizationId: created.organization.id,
            displayName: "Harborline SYNTH Client",
            clientType: "organization",
            createdByUserId: owner.id,
          })
          .returning();
        if (!client) throw new Error("client insert failed");
        const [supported] = await db
          .insert(matters)
          .values({
            organizationId: created.organization.id,
            clientId: client.id,
            matterNumber: "6W-CANARY-VA",
            title: "6W Virginia goods canary",
            practiceArea: "commercial",
            jurisdiction: "Virginia",
            primaryState: "VA",
            governingLawState: "VA",
            jurisdictionMode: "single_state",
            createdByUserId: owner.id,
          })
          .returning();
        const [unvalidated] = await db
          .insert(matters)
          .values({
            organizationId: created.organization.id,
            clientId: client.id,
            matterNumber: "6W-CANARY-UNV",
            title: "6W UNVALIDATED blotter canary",
            practiceArea: "unknown",
            jurisdiction: "UNVALIDATED",
            primaryState: "ZZ",
            governingLawState: "ZZ",
            jurisdictionMode: "unvalidated",
            createdByUserId: owner.id,
          })
          .returning();
        if (!supported || !unvalidated) throw new Error("matter insert failed");
        const [doc] = await db
          .insert(documents)
          .values({
            organizationId: created.organization.id,
            matterId: supported.id,
            createdByUserId: owner.id,
            title: "SYNTH 6W supply agreement",
          })
          .returning();
        await db.insert(conversations).values({
          organizationId: created.organization.id,
          matterId: supported.id,
          createdByUserId: owner.id,
          title: "6W canary conversation",
        });
        await db.insert(drafts).values({
          organizationId: created.organization.id,
          matterId: supported.id,
          title: "6W canary draft",
          draftType: "memo",
          createdByUserId: owner.id,
        });
        await db.insert(matterMemories).values({
          organizationId: created.organization.id,
          matterId: supported.id,
          memoryType: "factual_caveat",
          title: "Operative contract",
          content: "SYNTH: Harborline supply agreement is the operative contract for 6W canary.",
          status: "approved",
          createdByUserId: owner.id,
        });
        const [fromNode] = await db
          .insert(graphNodes)
          .values({
            organizationId: created.organization.id,
            matterId: supported.id,
            nodeType: "document",
            canonicalEntityType: "document",
            canonicalEntityId: doc?.id ?? supported.id,
            displayName: "SYNTH 6W supply agreement",
            status: "approved",
            createdByUserId: owner.id,
          })
          .returning();
        const [toNode] = await db
          .insert(graphNodes)
          .values({
            organizationId: created.organization.id,
            matterId: supported.id,
            nodeType: "matter",
            canonicalEntityType: "matter",
            canonicalEntityId: supported.id,
            displayName: "6W Virginia goods canary",
            status: "approved",
            createdByUserId: owner.id,
          })
          .returning();
        if (fromNode && toNode) {
          await db.insert(graphEdges).values({
            organizationId: created.organization.id,
            matterId: supported.id,
            fromNodeId: fromNode.id,
            toNodeId: toNode.id,
            relationshipType: "filed_in",
            status: "approved",
            createdByUserId: owner.id,
          });
        }
        await db.insert(legalAuthorities).values({
          authorityType: "statute",
          title: "SYNTH Va. Code § 8.2-725 (6W canary)",
          citation: "Va. Code § 8.2-725",
          authorityState: "VA",
          jurisdiction: "Virginia",
          sourceProvider: "6w-synthetic",
          sourceExternalId: "6w-va-825",
          ingestionStatus: "ready",
        });
        record(
          "seed",
          "PASS",
          `org=${created.organization.slug} matters=2 documents=1`,
        );
      } finally {
        await closeDb(db);
      }

      docker([
        "exec",
        POSTGRES,
        "pg_dump",
        "-U",
        "nyayagrid",
        "-d",
        STAGING_DB,
        "-Fc",
        "-f",
        "/tmp/nyayagrid_staging_6w.dump",
      ]);
      const dumpPath = join(outDir, "nyayagrid_staging_6w.dump");
      docker(["cp", `${POSTGRES}:/tmp/nyayagrid_staging_6w.dump`, dumpPath]);
      const dumpSize = statSync(dumpPath).size;
      backupMeta = {
        timestamp: new Date().toISOString(),
        database: STAGING_DB,
        format: "pg_dump custom (-Fc)",
        sizeBytes: dumpSize,
        command: `docker exec ${POSTGRES} pg_dump -U nyayagrid -d ${STAGING_DB} -Fc`,
        encryption: "none (local rehearsal; encrypt before any off-host copy)",
        storage: dumpPath.replace(repoRoot, "."),
      };
      record("backup", dumpSize > 0 ? "PASS" : "CRITICAL", `sizeBytes=${dumpSize}`);

      psql("postgres", `CREATE DATABASE ${RESTORE_DB};`);
      docker(["cp", dumpPath, `${POSTGRES}:/tmp/nyayagrid_staging_6w.dump`]);
      const restore = spawnSync(
        "docker",
        [
          "exec",
          POSTGRES,
          "pg_restore",
          "-U",
          "nyayagrid",
          "-d",
          RESTORE_DB,
          "--no-owner",
          "--no-acl",
          "/tmp/nyayagrid_staging_6w.dump",
        ],
        { encoding: "utf8" },
      );
      const restoreQueries = {
        organizations: Number(psql(RESTORE_DB, "SELECT count(*) FROM organizations;")),
        matters: Number(psql(RESTORE_DB, "SELECT count(*) FROM matters;")),
        documents: Number(psql(RESTORE_DB, "SELECT count(*) FROM documents;")),
        conversations: Number(psql(RESTORE_DB, "SELECT count(*) FROM conversations;")),
        legalAuthorities: Number(psql(RESTORE_DB, "SELECT count(*) FROM legal_authorities;")),
        drafts: Number(psql(RESTORE_DB, "SELECT count(*) FROM drafts;")),
        memories: Number(psql(RESTORE_DB, "SELECT count(*) FROM matter_memories;")),
        graphEdges: Number(psql(RESTORE_DB, "SELECT count(*) FROM graph_edges;")),
        analysisRunsTable: psql(RESTORE_DB, "SELECT to_regclass('public.analysis_runs');"),
        documentAnalysesTable: psql(RESTORE_DB, "SELECT to_regclass('public.document_analyses');"),
        vaMatters: Number(
          psql(RESTORE_DB, "SELECT count(*) FROM matters WHERE primary_state='VA';"),
        ),
        unvalidatedMatters: Number(
          psql(RESTORE_DB, "SELECT count(*) FROM matters WHERE jurisdiction_mode='unvalidated';"),
        ),
        extensions: psql(
          RESTORE_DB,
          "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto') ORDER BY 1;",
        ),
      };
      Object.assign(counts, restoreQueries);
      const restoreOk =
        restoreQueries.organizations >= 1 &&
        restoreQueries.matters >= 2 &&
        restoreQueries.documents >= 1 &&
        restoreQueries.legalAuthorities >= 1 &&
        restoreQueries.extensions.includes("vector");
      record(
        "restore",
        restoreOk ? "PASS" : "CRITICAL",
        `pg_restore_status=${restore.status ?? "unknown"} ${JSON.stringify(restoreQueries)}`,
      );
      record(
        "coverage_labels",
        restoreQueries.vaMatters >= 1 && restoreQueries.unvalidatedMatters >= 1 ? "PASS" : "NEEDS_WORK",
        "VA supported matter and UNVALIDATED matter survived restore",
      );
    }
  } catch (error) {
    record("staging_db", "CRITICAL", error instanceof Error ? error.message.slice(0, 400) : "error");
  }
}

let storageRecovery: "PASS" | "NEEDS_WORK" | "BLOCKED" = "BLOCKED";
try {
  process.env.S3_BUCKET = STAGING_BUCKET;
  const storage = createStorageProviderFromEnv();
  await storage.ensureBucket();
  const orgId = "00000000-0000-4000-8000-0000000006w1";
  const key = storageKeyForOrganization({
    organizationId: orgId,
    documentId: "00000000-0000-4000-8000-0000000006w2",
    versionId: "00000000-0000-4000-8000-0000000006w3",
    filename: "../evil/6w-canary.txt",
  });
  if (key.split("/").includes("..") || key.includes("/../") || !key.startsWith(`org/${orgId}/`)) {
    record("object_key_isolation", "CRITICAL", key);
  } else {
    record("object_key_isolation", "PASS", "filename traversal normalized; org-prefixed key");
  }
  const body = Buffer.from("SYNTH 6W staging object\n");
  await storage.putObject({ key, body, contentType: "text/plain", metadata: { tenant: orgId } });
  const downloaded = await storage.getObject(key);
  const signed = await storage.getSignedDownloadUrl({ key, expiresInSeconds: 60 });
  let missingOk = false;
  try {
    await storage.getObject(`${key}-missing`);
  } catch {
    missingOk = true;
  }
  const privateUrl = !signed.includes("X-Amz-Expires") ? false : !signed.toLowerCase().includes("public");
  record(
    "object_storage",
    downloaded.equals(body) && missingOk && signed.startsWith("http") ? "PASS" : "NEEDS_WORK",
    `upload/download=${downloaded.equals(body)} missing=${missingOk} signed=${signed.startsWith("http")} privateHeuristic=${privateUrl}`,
  );

  const backupKey = `${key}.bak`;
  const original = await storage.getObject(key);
  await storage.putObject({ key: backupKey, body: original, contentType: "text/plain" });
  const s3 = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "nyayagrid",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "nyayagridsecret",
    },
  });
  await s3.send(new DeleteObjectCommand({ Bucket: STAGING_BUCKET, Key: key }));
  let isolated = false;
  try {
    await storage.getObject(key);
  } catch {
    isolated = true;
  }
  const recoveredBytes = await storage.getObject(backupKey);
  await storage.putObject({ key, body: recoveredBytes, contentType: "text/plain" });
  const restoredObj = await storage.getObject(key);
  storageRecovery = isolated && restoredObj.equals(body) ? "PASS" : "NEEDS_WORK";
  record(
    "object_storage_recovery",
    storageRecovery,
    `local MinIO copy/delete/restore=${storageRecovery}. Provider-native versioning/PITR is EXTERNAL PROOF REQUIRED.`,
  );
} catch (error) {
  record(
    "object_storage",
    "BLOCKED",
    error instanceof Error ? error.message.slice(0, 300) : "storage error",
  );
}

const secretScan = scanSecrets();
record(
  "secret_hygiene_tracked",
  secretScan.hits === 0 ? "PASS" : "CRITICAL",
  secretScan.hits === 0
    ? "no live-looking credential patterns in scanned non-test sources"
    : `pattern hits in ${secretScan.files.join(", ")} (paths only; values not printed)`,
);

const clerkReady =
  envPresence("CLERK_SECRET_KEY") === "SET" &&
  envPresence("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") === "SET" &&
  envPresence("CLERK_WEBHOOK_SECRET") === "SET";
const inngestReady =
  envPresence("INNGEST_SIGNING_KEY") === "SET" &&
  envPresence("INNGEST_EVENT_KEY") === "SET" &&
  !["1", "true"].includes((process.env.INNGEST_DEV ?? "").toLowerCase()) &&
  (process.env.INNGEST_SIGNING_KEY ?? "").length >= 16 &&
  process.env.INNGEST_SIGNING_KEY !== "local";

record(
  "clerk_credentials",
  clerkReady ? "PASS" : "BLOCKED",
  clerkReady ? "Clerk keys present (not printed)" : "EXTERNAL ACTION REQUIRED — CLERK BETA USERS",
);
record(
  "inngest_credentials",
  inngestReady ? "PASS" : "BLOCKED",
  inngestReady
    ? "Inngest keys present (not printed)"
    : "EXTERNAL ACTION REQUIRED — INNGEST CLOUD REGISTRATION",
);

const report = {
  id: "BASELINE_6W_OPS1",
  generatedAt: new Date().toISOString(),
  outDir: outDir.replace(repoRoot, "."),
  envMatrix,
  backup: backupMeta,
  restoreCounts: counts,
  checks,
  externalActions: [
    ...(clerkReady ? [] : ["CLERK staging application + beta users"]),
    ...(inngestReady ? [] : ["Inngest Cloud app registration against /api/inngest"]),
    "Managed Postgres PITR rehearsal on the production-shaped provider",
    "Private non-localhost object storage with versioning",
    "SMTP transport or Clerk-only invites",
    "Hosting/DNS/TLS cutover",
  ],
  featureAgents: { staging: flagsStaging.agents, production: flagsProduction.agents },
};

mkdirSync(baselinesDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(baselinesDir, "BASELINE_6W_OPS1.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: !checks.some((c) => c.status === "CRITICAL"), outDir: report.outDir, checks: checks.length }, null, 2));
process.exit(checks.some((c) => c.status === "CRITICAL") ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
