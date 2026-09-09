import type { CertErrorClass } from "./errors";

/** Parent-owned retry budget. Adapter retries are disabled in isolated cert children. */
export const CERT_RETRY_MAX: Record<CertErrorClass, number> = {
  PROVIDER_HARD_TIMEOUT: 1,
  PROVIDER_REQUEST_TIMEOUT: 1,
  PROVIDER_RATE_LIMIT: 2,
  PROVIDER_5XX: 2,
  PROVIDER_AUTH: 0,
  PROVIDER_MODEL_UNAVAILABLE: 0,
  PROVIDER_QUOTA: 0,
  PROVIDER_TRANSPORT: 1,
  PROVIDER_MALFORMED_RESPONSE: 1,
  NOT_RUN_PROVIDER_UNSTABLE: 0,
};

export function maxRetriesFor(errorClass: CertErrorClass): number {
  return CERT_RETRY_MAX[errorClass];
}

export function backoffMsFor(errorClass: CertErrorClass, attempt: number): number {
  if (errorClass === "PROVIDER_RATE_LIMIT") {
    return Math.min(250 * 2 ** Math.max(0, attempt), 2_000);
  }
  if (errorClass === "PROVIDER_5XX") {
    return Math.min(200 * 2 ** Math.max(0, attempt), 1_500);
  }
  return 0;
}
