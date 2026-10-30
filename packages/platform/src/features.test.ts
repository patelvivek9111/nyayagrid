import { describe, expect, it } from "vitest";
import { getFeatureFlags, isFeatureEnabled } from "./features";

describe("FEATURE_PROFESSOR", () => {
  it("is a deployment switch and does not grant ownership", () => {
    expect(isFeatureEnabled("professor", { APP_ENV: "test" })).toBe(true);
    expect(isFeatureEnabled("professor", { APP_ENV: "production" })).toBe(false);
    expect(isFeatureEnabled("professor", { APP_ENV: "staging" })).toBe(false);
    expect(isFeatureEnabled("professor", { APP_ENV: "production", FEATURE_PROFESSOR: "1" })).toBe(
      true,
    );
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

describe("FEATURE_NYAYA_MODEL_ROUTER_V2", () => {
  it("defaults OFF in every environment", () => {
    expect(getFeatureFlags({ APP_ENV: "development" }).nyaya_model_router_v2).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "test" }).nyaya_model_router_v2).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "staging" }).nyaya_model_router_v2).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "production" }).nyaya_model_router_v2).toBe(false);
  });

  it("enables only when FEATURE_NYAYA_MODEL_ROUTER_V2 is explicitly set", () => {
    expect(
      isFeatureEnabled("nyaya_model_router_v2", {
        APP_ENV: "production",
        FEATURE_NYAYA_MODEL_ROUTER_V2: "1",
      }),
    ).toBe(true);
  });
});
