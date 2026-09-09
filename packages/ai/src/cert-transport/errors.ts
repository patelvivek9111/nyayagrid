/** Normalized cert-transport errors. Never a secret or full prompt. */

export const CERT_ERROR_CLASSES = [
  "PROVIDER_HARD_TIMEOUT",
  "PROVIDER_REQUEST_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_5XX",
  "PROVIDER_AUTH",
  "PROVIDER_MODEL_UNAVAILABLE",
  "PROVIDER_QUOTA",
  "PROVIDER_TRANSPORT",
  "PROVIDER_MALFORMED_RESPONSE",
  "NOT_RUN_PROVIDER_UNSTABLE",
] as const;

export type CertErrorClass = (typeof CERT_ERROR_CLASSES)[number];

export type CertCallStatus =
  | "ok"
  | "PROVIDER_HARD_TIMEOUT"
  | "PROVIDER_REQUEST_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_5XX"
  | "PROVIDER_AUTH"
  | "PROVIDER_MODEL_UNAVAILABLE"
  | "PROVIDER_QUOTA"
  | "PROVIDER_TRANSPORT"
  | "PROVIDER_MALFORMED_RESPONSE";

export function isHardHangClass(errorClass: CertErrorClass | CertCallStatus): boolean {
  return errorClass === "PROVIDER_HARD_TIMEOUT";
}
