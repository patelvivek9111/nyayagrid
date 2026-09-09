/**
 * Certification timeout layers. Not hardcoded at call sites.
 *
 * A = logical timeout (stop waiting for a result)
 * B = request abort (cancel HTTP)
 * C = hard execution termination (kill process tree)
 */

export type CertTimeoutConfig = {
  requestTimeoutMs: number;
  hardWatchdogMs: number;
  terminationWaitMs: number;
  maxBodyBytes: number;
};

const MIN_REQUEST_MS = 50;
const MIN_WATCHDOG_GAP_MS = 20;

export function resolveCertTimeoutConfig(
  env: Record<string, string | undefined> = process.env,
): CertTimeoutConfig {
  const requestTimeoutMs = readMs(env.CERT_REQUEST_TIMEOUT_MS, 45_000);
  const hardWatchdogMs = Math.max(
    requestTimeoutMs + MIN_WATCHDOG_GAP_MS,
    readMs(env.CERT_HARD_WATCHDOG_MS, 60_000),
  );
  return {
    requestTimeoutMs,
    hardWatchdogMs,
    terminationWaitMs: readMs(env.CERT_TERMINATION_WAIT_MS, 5_000),
    maxBodyBytes: readInt(env.CERT_MAX_BODY_BYTES, 2_000_000),
  };
}

function readMs(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_REQUEST_MS) return fallback;
  return Math.floor(n);
}

function readInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
