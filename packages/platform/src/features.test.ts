import { describe, expect, it } from "vitest";
import { getFeatureFlags, isFeatureEnabled } from "./features";

describe("FEATURE_PROFESSOR", () => {
  it("is a deployment switch and does not grant ownership", () => {
    expect(isFeatureEnabled("professor", { APP_ENV: "test" })).toBe(true);
    expect(isFeatureEnabled("professor", { APP_ENV: "production" })).toBe(false);
    expect(isFeatureEnabled("professor", { APP_ENV: "staging" })).toBe(false);
    expect(
      isFeatureEnabled("professor", { APP_ENV: "production", FEATURE_PROFESSOR: "1" }),
    ).toBe(true);
  });
});

describe("FEATURE_AGENTS", () => {
  it("stays off in staging and production unless explicitly enabled", () => {
    expect(getFeatureFlags({ APP_ENV: "staging" }).agents).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "production" }).agents).toBe(false);
    expect(isFeatureEnabled("agents", { APP_ENV: "staging" })).toBe(false);
    expect(isFeatureEnabled("agents", { APP_ENV: "production" })).toBe(false);
    expect(isFeatureEnabled("agents", { APP_ENV: "production", FEATURE_AGENTS: "1" })).toBe(true);
  });
});
