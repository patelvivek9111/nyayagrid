import { getAppEnv } from "@nyayagrid/platform";

/**
 * Ready-probe errors must never include connection strings, passwords, or host credentials.
 * Development keeps a redacted driver message so operators can debug locally.
 */
export function publicDatabaseError(error: unknown, appEnv = getAppEnv()): string {
  if (appEnv !== "development" && appEnv !== "test") {
    return "unreachable";
  }
  const raw = error instanceof Error ? error.message : "unknown error";
  return raw.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[redacted]");
}
