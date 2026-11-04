import { NextResponse } from "next/server";
import { resolveBuildIdentity } from "@nyayagrid/observability";

/**
 * Liveness probe: answers "is the process up and able to serve HTTP" only. It deliberately does
 * not touch the database, storage, or any external dependency — that's what /api/health/ready is
 * for. A liveness failure should mean "restart the container", not "a downstream dependency blipped".
 *
 * Includes build identity when GIT_SHA / GITHUB_SHA is injected at deploy time (never invents one).
 */
export async function GET() {
  const identity = resolveBuildIdentity();
  return NextResponse.json({
    ok: true,
    status: "HEALTHY",
    gitSha: identity.gitSha,
    buildId: identity.buildId,
    appEnv: identity.appEnv,
  });
}
