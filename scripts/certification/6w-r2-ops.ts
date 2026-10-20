#!/usr/bin/env npx tsx
/**
 * Phase 6W-R2 ops inventory and local/staging-shaped probes.
 * Never prints secret values.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getFeatureFlags } from "@nyayagrid/platform";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "tmp", "6w-r2-ops");
mkdirSync(outDir, { recursive: true });

type Status = "PASS" | "NEEDS_WORK" | "BLOCKED" | "CRITICAL" | "EXTERNAL" | "MISSING" | "AVAILABLE";
type Check = { name: string; status: Status; detail: string };
const checks: Check[] = [];

function record(name: string, status: Status, detail: string) {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name} — ${detail}`);
}

function loadDotEnvKeys(filePath: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!existsSync(filePath)) return map;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const commented = line.startsWith("#");
    const body = commented ? line.replace(/^#\s*/, "") : line;
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    map.set(key, !commented && value.length > 0);
  }
  return map;
}

const dotenv = loadDotEnvKeys(join(repoRoot, ".env"));

function present(key: string): boolean {
  const fromProcess = Boolean(process.env[key]?.trim());
  return fromProcess || dotenv.get(key) === true;
}

function truthy(key: string): boolean {
  const raw = (process.env[key] ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return false;
}

record("file.env", existsSync(join(repoRoot, ".env")) ? "AVAILABLE" : "MISSING", ".env");
record("file.env.staging", existsSync(join(repoRoot, ".env.staging")) ? "AVAILABLE" : "MISSING", ".env.staging");
record("clerk.secret", present("CLERK_SECRET_KEY") ? "AVAILABLE" : "MISSING", "CLERK_SECRET_KEY");
record("clerk.publishable", present("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") ? "AVAILABLE" : "MISSING", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
record("clerk.webhook", present("CLERK_WEBHOOK_SECRET") ? "AVAILABLE" : "MISSING", "CLERK_WEBHOOK_SECRET");
record("inngest.eventKey", present("INNGEST_EVENT_KEY") ? "AVAILABLE" : "MISSING", "presence only; local/weak keys are not Cloud proof");
record("inngest.signingKey", present("INNGEST_SIGNING_KEY") ? "AVAILABLE" : "MISSING", "presence only; local/weak keys are not Cloud proof");
record("inngest.dev", truthy("INNGEST_DEV") || dotenv.get("INNGEST_DEV") === true ? "BLOCKED" : "PASS", "INNGEST_DEV must be unset/false for Cloud");
record("redis.url", present("REDIS_URL") || present("REDIS_HOST") ? "AVAILABLE" : "MISSING", "app env Redis");
record("s3.bucket", present("S3_BUCKET") ? "AVAILABLE" : "MISSING", "local MinIO rehearsal if endpoint is localhost");
record("database.url", present("DATABASE_URL") ? "AVAILABLE" : "MISSING", "presence only");
record("malware.env", present("MALWARE_SCANNER") ? "AVAILABLE" : "MISSING", "development scanner is not staging proof");
record("staging.baseUrl", present("STAGING_BASE_URL") ? "AVAILABLE" : "MISSING", "no staging host configured");
record("feature.agents.env", present("FEATURE_AGENTS") ? "AVAILABLE" : "MISSING", "unset uses env default");

const stagingAgents = getFeatureFlags({ APP_ENV: "staging" }).agents;
const productionAgents = getFeatureFlags({ APP_ENV: "production" }).agents;
record("feature.agents.staging", stagingAgents ? "CRITICAL" : "PASS", `staging default agents=${stagingAgents}`);
record("feature.agents.production", productionAgents ? "CRITICAL" : "PASS", `production default agents=${productionAgents}`);

const base = (process.env.BETA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function probe(path: string) {
  try {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    const headers: Record<string, string> = {};
    for (const name of [
      "content-security-policy",
      "strict-transport-security",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
    ]) {
      const value = res.headers.get(name);
      if (value) headers[name] = "present";
    }
    return { status: res.status, headers, ok: res.ok };
  } catch (error) {
    return { status: 0, headers: {}, ok: false, error: error instanceof Error ? error.message : "fetch failed" };
  }
}

async function main() {
const live = await probe("/api/health/live");
record("http.live", live.status === 200 ? "PASS" : "BLOCKED", `GET ${base}/api/health/live → ${live.status || live.error}`);

const ready = await probe("/api/health/ready");
record(
  "http.ready",
  ready.status === 200 ? "PASS" : "BLOCKED",
  `GET ${base}/api/health/ready → ${ready.status} (503 expected until staging config is complete)`,
);

const matters = await probe("/api/v1/matters");
const unauthOk = matters.status === 401 || matters.status === 403;
record(
  "http.unauthenticated",
  unauthOk ? "PASS" : "NEEDS_WORK",
  `GET /api/v1/matters → ${matters.status} (401/403 required for staging Clerk; local DevAuth may differ)`,
);

const headerNames = Object.keys(live.headers);
record(
  "http.securityHeaders",
  live.headers["content-security-policy"] && live.headers["x-frame-options"] && live.headers["x-content-type-options"]
    ? "PASS"
    : "NEEDS_WORK",
  `observed: ${headerNames.join(", ") || "none"}; HSTS only expected on production HTTPS`,
);

try {
  const redis = execFileSync("docker", ["exec", "nyayagrid-redis", "redis-cli", "ping"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  record("redis.docker", redis === "PONG" ? "PASS" : "NEEDS_WORK", "local docker Redis ping (not multi-instance staging proof)");
} catch {
  record("redis.docker", "EXTERNAL", "docker Redis not reachable");
}

try {
  const clam = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "nyayagrid-clamav"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  record("malware.clamavContainer", clam === "healthy" ? "PASS" : "NEEDS_WORK", "local ClamAV container; app MALWARE_SCANNER must still be clamav for staging proof");
} catch {
  record("malware.clamavContainer", "EXTERNAL", "ClamAV container not found");
}

try {
  const minio = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "nyayagrid-minio"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  record("storage.minio", minio === "healthy" ? "PASS" : "NEEDS_WORK", "local MinIO rehearsal; provider S3 remains EXTERNAL");
} catch {
  record("storage.minio", "EXTERNAL", "MinIO container not found");
}

record("clerk.authProof", "BLOCKED", "Clerk credentials absent — HUMAN EXTERNAL ACTION REQUIRED");
record("inngest.cloud", "BLOCKED", "INNGEST_DEV active / Cloud keys not proven — HUMAN EXTERNAL ACTION REQUIRED");
record("http.rbac", "BLOCKED", "requires Clerk staging sessions");
record("http.isolation", "BLOCKED", "requires Clerk Org A/B sessions");
record("upload.http202", "BLOCKED", "requires authenticated staging upload");
record("ingest.cloud", "BLOCKED", "requires Inngest Cloud registration");
record("e2e.canary", "BLOCKED", "requires Clerk + Inngest Cloud");
record("rollback.image", "EXTERNAL", "no staging host for N→N+1→N");
record("pitr.managed", "EXTERNAL", "no managed Postgres provider");
record("storage.providerRecovery", "EXTERNAL", "localhost MinIO is rehearsal only");
record("alerting", "EXTERNAL", "no alerting provider configured");
record("monitoring", "EXTERNAL", "hosting/Inngest/Clerk dashboards unavailable without staging");

const summary = {
  id: "BASELINE_6W_R2_OPS1",
  generatedAt: new Date().toISOString(),
  base,
  technicallyDeployable: false,
  clerkBlocked: true,
  inngestCloudBlocked: true,
  checks,
};

writeFileSync(join(outDir, "ops1.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  join(repoRoot, "benchmarks", "nyaya-bench", "baselines", "BASELINE_6W_R2_OPS1.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(`wrote ${checks.length} checks`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
