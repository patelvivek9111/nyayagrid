import { NextResponse } from "next/server";
import { sql } from "@nyayagrid/database";
import { validateConfig, withTimeout } from "@nyayagrid/observability";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/infra";

/**
 * Readiness probe. The database check is load-bearing: if it fails, we return 503 so the load
 * balancer stops routing traffic here. Storage and config are reported as soft/advisory checks —
 * a MinIO blip or a missing optional env var should not take a healthy app server out of rotation.
 * No check ever includes secret values, only variable names / boolean status.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let databaseOk = true;

  try {
    const db = getDb();
    await withTimeout(db.execute(sql`select 1`), 2000, "database health check");
    checks.database = "ok";
  } catch (error) {
    databaseOk = false;
    checks.database = "error";
    checks.databaseError = error instanceof Error ? error.message : "unknown error";
  }

  try {
    const storage = getStorage();
    await withTimeout(storage.ensureBucket(), 2000, "storage health check");
    checks.storage = "ok";
  } catch {
    checks.storage = "degraded";
  }

  const config = validateConfig();
  checks.config = config.ok ? "ok" : "warnings";
  if (config.warnings.length > 0) {
    checks.configWarnings = config.warnings;
  }

  if (!databaseOk) {
    return NextResponse.json({ ok: false, checks }, { status: 503 });
  }
  return NextResponse.json({ ok: true, checks });
}
