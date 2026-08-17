import { describe, expect, it } from "vitest";
import { isFeatureEnabled } from "./features";

describe("FEATURE_PROFESSOR", () => {
  it("is a deployment switch and does not grant ownership", () => {
    expect(isFeatureEnabled("professor", { APP_ENV: "test" })).toBe(true);
    expect(isFeatureEnabled("professor", { APP_ENV: "production" })).toBe(false);
    expect(
      isFeatureEnabled("professor", { APP_ENV: "production", FEATURE_PROFESSOR: "1" }),
    ).toBe(true);
  });
});
