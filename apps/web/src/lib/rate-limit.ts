/**
 * Phase 9 — rate-limit enforcement at the API boundary.
 *
 * Thin wrapper over `@nyayagrid/platform`'s rate limiter: resolves the caller's identity
 * (user/organization/IP, per the endpoint class's scope), checks the process-wide limiter
 * (`memory` or `redis`), and — when exceeded — returns a ready-to-return 429 response with
 * `Retry-After` set. A route enforces a limit by checking the return value, never by catching a
 * thrown error, so a route cannot accidentally let a request through by forgetting a try/catch
 * around this call.
 */
import { NextResponse } from "next/server";
import {
  checkEndpointRateLimit,
  getRateLimiter,
  type EndpointClass,
  type RateLimitDecision,
} from "@nyayagrid/platform";

export type RateLimitSubject = {
  endpointClass: EndpointClass;
  userId?: string | null;
  organizationId?: string | null;
  /** Overrides the IP derived from request headers; mainly for tests. */
  ip?: string | null;
};

function clientIpFromHeaders(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

export function rateLimitResponse(decision: RateLimitDecision): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil((decision.retryAfterMs ?? 0) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please slow down and try again shortly.",
        details: { limit: decision.limit, retryAfterMs: decision.retryAfterMs ?? 0 },
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

/**
 * Returns a 429 `Response` when `subject` has exceeded its limit for `subject.endpointClass`, or
 * `null` when the request may proceed. Call this after authentication (so `userId`/`organizationId`
 * are known) and before doing the expensive or abuse-prone work the class protects.
 */
export async function enforceRateLimit(
  request: Request,
  subject: RateLimitSubject,
): Promise<Response | null> {
  const decision = await checkEndpointRateLimit(getRateLimiter(), {
    endpointClass: subject.endpointClass,
    userId: subject.userId ?? null,
    organizationId: subject.organizationId ?? null,
    ip: subject.ip ?? clientIpFromHeaders(request),
  });
  if (decision.allowed) return null;
  return rateLimitResponse(decision);
}
