import { NextResponse } from "next/server";
import { sql } from "@nyayagrid/database";
import { withTimeout } from "@nyayagrid/observability";
import { getConfigBootstrapResult } from "@/lib/bootstrap";
import { getDb } from "@/lib/db";
import { publicDatabaseError } from "@/lib/health";
import { getStorage } from "@/lib/infra";

/**
 * Readiness probe. The database check is load-bearing: if it fails, we return 503 so the load
 * balancer stops routing traffic here. Storage and config are reported as soft/advisory checks.
 * No check ever includes secret values — only provider names, booleans, and a sanitized status.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let databaseOk = true;
  const config = getConfigBootstrapResult();

  try {
    const db = getDb();
    await withTimeout(db.execute(sql`select 1`), 2000, "database health check");
    checks.database = "ok";
  } catch (error) {
    databaseOk = false;
    checks.database = "error";
    checks.databaseError = publicDatabaseError(error, config.appEnv);
  }

  try {
    const storage = getStorage();
    await withTimeout(storage.ensureBucket(), 2000, "storage health check");
    checks.storage = "ok";
  } catch {
    checks.storage = "degraded";
  }

  checks.config = config.problems.length === 0 ? "ok" : "warnings";
  checks.appEnv = config.appEnv;
  checks.providers = config.summary;
  if (config.problems.length > 0) {
    checks.configProblems = config.problems;
  }
  if (config.warnings.length > 0) {
    checks.configWarnings = config.warnings;
  }

  if (!databaseOk) {
    return NextResponse.json({ ok: false, checks }, { status: 503 });
  }
  return NextResponse.json({ ok: true, checks });
}
