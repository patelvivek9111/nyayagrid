import { NextResponse } from "next/server";
import { sql } from "@nyayagrid/database";
import {
  aggregateOpsHealth,
  resolveBuildIdentity,
  withTimeout,
  type DependencyCheck,
} from "@nyayagrid/observability";
import {
  environmentBoundaryBlockers,
  evaluateEnvironmentBoundaries,
  pingRedis,
  resolveRateLimitProvider,
} from "@nyayagrid/platform";
import { getConfigBootstrapResult } from "@/lib/bootstrap";
import { getDb } from "@/lib/db";
import { publicDatabaseError } from "@/lib/health";

/**
 * Readiness: safe to serve traffic.
 * Liveness stays at /api/health/live and does not touch dependencies.
 * OpenAI is never probed here (cost/outage coupling).
 *
 * Overall status: HEALTHY | DEGRADED | UNAVAILABLE (WP-05).
 * Response never includes secret values.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  const deps: DependencyCheck[] = [];
  const config = getConfigBootstrapResult();
  const identity = resolveBuildIdentity();
  checks.gitSha = identity.gitSha;
  checks.buildId = identity.buildId;
  checks.appEnv = config.appEnv;

  const boundaryFindings = evaluateEnvironmentBoundaries();
  const boundaryBlockers = environmentBoundaryBlockers();
  checks.envBoundaries = boundaryFindings.map((f) => ({
    code: f.code,
    severity: f.severity,
  }));
  if (
    boundaryBlockers.length > 0 &&
    (config.appEnv === "production" || config.appEnv === "staging")
  ) {
    deps.push({
      name: "env_boundaries",
      status: "UNAVAILABLE",
      requiredForReady: true,
      detail: boundaryBlockers.map((b) => b.code).join(","),
    });
  } else if (boundaryFindings.some((f) => f.severity === "warning")) {
    deps.push({
      name: "env_boundaries",
      status: "DEGRADED",
      requiredForReady: false,
      detail: boundaryFindings
        .filter((f) => f.severity === "warning")
        .map((f) => f.code)
        .join(","),
    });
  } else {
    deps.push({ name: "env_boundaries", status: "HEALTHY", requiredForReady: true });
  }

  try {
    const db = getDb();
    await withTimeout(db.execute(sql`select 1`), 2000, "database health check");
    checks.database = "ok";
    deps.push({ name: "database", status: "HEALTHY", requiredForReady: true });
  } catch (error) {
    checks.database = "error";
    checks.databaseError = publicDatabaseError(error, config.appEnv);
    deps.push({
      name: "database",
      status: "UNAVAILABLE",
      requiredForReady: true,
      detail: "unreachable",
    });
  }

  try {
    const { getStorage } = await import("@/lib/storage");
    const storage = getStorage();
    await withTimeout(storage.ensureBucket(), 8000, "storage health check");
    checks.storage = "ok";
    deps.push({
      name: "storage",
      status: "HEALTHY",
      requiredForReady: config.appEnv === "production" || config.appEnv === "staging",
    });
  } catch (error) {
    checks.storage = "degraded";
    checks.storageError =
      error instanceof Error
        ? error.message.includes("timed out")
          ? "timeout"
          : error.name
        : "error";
    const storageRequired = config.appEnv === "production" || config.appEnv === "staging";
    deps.push({
      name: "storage",
      status: storageRequired ? "UNAVAILABLE" : "DEGRADED",
      requiredForReady: storageRequired,
      detail: "storage_probe_failed",
    });
  }

  if (resolveRateLimitProvider() === "redis") {
    try {
      const redis = await pingRedis();
      checks.redis = redis.ok ? "ok" : "error";
      deps.push({
        name: "redis",
        status: redis.ok ? "HEALTHY" : "UNAVAILABLE",
        requiredForReady: true,
      });
    } catch {
      checks.redis = "error";
      deps.push({ name: "redis", status: "UNAVAILABLE", requiredForReady: true });
    }
  } else {
    checks.redis = "not_required";
    deps.push({
      name: "redis",
      status: "HEALTHY",
      requiredForReady: false,
      detail: "not_required",
    });
  }

  const malwareScanner = (process.env.MALWARE_SCANNER ?? "development").trim().toLowerCase();
  if (malwareScanner === "clamav") {
    try {
      const { probeClamAvConnectivity } = await import("@nyayagrid/documents");
      const probe = await withTimeout(
        probeClamAvConnectivity({
          host: process.env.CLAMAV_HOST,
          port: process.env.CLAMAV_PORT ? Number(process.env.CLAMAV_PORT) : undefined,
          timeoutMs: 2_500,
        }),
        3_000,
        "clamav health check",
      );
      checks.clamav = probe.ok ? "ok" : "error";
      checks.clamavMode = probe.mode;
      deps.push({
        name: "clamav",
        status: probe.ok ? "HEALTHY" : "UNAVAILABLE",
        requiredForReady: config.appEnv === "production" || config.appEnv === "staging",
        detail: probe.ok ? probe.mode : "unreachable",
      });
    } catch {
      checks.clamav = "error";
      deps.push({
        name: "clamav",
        status: "UNAVAILABLE",
        requiredForReady: config.appEnv === "production" || config.appEnv === "staging",
        detail: "probe_failed",
      });
    }
  } else {
    checks.clamav = malwareScanner === "development" ? "development" : "not_clamav";
    deps.push({
      name: "clamav",
      status: malwareScanner === "development" ? "DEGRADED" : "HEALTHY",
      requiredForReady: false,
      detail: checks.clamav as string,
    });
  }

  const ocrEnabled = ["1", "true", "yes", "on"].includes(
    (process.env.FEATURE_OCR ?? "").trim().toLowerCase(),
  );
  const ocrEndpoint = (process.env.OCR_ENDPOINT ?? "").trim();
  if (ocrEnabled && !ocrEndpoint) {
    checks.ocr = "misconfigured";
    deps.push({
      name: "ocr",
      status: "DEGRADED",
      requiredForReady: false,
      detail: "FEATURE_OCR without OCR_ENDPOINT",
    });
  } else if (ocrEnabled) {
    checks.ocr = "configured";
    deps.push({
      name: "ocr",
      status: "HEALTHY",
      requiredForReady: false,
      detail: "endpoint_configured_not_probed",
    });
  } else {
    checks.ocr = "disabled";
    deps.push({ name: "ocr", status: "HEALTHY", requiredForReady: false, detail: "disabled" });
  }

  const neonCorpus = ["1", "true", "yes", "on"].includes(
    (process.env.FEATURE_NEON_CORPUS_RESEARCH ?? "").trim().toLowerCase(),
  );
  checks.neonCorpusResearch = neonCorpus ? "enabled" : "off";
  if (neonCorpus && !(process.env.CORPUS_DATABASE_URL ?? "").trim()) {
    deps.push({
      name: "research_corpus",
      status: "UNAVAILABLE",
      requiredForReady: false,
      detail: "flag_on_without_corpus_url",
    });
  } else {
    deps.push({
      name: "research_corpus",
      status: neonCorpus ? "HEALTHY" : "HEALTHY",
      requiredForReady: false,
      detail: neonCorpus ? "enabled" : "flag_off",
    });
  }

  const ingestDisabled = ["1", "true", "yes", "on"].includes(
    (process.env.INNGEST_DISABLED ?? "").trim().toLowerCase(),
  );
  checks.ingest = ingestDisabled ? "disabled" : "configured";
  deps.push({
    name: "ingest",
    status: ingestDisabled ? "UNAVAILABLE" : "HEALTHY",
    requiredForReady:
      ingestDisabled && (config.appEnv === "production" || config.appEnv === "staging"),
    detail: checks.ingest as string,
  });

  checks.config = config.problems.length === 0 ? "ok" : "unsafe";
  checks.featureAgents = process.env.FEATURE_AGENTS ?? "unset";
  checks.providers = config.summary;
  if (config.problems.length > 0) {
    checks.configProblems = config.problems;
    deps.push({
      name: "config",
      status: "UNAVAILABLE",
      requiredForReady: config.appEnv === "production" || config.appEnv === "staging",
      detail: "config_problems",
    });
  } else {
    deps.push({ name: "config", status: "HEALTHY", requiredForReady: true });
  }
  if (config.warnings.length > 0) {
    checks.configWarnings = config.warnings;
  }

  const aggregated = aggregateOpsHealth(deps);
  checks.dependencies = deps.map((d) => ({
    name: d.name,
    status: d.status,
    detail: d.detail ?? null,
  }));
  checks.status = aggregated.status;

  if (!aggregated.ready) {
    return NextResponse.json({ ok: false, status: aggregated.status, checks }, { status: 503 });
  }
  return NextResponse.json({ ok: true, status: aggregated.status, checks });
}
