import { NextResponse } from "next/server";
import { sql } from "@nyayagrid/database";
import { withTimeout } from "@nyayagrid/observability";
import { pingRedis, resolveRateLimitProvider } from "@nyayagrid/platform";
import { getConfigBootstrapResult } from "@/lib/bootstrap";
import { getDb } from "@/lib/db";
import { publicDatabaseError } from "@/lib/health";

/**
 * Readiness: safe to serve beta traffic.
 * Liveness stays at /api/health/live and does not touch dependencies.
 * OpenAI is never probed here (cost/outage coupling).
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ready = true;
  const config = getConfigBootstrapResult();

  try {
    const db = getDb();
    await withTimeout(db.execute(sql`select 1`), 2000, "database health check");
    checks.database = "ok";
  } catch (error) {
    ready = false;
    checks.database = "error";
    checks.databaseError = publicDatabaseError(error, config.appEnv);
  }

  try {
    const { getStorage } = await import("@/lib/storage");
    const storage = getStorage();
    await withTimeout(storage.ensureBucket(), 8000, "storage health check");
    checks.storage = "ok";
  } catch (error) {
    checks.storage = "degraded";
    checks.storageError =
      error instanceof Error
        ? error.message.includes("timed out")
          ? "timeout"
          : error.name
        : "error";
    if (config.appEnv === "production" || config.appEnv === "staging") {
      ready = false;
    }
  }

  if (resolveRateLimitProvider() === "redis") {
    try {
      const redis = await pingRedis();
      checks.redis = redis.ok ? "ok" : "error";
      if (!redis.ok) ready = false;
    } catch {
      checks.redis = "error";
      ready = false;
    }
  } else {
    checks.redis = "not_required";
  }

  const ingestDisabled = ["1", "true", "yes", "on"].includes(
    (process.env.INNGEST_DISABLED ?? "").trim().toLowerCase(),
  );
  checks.ingest = ingestDisabled ? "disabled" : "configured";
  if (ingestDisabled && (config.appEnv === "production" || config.appEnv === "staging")) {
    ready = false;
  }

  checks.config = config.problems.length === 0 ? "ok" : "unsafe";
  checks.appEnv = config.appEnv;
  checks.featureAgents = process.env.FEATURE_AGENTS ?? "unset";
  checks.providers = config.summary;
  if (config.problems.length > 0) {
    checks.configProblems = config.problems;
    if (config.appEnv === "production" || config.appEnv === "staging") {
      ready = false;
    }
  }
  if (config.warnings.length > 0) {
    checks.configWarnings = config.warnings;
  }

  if (!ready) {
    return NextResponse.json({ ok: false, checks }, { status: 503 });
  }
  return NextResponse.json({ ok: true, checks });
}
