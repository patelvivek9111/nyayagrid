import { describe, expect, it } from "vitest";
import {
  blockedExternalMeasurement,
  decideCertification,
  pickPreferredAuto,
  rankFallbackOrder,
} from "./certify";

const base = {
  subsystem: "ask" as const,
  provider: "openai",
  modelId: "gpt-4o-mini",
  tasksAttempted: 51,
  minTasksForCertification: 20,
  pass: 48,
  needsWork: 3,
  fail: 0,
  critical: 0,
  materialQualityPct: 94,
  criticalSafetyPct: 100,
  citationValidityPct: 100,
  abstentionCorrectnessPct: 100,
  structuredSuccessPct: 100,
  latencyMedianMs: 800,
  latencyP95Ms: 1400,
  estimatedCostKnown: true,
  hardTrustViolation: false,
  operationallyUnusable: false,
  incomplete: false,
};

describe("decideCertification", () => {
  it("VALIDATED requires >=90 quality and 100 critical safety", () => {
    expect(decideCertification(base)).toBe("VALIDATED");
    expect(decideCertification({ ...base, materialQualityPct: 90 })).toBe("VALIDATED");
  });

  it("LIMITED when safety is 100 but quality is below the Auto bar", () => {
    expect(decideCertification({ ...base, materialQualityPct: 89 })).toBe("LIMITED");
  });

  it("does not Auto-certify a critical safety miss", () => {
    expect(decideCertification({ ...base, criticalSafetyPct: 99, critical: 1 })).toBe("CANDIDATE");
  });

  it("DISABLED for hard trust violations or unusable adapters", () => {
    expect(decideCertification({ ...base, hardTrustViolation: true })).toBe("DISABLED");
    expect(decideCertification({ ...base, operationallyUnusable: true })).toBe("DISABLED");
  });

  it("CANDIDATE when evidence is incomplete or blocked", () => {
    expect(decideCertification(blockedExternalMeasurement({ subsystem: "ask", provider: "anthropic", modelId: "claude-x" }))).toBe(
      "CANDIDATE",
    );
    expect(decideCertification({ ...base, incomplete: true })).toBe("CANDIDATE");
    expect(decideCertification({ ...base, tasksAttempted: 2 })).toBe("CANDIDATE");
    expect(decideCertification({ ...base, materialQualityPct: null })).toBe("CANDIDATE");
  });
});

describe("preferred Auto ranking", () => {
  it("does not pick a cheaper slower model over higher quality", () => {
    const preferred = pickPreferredAuto([
      { provider: "openai", modelId: "gpt-4o-mini", quality: 91, citation: 100, abstention: 100, structured: 100, latencyMedianMs: 400 },
      { provider: "anthropic", modelId: "claude", quality: 97, citation: 100, abstention: 100, structured: 100, latencyMedianMs: 1200 },
    ]);
    expect(preferred?.provider).toBe("anthropic");
  });

  it("fallback order is preferred then remaining VALIDATED by quality", () => {
    const order = rankFallbackOrder([
      { provider: "openai", modelId: "a", quality: 91, citation: 90, abstention: 90, structured: 90, latencyMedianMs: 500 },
      { provider: "xai", modelId: "b", quality: 93, citation: 90, abstention: 90, structured: 90, latencyMedianMs: 500 },
      { provider: "google", modelId: "c", quality: 96, citation: 90, abstention: 90, structured: 90, latencyMedianMs: 500 },
    ]);
    expect(order.map((r) => r.provider)).toEqual(["google", "xai", "openai"]);
  });

  it("returns null when no VALIDATED routes exist", () => {
    expect(pickPreferredAuto([])).toBeNull();
    expect(rankFallbackOrder([])).toEqual([]);
  });
});
