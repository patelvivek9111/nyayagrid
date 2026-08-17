#!/usr/bin/env node
/**
 * Local matched backup/restore rehearsal against docker-compose Postgres + MinIO.
 * Restores Postgres to a NEW database (nyayagrid_restore_test), never over the live one.
 * This is not a managed-provider PITR rehearsal — see docs/BACKUP_RESTORE.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const POSTGRES = process.env.POSTGRES_CONTAINER ?? "nyayagrid-postgres";
const MINIO = process.env.MINIO_CONTAINER ?? "nyayagrid-minio";
const RESTORE_DB = "nyayagrid_restore_test";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve("tmp", "backup-rehearsal", stamp);

function docker(args) {
  try {
    return execFileSync("docker", args, { encoding: "utf8" });
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`docker ${args.join(" ")}\n${detail}`);
  }
}

function requireRunning(name) {
  const ids = docker(["ps", "-q", "-f", `name=^/${name}$`]).trim();
  if (!ids) {
    throw new Error(`${name} is not running. Start the stack with npm run docker:up`);
  }
}

mkdirSync(outDir, { recursive: true });
requireRunning(POSTGRES);
requireRunning(MINIO);

console.log(`Writing rehearsal artifacts to ${outDir}`);

docker(["exec", POSTGRES, "pg_dump", "-U", "nyayagrid", "-d", "nyayagrid", "-Fc", "-f", "/tmp/nyayagrid.dump"]);
docker(["cp", `${POSTGRES}:/tmp/nyayagrid.dump`, path.join(outDir, "nyayagrid.dump")]);

const minioTar = path.join(outDir, "minio-data.tgz").replaceAll("\\", "/");
docker([
  "run",
  "--rm",
  `--volumes-from`,
  MINIO,
  "-v",
  `${outDir}:/backup`,
  "alpine:3.20",
  "tar",
  "czf",
  "/backup/minio-data.tgz",
  "/data",
]);

docker([
  "exec",
  POSTGRES,
  "psql",
  "-U",
  "nyayagrid",
  "-d",
  "postgres",
  "-c",
  `DROP DATABASE IF EXISTS ${RESTORE_DB};`,
]);
docker([
  "exec",
  POSTGRES,
  "psql",
  "-U",
  "nyayagrid",
  "-d",
  "postgres",
  "-c",
  `CREATE DATABASE ${RESTORE_DB};`,
]);
docker(["cp", path.join(outDir, "nyayagrid.dump"), `${POSTGRES}:/tmp/nyayagrid.dump`]);
try {
  docker([
    "exec",
    POSTGRES,
    "pg_restore",
    "-U",
    "nyayagrid",
    "-d",
    RESTORE_DB,
    "--no-owner",
    "--no-acl",
    "/tmp/nyayagrid.dump",
  ]);
} catch (error) {
  console.warn("pg_restore exited non-zero; checking whether the restore is usable...");
  console.warn(error instanceof Error ? error.message : String(error));
}

const extensions = docker([
  "exec",
  POSTGRES,
  "psql",
  "-U",
  "nyayagrid",
  "-d",
  RESTORE_DB,
  "-tA",
  "-c",
  "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto') ORDER BY 1;",
]);
const matterProbe = docker([
  "exec",
  POSTGRES,
  "psql",
  "-U",
  "nyayagrid",
  "-d",
  RESTORE_DB,
  "-tA",
  "-c",
  "SELECT count(*) FROM matters;",
]);

const report = {
  at: new Date().toISOString(),
  postgresContainer: POSTGRES,
  minioContainer: MINIO,
  restoreDatabase: RESTORE_DB,
  dump: path.join(outDir, "nyayagrid.dump"),
  minioArchive: minioTar,
  extensions: extensions.trim().split(/\r?\n/).filter(Boolean),
  restoredMatterCount: Number(matterProbe.trim()),
  note: "Local docker rehearsal only. Managed-provider PITR remains BLOCKER until rehearsed on the target host.",
};
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!report.extensions.includes("vector")) {
  process.exitCode = 1;
  console.error("pgvector extension missing on the restored database");
}
