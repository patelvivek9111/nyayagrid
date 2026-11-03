import { describe, expect, it } from "vitest";
import { getFeatureFlags, isFeatureEnabled } from "./features";

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
  it("defaults ON in every environment (WP-02 product default)", () => {
    expect(getFeatureFlags({ APP_ENV: "development" }).nyaya_model_router_v2).toBe(true);
    expect(getFeatureFlags({ APP_ENV: "test" }).nyaya_model_router_v2).toBe(true);
    expect(getFeatureFlags({ APP_ENV: "staging" }).nyaya_model_router_v2).toBe(true);
    expect(getFeatureFlags({ APP_ENV: "production" }).nyaya_model_router_v2).toBe(true);
  });

  it("can be explicitly disabled with FEATURE_NYAYA_MODEL_ROUTER_V2=0", () => {
    expect(
      isFeatureEnabled("nyaya_model_router_v2", {
        APP_ENV: "production",
        FEATURE_NYAYA_MODEL_ROUTER_V2: "0",
      }),
    ).toBe(false);
  });
});

describe("FEATURE_NEON_CORPUS_RESEARCH", () => {
  it("defaults OFF in every environment until staging certification", () => {
    expect(getFeatureFlags({ APP_ENV: "development" }).neon_corpus_research).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "test" }).neon_corpus_research).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "staging" }).neon_corpus_research).toBe(false);
    expect(getFeatureFlags({ APP_ENV: "production" }).neon_corpus_research).toBe(false);
  });

  it("can be enabled explicitly", () => {
    expect(
      isFeatureEnabled("neon_corpus_research", {
        APP_ENV: "staging",
        FEATURE_NEON_CORPUS_RESEARCH: "1",
      }),
    ).toBe(true);
  });
});

describe("retired Professor/Guide flags", () => {
  it("are no longer feature flags", () => {
    const flags = getFeatureFlags({ APP_ENV: "test" });
    expect("professor" in flags).toBe(false);
    expect("guide" in flags).toBe(false);
  });
});
