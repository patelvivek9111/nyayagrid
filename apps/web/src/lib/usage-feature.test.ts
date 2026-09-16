import { describe, expect, it } from "vitest";
import { featureFromRouterSubsystem } from "./usage-feature";

describe("featureFromRouterSubsystem", () => {
  it("maps customer-facing subsystems without treating analysis as Ask", () => {
    expect(featureFromRouterSubsystem("ask")).toBe("nyaya.ask");
    expect(featureFromRouterSubsystem("research")).toBe("research.query");
    expect(featureFromRouterSubsystem("draft")).toBe("draft.generate");
    expect(featureFromRouterSubsystem("compare")).toBe("analysis.compare");
    expect(featureFromRouterSubsystem("contract")).toBe("extraction.analysis");
    expect(featureFromRouterSubsystem("timeline")).toBe("document.processing");
    expect(featureFromRouterSubsystem("guide")).toBe("guide.ask");
  });
});
