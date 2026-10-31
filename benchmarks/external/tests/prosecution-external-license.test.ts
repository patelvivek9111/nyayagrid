import { describe, expect, it } from "vitest";
import {
  classifyExternalBenchmarkLicense,
  assertExternalDatasetMountAllowed,
  resetProsecutionExternalLicenseCacheForTests,
} from "../src/prosecution-external/license-gate.js";
import { assertCommercialEvalAllowed } from "../src/license/firewall.js";

describe("prosecution external license gate", () => {
  it("classifies four sources without unclear blockers", () => {
    resetProsecutionExternalLicenseCacheForTests();
    expect(classifyExternalBenchmarkLicense("legalbench").classification).toBe(
      "PERMITTED_WITH_ATTRIBUTION",
    );
    expect(classifyExternalBenchmarkLicense("legalcitebench").classification).toBe("PERMITTED");
    expect(classifyExternalBenchmarkLicense("casefacts").classification).toBe("RESEARCH_ONLY");
    expect(classifyExternalBenchmarkLicense("legal-rag-bench").classification).toBe(
      "RESEARCH_ONLY",
    );
    expect(classifyExternalBenchmarkLicense("legal-rag-bench").mayCommitDatasetContents).toBe(
      false,
    );
  });

  it("blocks research-only datasets from production-selection", () => {
    expect(assertExternalDatasetMountAllowed("casefacts", "production-selection").allowed).toBe(
      false,
    );
    expect(assertExternalDatasetMountAllowed("casefacts", "research").allowed).toBe(true);
  });

  it("firewall marks CaseFacts/LegalRAG research-only and LegalCite permitted", () => {
    expect(
      assertCommercialEvalAllowed(
        { benchmarkId: "legalcitebench", taskId: "x" },
        "production-selection",
      ).allowed,
    ).toBe(true);
    expect(
      assertCommercialEvalAllowed({ benchmarkId: "casefacts", taskId: "x" }, "production-selection")
        .allowed,
    ).toBe(false);
    expect(
      assertCommercialEvalAllowed({ benchmarkId: "legal-rag-bench", taskId: "x" }, "research").tag,
    ).toBe("NOT_FOR_PRODUCTION_SELECTION");
  });
});
