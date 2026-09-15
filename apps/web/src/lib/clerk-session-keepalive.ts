/** Clerk session JWTs are short-lived; refresh before the typical 60s expiry. */
export const CLERK_SESSION_KEEPALIVE_MS = 45_000;

export const CLERK_SESSION_KEEPALIVE_PATH = "/api/v1/session";

export type ClerkKeepAliveResult = "ok" | "handshake" | "signed-out";

export function interpretClerkKeepAliveResponse(params: {
  ok: boolean;
  errorCode?: string;
}): ClerkKeepAliveResult {
  if (params.ok) return "ok";
  if (params.errorCode === "CLERK_HANDSHAKE") return "handshake";
  return "signed-out";
}
