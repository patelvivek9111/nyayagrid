#!/usr/bin/env npx tsx
/**
 * RC1 staging inventory. Presence and host class only — never prints secret values.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getFeatureFlags } from "@nyayagrid/platform";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "benchmarks", "nyaya-bench", "staging-rc");
mkdirSync(outDir, { recursive: true });

type Status = "PASS" | "LIMITED" | "BLOCKED_EXTERNAL" | "FAIL" | "CRITICAL" | "MISSING" | "AVAILABLE";

type Check = { id: string; status: Status; detail: string };
const checks: Check[] = [];

function record(id: string, status: Status, detail: string) {
  checks.push({ id, status, detail });
}

function loadDotEnvPresence(filePath: string): Map<string, { present: boolean; commented: boolean; hostClass: ReturnType<typeof hostClass>; truthy: boolean }> {
  const map = new Map<string, { present: boolean; commented: boolean; hostClass: ReturnType<typeof hostClass>; truthy: boolean }>();
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
    map.set(key, {
      present: !commented && value.length > 0,
      commented,
      hostClass: hostClass(value),
      truthy: ["1", "true", "yes", "on"].includes(value.toLowerCase()),
    });
  }
  return map;
}

const dotenv = loadDotEnvPresence(join(repoRoot, ".env"));
const stagingDotenv = loadDotEnvPresence(join(repoRoot, ".env.staging"));

function present(key: string): boolean {
  return Boolean(process.env[key]?.trim()) || dotenv.get(key)?.present === true || stagingDotenv.get(key)?.present === true;
}

function rawFromFiles(key: string): string {
  return (process.env[key] ?? "").trim();
}

function hostClass(value: string | undefined): "missing" | "localhost" | "https-remote" | "http-remote" | "opaque" {
  if (!value?.trim()) return "missing";
  const v = value.trim();
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(v)) return "localhost";
  if (/^https:\/\//i.test(v)) return "https-remote";
  if (/^https?:\/\//i.test(v) || /^postgres(ql)?:\/\//i.test(v) || /^redis:\/\//i.test(v)) {
    return /^https:|^postgres(ql)s?:\/\/[^@]*@?[^:]+:5432/.test(v) && !/localhost/i.test(v)
      ? "http-remote"
      : /localhost|127\./i.test(v)
        ? "localhost"
        : "http-remote";
  }
  return "opaque";
}

function classifyUrlKey(key: string): ReturnType<typeof hostClass> {
  const fromProcess = rawFromFiles(key);
  if (fromProcess) return hostClass(fromProcess);
  const fileClass = stagingDotenv.get(key)?.hostClass ?? dotenv.get(key)?.hostClass;
  if (fileClass && fileClass !== "missing") return fileClass;
  return present(key) ? "opaque" : "missing";
}

record("file.env", existsSync(join(repoRoot, ".env")) ? "AVAILABLE" : "MISSING", ".env present (values not printed)");
record(
  "file.env.staging",
  existsSync(join(repoRoot, ".env.staging")) ? "AVAILABLE" : "MISSING",
  ".env.staging",
);
record(
  "file.env.production",
  existsSync(join(repoRoot, ".env.production")) ? "AVAILABLE" : "MISSING",
  ".env.production",
);

record("clerk.secret", present("CLERK_SECRET_KEY") ? "AVAILABLE" : "MISSING", "CLERK_SECRET_KEY presence");
record(
  "clerk.publishable",
  present("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") ? "AVAILABLE" : "MISSING",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY presence",
);
record("clerk.webhook", present("CLERK_WEBHOOK_SECRET") ? "AVAILABLE" : "MISSING", "CLERK_WEBHOOK_SECRET presence");
record(
  "clerk.signInUrl",
  present("NEXT_PUBLIC_CLERK_SIGN_IN_URL") ? "AVAILABLE" : "MISSING",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL presence",
);

const stagingUrl = process.env.STAGING_BASE_URL || process.env.BETA_BASE_URL || "";
const stagingClass = hostClass(stagingUrl) !== "missing" ? hostClass(stagingUrl) : classifyUrlKey("STAGING_BASE_URL");
const appUrlClass = classifyUrlKey("NEXT_PUBLIC_APP_URL");
record(
  "https.stagingBase",
  stagingClass === "https-remote" ? "PASS" : "BLOCKED_EXTERNAL",
  `STAGING_BASE_URL host class=${stagingClass}`,
);
record(
  "https.appUrl",
  appUrlClass === "https-remote" ? "LIMITED" : appUrlClass === "localhost" ? "BLOCKED_EXTERNAL" : "BLOCKED_EXTERNAL",
  `NEXT_PUBLIC_APP_URL host class=${appUrlClass}`,
);

record("inngest.eventKey", present("INNGEST_EVENT_KEY") ? "AVAILABLE" : "MISSING", "presence only");
record("inngest.signingKey", present("INNGEST_SIGNING_KEY") ? "AVAILABLE" : "MISSING", "presence only");
const inngestDev =
  ["1", "true", "yes", "on"].includes((process.env.INNGEST_DEV ?? "").trim().toLowerCase()) ||
  dotenv.get("INNGEST_DEV")?.truthy === true ||
  stagingDotenv.get("INNGEST_DEV")?.truthy === true;
record("inngest.dev", inngestDev ? "BLOCKED_EXTERNAL" : "PASS", "INNGEST_DEV must be unset for Cloud proof");

const dbClass = classifyUrlKey("DATABASE_URL");
record(
  "database.url",
  dbClass === "localhost" || dbClass === "missing" ? "BLOCKED_EXTERNAL" : "LIMITED",
  `DATABASE_URL host class=${dbClass} (localhost is not managed staging proof)`,
);
const redisClass = classifyUrlKey("REDIS_URL");
record(
  "redis.url",
  present("REDIS_URL") || present("REDIS_HOST")
    ? redisClass === "localhost"
      ? "LIMITED"
      : "LIMITED"
    : "BLOCKED_EXTERNAL",
  `app Redis host class=${redisClass === "missing" && present("REDIS_HOST") ? "opaque" : redisClass}`,
);
const s3Class = classifyUrlKey("S3_ENDPOINT");
record(
  "storage.endpoint",
  s3Class === "localhost" || s3Class === "missing" ? "BLOCKED_EXTERNAL" : "LIMITED",
  `S3_ENDPOINT host class=${s3Class}`,
);
record("storage.bucket", present("S3_BUCKET") ? "AVAILABLE" : "MISSING", "S3_BUCKET presence");

record("openai.key", present("OPENAI_API_KEY") ? "AVAILABLE" : "MISSING", "OPENAI_API_KEY presence");
record("xai.key", present("XAI_API_KEY") ? "AVAILABLE" : "MISSING", "XAI_API_KEY presence");
record("anthropic.key", present("ANTHROPIC_API_KEY") ? "AVAILABLE" : "MISSING", "ANTHROPIC_API_KEY presence");
record(
  "google.key",
  present("GOOGLE_GENERATIVE_AI_API_KEY") || present("GEMINI_API_KEY") || present("GOOGLE_API_KEY")
    ? "AVAILABLE"
    : "MISSING",
  "Google key presence",
);

record(
  "feature.agents.process",
  present("FEATURE_AGENTS") ? "AVAILABLE" : "MISSING",
  "unset uses platform default false",
);

function dockerHealth(name: string): string {
  try {
    return execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "absent";
  }
}

record("rehearsal.postgres", dockerHealth("nyayagrid-postgres") === "healthy" ? "LIMITED" : "MISSING", "local docker only");
record("rehearsal.redis", dockerHealth("nyayagrid-redis") === "healthy" ? "LIMITED" : "MISSING", "local docker only");
record("rehearsal.minio", dockerHealth("nyayagrid-minio") === "healthy" ? "LIMITED" : "MISSING", "local docker only");
record("rehearsal.clamav", dockerHealth("nyayagrid-clamav") === "healthy" ? "LIMITED" : "MISSING", "local docker only");

let gitSha = "unknown";
try {
  gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: repoRoot }).trim();
} catch {
  gitSha = "unknown";
}

let ghAuth = "unauthenticated";
try {
  execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  ghAuth = "authenticated";
} catch {
  ghAuth = "unauthenticated";
}
record("github.cli", ghAuth === "authenticated" ? "LIMITED" : "BLOCKED_EXTERNAL", `gh auth ${ghAuth}`);

let vercelCli = "absent";
try {
  execFileSync("npx", ["vercel", "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  vercelCli = "installed";
} catch {
  vercelCli = "absent";
}
record("vercel.cli", vercelCli === "installed" ? "LIMITED" : "BLOCKED_EXTERNAL", "no hosting proof from CLI install alone");

const flags = getFeatureFlags({ APP_ENV: "staging" });
record("feature.agents.stagingDefault", flags.agents ? "CRITICAL" : "PASS", `staging agents=${flags.agents}`);

const clerkReady = present("CLERK_SECRET_KEY") && present("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && present("CLERK_WEBHOOK_SECRET");
record(
  "clerk.configured",
  clerkReady ? "LIMITED" : "BLOCKED_EXTERNAL",
  clerkReady ? "keys present locally — not HTTPS session proof" : "Clerk staging application/keys absent",
);

const httpsStaging = stagingClass === "https-remote";
record(
  "e2e.httpsCanary",
  httpsStaging && clerkReady ? "LIMITED" : "BLOCKED_EXTERNAL",
  "full lawyer canary requires HTTPS host + Clerk",
);

const artifact = {
  gateId: "nyaya-staging-rc1",
  generatedAt: new Date().toISOString(),
  gitSha,
  routerVersionFromFreeze: "nyaya-router-v1.1",
  registryVersion: "nyaya-registry-v1",
  certificationOverlay: "nyaya-four-provider-cert-v1",
  featureAgentsStagingDefault: flags.agents,
  checks,
  overall: clerkReady && httpsStaging ? "INCOMPLETE" : "BLOCKED_EXTERNAL",
};

writeFileSync(join(outDir, "inventory.json"), JSON.stringify(artifact, null, 2));
for (const check of checks) {
  console.log(`${check.status.padEnd(18)} ${check.id} — ${check.detail}`);
}
console.log(`wrote ${join(outDir, "inventory.json")} sha=${gitSha}`);
