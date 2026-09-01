import { isFeatureEnabled, type FeatureFlag } from "@nyayagrid/platform";
import { requireUser } from "./auth";

export class FeatureDisabledError extends Error {
  readonly code = "FEATURE_DISABLED";
  readonly flag: FeatureFlag;

  constructor(flag: FeatureFlag) {
    super(`${flag} is not enabled on this deployment`);
    this.name = "FeatureDisabledError";
    this.flag = flag;
  }
}

export function assertFeatureEnabled(flag: FeatureFlag): void {
  if (!isFeatureEnabled(flag)) {
    throw new FeatureDisabledError(flag);
  }
}

export async function requireGuideUser(headers: Headers) {
  assertFeatureEnabled("guide");
  return requireUser(headers);
}

export async function requireProfessorUser(headers: Headers) {
  assertFeatureEnabled("professor");
  return requireUser(headers);
}
