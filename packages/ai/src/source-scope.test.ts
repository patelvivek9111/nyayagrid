import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSourceScopeInvariants,
  buildProvenanceSummary,
  resolveSourceScopeFlags,
  SourceScopeViolationError,
  type SourceScope,
} from "./source-scope";

describe("source scope invariants", () => {
  it("CASE => webEnabled=false", () => {
    const flags = resolveSourceScopeFlags("case");
    expect(flags.webEnabled).toBe(false);
    expect(flags.generalWebEnabled).toBe(false);
    expect(flags.caseRetrievalEnabled).toBe(true);
    expect(flags.legalCorpusEnabled).toBe(false);
    expect(() => assertSourceScopeInvariants(flags)).not.toThrow();
  });

  it("LEGAL RESEARCH => generalWebEnabled=false", () => {
    const flags = resolveSourceScopeFlags("legal_research");
    expect(flags.generalWebEnabled).toBe(false);
    expect(flags.webEnabled).toBe(false);
    expect(flags.legalCorpusEnabled).toBe(true);
    expect(flags.caseRetrievalEnabled).toBe(false);
    expect(() => assertSourceScopeInvariants(flags)).not.toThrow();
  });

  it("WEB => webEnabled=true only for web scope", () => {
    const flags = resolveSourceScopeFlags("web");
    expect(flags.webEnabled).toBe(true);
    expect(flags.caseRetrievalEnabled).toBe(false);
    expect(flags.legalCorpusEnabled).toBe(false);
    expect(() => assertSourceScopeInvariants(flags)).not.toThrow();
  });

  it("CASE + LEGAL keeps web off", () => {
    const flags = resolveSourceScopeFlags("case_plus_legal");
    expect(flags.webEnabled).toBe(false);
    expect(flags.caseRetrievalEnabled).toBe(true);
    expect(flags.legalCorpusEnabled).toBe(true);
    expect(() => assertSourceScopeInvariants(flags)).not.toThrow();
  });

  it("refuses CASE silently broadened to web", () => {
    expect(() =>
      assertSourceScopeInvariants({
        sourceScope: "case",
        webEnabled: true,
        generalWebEnabled: true,
        caseRetrievalEnabled: true,
        legalCorpusEnabled: false,
      }),
    ).toThrow(SourceScopeViolationError);
  });

  it("refuses CASE silently loading legal corpus", () => {
    expect(() =>
      assertSourceScopeInvariants({
        ...resolveSourceScopeFlags("case"),
        legalCorpusEnabled: true,
      }),
    ).toThrow(SourceScopeViolationError);
  });

  it.each(["case", "legal_research", "web", "case_plus_legal"] as SourceScope[])(
    "provenance labels are honest for %s",
    (scope) => {
      const summary = buildProvenanceSummary({
        sourceScope: scope,
        caseSourceCount: 4,
        authoritySourceCount: 7,
        webSourceCount: 6,
        unresolvedConflictCount: 1,
        webRetrievedAt: "2026-09-16T12:00:00.000Z",
      });
      expect(summary.headline.length).toBeGreaterThan(3);
      if (scope === "case") {
        expect(summary.detail).toMatch(/No external web sources/i);
        expect(summary.detail).not.toMatch(/6 external/i);
      }
      if (scope === "legal_research") {
        expect(summary.detail).toMatch(/No general web sources/i);
      }
      if (scope === "web") {
        expect(summary.detail).toMatch(/external source/i);
        expect(summary.detail).toMatch(/Retrieved/i);
      }
      if (scope === "case_plus_legal") {
        expect(summary.detail).toMatch(/case source/i);
        expect(summary.detail).toMatch(/authorit/i);
        expect(summary.detail).toMatch(/No external web sources/i);
      }
    },
  );

  it("question fingerprint is stable for continue reuse", () => {
    const q = "What is the notice period?";
    const a = createHash("sha256").update(q).digest("hex").slice(0, 24);
    const b = createHash("sha256").update(q).digest("hex").slice(0, 24);
    expect(a).toBe(b);
  });
});
