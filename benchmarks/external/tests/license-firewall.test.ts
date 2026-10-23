import { describe, expect, it } from "vitest";
import {
  assertCommercialEvalAllowed,
  loadLegalBenchTaskLicense,
  loadRagSourceLicense,
} from "../src/license/firewall.js";

describe("license firewall", () => {
  it("loads legalbench task license", () => {
    expect(loadLegalBenchTaskLicense("abercrombie::train::0")).toBe("COMMERCIAL_INTERNAL_EVAL_OK");
    expect(loadLegalBenchTaskLicense("learned_hands_family::train::0")).toBe(
      "INTERNAL_NONCOMMERCIAL_ONLY",
    );
  });

  it("loads rag source license", () => {
    expect(loadRagSourceLicense("cuad")).toBe("COMMERCIAL_INTERNAL_EVAL_OK");
    expect(loadRagSourceLicense("privacy_qa")).toBe(
      "RESEARCH_ONLY_NOT_FOR_PRODUCTION_SELECTION",
    );
  });

  it("fail-closed production-selection for NC tasks", () => {
    const result = assertCommercialEvalAllowed(
      { benchmarkId: "legalbench", taskId: "learned_hands_family::train::0" },
      "production-selection",
    );
    expect(result.allowed).toBe(false);
  });

  it("tags research-only in research mode", () => {
    const result = assertCommercialEvalAllowed(
      { benchmarkId: "legalbench-rag", taskId: "privacy_qa::1", metadata: { upstreamSource: "privacy_qa" } },
      "research",
    );
    expect(result.allowed).toBe(true);
    expect(result.tag).toBe("NOT_FOR_PRODUCTION_SELECTION");
  });
});
