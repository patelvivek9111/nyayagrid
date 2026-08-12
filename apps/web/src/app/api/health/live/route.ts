import { NextResponse } from "next/server";

/**
 * Liveness probe: answers "is the process up and able to serve HTTP" only. It deliberately does
 * not touch the database, storage, or any external dependency — that's what /api/health/ready is
 * for. A liveness failure should mean "restart the container", not "a downstream dependency blipped".
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
