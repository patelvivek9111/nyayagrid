#!/usr/bin/env node
/**
 * Writes docs/rc1-freeze.json from the current git commit. Names and versions only — no secret values.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getFeatureFlags } from "@nyayagrid/platform";
import { CERTIFICATION_EVIDENCE } from "@nyayagrid/ai";
import { MODEL_REGISTRY_VERSION, NYAYA_ROUTER_VERSION } from "@nyayagrid/ai";
import { FEATURE_FLAGS } from "@nyayagrid/platform";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: repoRoot }).trim();
}

const frozen = JSON.parse(
  readFileSync(join(repoRoot, "benchmarks/nyaya-bench/model-routing/frozen-config.json"), "utf8"),
);
const journal = JSON.parse(
  readFileSync(join(repoRoot, "packages/database/drizzle/meta/_journal.json"), "utf8"),
);
const flags = getFeatureFlags({ APP_ENV: "staging", FEATURE_AGENTS: "0" });

const freeze = {
  gateId: "nyaya-rc1-freeze",
  frozenAt: new Date().toISOString(),
  gitCommitSha: git(["rev-parse", "HEAD"]),
  gitTree: git(["status", "--porcelain"]) === "" ? "clean" : "dirty",
  imageDeploymentId: process.env.RC1_IMAGE_ID ?? null,
  app: "nyayagrid-staging",
  migrations: {
    journalVersion: journal.version,
    dialect: journal.dialect,
    tags: journal.entries.map((entry) => entry.tag),
  },
  router: {
    routerVersion: NYAYA_ROUTER_VERSION,
    registryVersion: MODEL_REGISTRY_VERSION,
    certificationOverlay: CERTIFICATION_EVIDENCE.benchmarkId,
    overlayApplied: CERTIFICATION_EVIDENCE.applied,
    preferredAuto: CERTIFICATION_EVIDENCE.preferredAuto,
  },
  prompts: frozen.promptVersions,
  pinnedModelIds: frozen.pinnedModelIds,
  featureFlags: {
    names: FEATURE_FLAGS,
    stagingDefaultsWithAgentsOff: flags,
    flySecretName: "FEATURE_AGENTS",
    flyToml: "FEATURE_AGENTS=0",
  },
  environmentNames: {
    flyToml: [
      "APP_ENV",
      "NODE_ENV",
      "FEATURE_AGENTS",
      "PORT",
      "AUTH_PROVIDER",
      "AI_PROVIDER",
      "EMBEDDING_PROVIDER",
      "MALWARE_SCANNER",
      "OCR_PROVIDER",
      "BILLING_PROVIDER",
      "STORAGE_PROVIDER",
    ],
    flySecrets: [
      "APP_ENV",
      "FEATURE_AGENTS",
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SECRET",
      "AUTH_PROVIDER",
      "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
      "NEXT_PUBLIC_CLERK_SIGN_OUT_URL",
      "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "XAI_API_KEY",
      "STORAGE_PROVIDER",
      "S3_BUCKET",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_FORCE_PATH_STYLE",
      "S3_ENDPOINT",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
      "RATE_LIMIT_PROVIDER",
      "REDIS_URL",
      "CLAMAV_HOST",
      "MALWARE_SCANNER",
      "SMTP_PASSWORD",
      "EMAIL_PROVIDER",
      "SMTP_HOST",
      "SMTP_USERNAME",
      "EMAIL_FROM",
      "SMTP_PORT",
    ],
    absentOnStaging: ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  benchmark: {
    codePackage: "benchmarks/nyaya-bench",
    frozenConfigId: frozen.id,
    graderVersionNyayaBench: frozen.graderVersionNyayaBench,
    datasets: "benchmarks/nyaya-bench/datasets — unmodified for this freeze",
    historicalBaselines: frozen.historicalBaselines,
  },
  lockfile: "package-lock.json",
  buildCommand: "docker build via fly.staging.toml (Dockerfile: npm ci && npm run build -w @nyayagrid/web)",
  deployCommand:
    "flyctl deploy --config fly.staging.toml --app nyayagrid-staging --ha=false --yes --wait-timeout 10m --release-command-timeout 10m",
  rollbackCommand:
    "flyctl deploy --config fly.staging.toml --app nyayagrid-staging --image registry.fly.io/nyayagrid-staging:<prior-deployment-tag> --ha=false --yes --wait-timeout 10m --release-command-timeout 10m",
  recovery: {
    neonProject: "nyayagrid-staging",
    neonProjectId: "odd-moon-90379900",
    historyRetentionSeconds: 21600,
    pitrWindow: "6h-free-default",
    objectRecovery: "unique-per-version keys; no R2 bucket versioning assumed",
  },
};

const out = join(repoRoot, "docs/rc1-freeze.json");
writeFileSync(out, `${JSON.stringify(freeze, null, 2)}\n`);
console.log(JSON.stringify({ wrote: "docs/rc1-freeze.json", gitCommitSha: freeze.gitCommitSha, gitTree: freeze.gitTree }));
