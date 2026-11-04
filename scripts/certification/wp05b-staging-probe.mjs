#!/usr/bin/env node
/**
 * WP-05B — probe an existing staging host for operational evidence.
 * Never prints secrets. Does not deploy. Does not mutate staging.
 *
 * Usage:
 *   STAGING_BASE_URL=https://staging.nyayagrid.com node scripts/certification/wp05b-staging-probe.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.env.STAGING_BASE_URL ?? "https://staging.nyayagrid.com").replace(/\/$/, "");
const outDir = path.resolve("packages/research/corpus/reports");
mkdirSync(outDir, { recursive: true });

async function probe(pathname) {
  const url = `${base}${pathname}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual" });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      path: pathname,
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      bodySnippet: text.slice(0, 800),
      json,
    };
  } catch (error) {
    return {
      path: pathname,
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const paths = [
  "/api/health/live",
  "/api/health/ready",
  "/api/v1/health",
  "/sign-in",
  "/terms",
  "/privacy",
];

const results = [];
for (const p of paths) {
  results.push(await probe(p));
}

const live = results.find((r) => r.path === "/api/health/live");
const ready = results.find((r) => r.path === "/api/health/ready");
const v1 = results.find((r) => r.path === "/api/v1/health");

const redisOk = ready?.json?.checks?.redis === "ok";
const dbOk = ready?.json?.checks?.database === "ok";
const storageOk = ready?.json?.checks?.storage === "ok";
const gitSha = live?.json?.gitSha ?? ready?.json?.checks?.gitSha ?? null;
const readyShape = ready?.json?.status
  ? "wp05_status_model"
  : ready?.json?.checks
    ? "legacy_checks_only"
    : "unknown";

const report = {
  classification: "NYAYAGRID_WP05B_STAGING_PROBE",
  probedAt: new Date().toISOString(),
  stagingBaseUrl: base,
  hostingProvider: "fly.io (documented app nyayagrid-staging)",
  results: results.map((r) => ({
    path: r.path,
    status: r.status,
    ok: r.ok,
    ms: r.ms,
    error: r.error ?? null,
    // Avoid dumping full HTML; keep small JSON health bodies.
    bodySnippet: r.json
      ? JSON.stringify(r.json).slice(0, 600)
      : `(non-json len=${(r.bodySnippet ?? "").length})`,
  })),
  summary: {
    liveOk: Boolean(live?.ok),
    readyOk: Boolean(ready?.ok),
    readyStatus: ready?.status ?? null,
    database: dbOk ? "ok" : (ready?.json?.checks?.database ?? "unknown"),
    storage: storageOk ? "ok" : (ready?.json?.checks?.storage ?? "unknown"),
    redis: redisOk ? "ok" : (ready?.json?.checks?.redis ?? "unknown"),
    appEnv: v1?.json?.appEnv ?? ready?.json?.checks?.appEnv ?? null,
    authProvider: v1?.json?.authProvider ?? null,
    malwareScanner: v1?.json?.config?.malwareScanner ?? null,
    gitSha,
    readyShape,
    stagingDeployedButNotReady: Boolean(live?.ok) && !Boolean(ready?.ok),
    wp05HealthEndpointsDeployed: readyShape === "wp05_status_model" && gitSha != null,
  },
  blockers: [
    !redisOk
      ? {
          id: "STAGING_REDIS_UNAVAILABLE",
          operatorAction:
            "fly auth login && fly secrets / REDIS_URL for nyayagrid-staging — restore reachable Redis so /api/health/ready returns 200",
          prevents: "staging_certification",
          evidenceNeeded: "ready JSON with checks.redis=ok and HTTP 200",
        }
      : null,
    !gitSha
      ? {
          id: "STAGING_BUILD_SHA_NOT_VISIBLE",
          operatorAction:
            "After fly auth login, deploy commit with WP-05 live/ready identity (GIT_SHA) to nyayagrid-staging via approved gate",
          prevents: "staging_certification",
          evidenceNeeded: "live JSON includes gitSha matching deployed commit",
        }
      : null,
    {
      id: "FLY_CLI_UNAUTHENTICATED",
      operatorAction:
        "fly auth login (or set FLY_API_TOKEN) for the NyayaGrid org owning nyayagrid-staging",
      prevents: "staging_deploy_and_rollback",
      evidenceNeeded: "fly apps list shows nyayagrid-staging",
    },
  ].filter(Boolean),
  verdict: live?.ok
    ? ready?.ok
      ? "STAGING_HOST_HEALTHY"
      : "STAGING_HOST_DEGRADED_NOT_READY"
    : "STAGING_HOST_UNREACHABLE",
};

const outPath = path.join(outDir, "wp05b-staging-probe.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);
process.exit(ready?.ok ? 0 : 2);
