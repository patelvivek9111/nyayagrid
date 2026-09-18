import { describe, expect, it } from "vitest";
import {
  US_PRIMARY_CORPUS_PROVIDER,
  isRealPrimarySourceProvider,
  isSyntheticBenchSource,
} from "./source-classes";
import { redactDatabaseUrl, summarizeCorpusCoverage } from "./db-identity";
import { defaultQualityTierForSourceClass } from "./quality-tier";
import { enrichCorpusAuthority } from "./provenance";
import { syntheticCaseAuthority, SYNTHETIC_SOURCE_PROVIDER } from "../fixtures";
import { loadCorpusManifest, UCC_2725_BODY, loadInitialBatchAuthorities } from "./bundles";
import { buildBundleCoverageMatrix, buildFiftyStateRoadmap } from "./coverage-matrix";
import { classifyJurisdictionCoverage } from "./inventory";

describe("corpus source classes", () => {
  it("separates synthetic fixtures from real primary corpus", () => {
    expect(isSyntheticBenchSource(SYNTHETIC_SOURCE_PROVIDER, { synthetic: true })).toBe(true);
    expect(isSyntheticBenchSource(US_PRIMARY_CORPUS_PROVIDER, { synthetic: false })).toBe(false);
    expect(isRealPrimarySourceProvider(US_PRIMARY_CORPUS_PROVIDER)).toBe(true);
    expect(isRealPrimarySourceProvider(SYNTHETIC_SOURCE_PROVIDER)).toBe(false);
  });

  it("redacts database credentials and counts only us-primary-corpus as real coverage", () => {
    const redacted = redactDatabaseUrl("postgresql://nyayagrid:s3cret@localhost:5433/nyayagrid");
    expect(redacted).toEqual({
      protocol: "postgresql",
      host: "localhost",
      port: "5433",
      database: "nyayagrid",
      hasUser: true,
      hasPassword: true,
    });
    expect(JSON.stringify(redacted)).not.toContain("s3cret");

    const summary = summarizeCorpusCoverage([
      {
        sourceProvider: US_PRIMARY_CORPUS_PROVIDER,
        authorityType: "statute",
        authorityState: "PA",
        courtId: null,
      },
      {
        sourceProvider: US_PRIMARY_CORPUS_PROVIDER,
        authorityType: "case",
        authorityState: "PA",
        courtId: "st-pa-high",
      },
      {
        sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
        authorityType: "statute",
        authorityState: null,
        courtId: null,
        metadata: { synthetic: true },
      },
      {
        sourceProvider: "nyaya-bench-research-overlay",
        authorityType: "case",
        authorityState: null,
        courtId: null,
        metadata: { synthetic: true },
      },
    ]);
    expect(summary.realPrimaryAuthorities).toBe(2);
    expect(summary.syntheticAuthorities).toBe(2);
    expect(summary.realStatuteCount).toBe(1);
    expect(summary.realCaseCount).toBe(1);
    expect(summary.realStatesWithAuthorities).toEqual(["PA"]);
  });

  it("assigns deterministic quality tiers", () => {
    expect(defaultQualityTierForSourceClass("PRIMARY_OFFICIAL")).toBe("TIER_1_OFFICIAL");
    expect(defaultQualityTierForSourceClass("PRIMARY_PUBLIC_REPOSITORY")).toBe(
      "TIER_2_TRUSTED_PUBLIC",
    );
    expect(defaultQualityTierForSourceClass("SYNTHETIC_BENCH")).toBe("TIER_3_REFERENCE_ONLY");
  });

  it("enriches provenance without inferring effective dates", () => {
    const enriched = enrichCorpusAuthority(syntheticCaseAuthority, {
      sourceClass: "PRIMARY_OFFICIAL",
      importedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(enriched.metadata.sourceClass).toBe("PRIMARY_OFFICIAL");
    expect(enriched.metadata.qualityTier).toBe("TIER_1_OFFICIAL");
    expect(enriched.sourceMetadata.parserVersion).toBe("corpus1-v1");
    expect(enriched.sourceMetadata.importedAt).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe("corpus bundles", () => {
  it("loads expansion manifest covering wave1 + wave2 state bundles", async () => {
    const manifest = await loadCorpusManifest();
    expect([
      "50S-EXPANSION-1",
      "50S-WAVE-2E",
      "50S-WAVE-2F",
      "50S-WAVE-2G",
      "50S-WAVE-2H",
      "50S-WAVE-2I",
    ]).toContain(manifest.phase);
    expect(manifest.states.length).toBeGreaterThanOrEqual(20);
    const codes = manifest.states.map((s) => s.code);
    for (const code of ["CA", "DE", "FL", "IL", "MA", "NJ", "NY", "PA", "TX", "VA", "OH", "GA"]) {
      expect(codes).toContain(code);
    }
  });

  it("includes uniform UCC 2-725 body text", () => {
    expect(UCC_2725_BODY).toContain("4 years after the cause of action has accrued");
  });

  it("loads expanded federal + multi-state authorities and builds coverage matrix", async () => {
    const { authorities, manifest } = await loadInitialBatchAuthorities();
    expect(manifest.federalBundles?.length).toBeGreaterThan(1);
    expect(authorities.length).toBeGreaterThanOrEqual(100);
    expect(authorities.some((a) => a.citation === "28 U.S.C. § 1331")).toBe(true);
    expect(authorities.some((a) => a.citation === "42 Pa.C.S. § 5525")).toBe(true);
    expect(authorities.some((a) => a.authorityType === "regulation")).toBe(true);
    expect(authorities.some((a) => a.authorityType === "rule")).toBe(true);
    expect(authorities.some((a) => a.courtLevel === "scotus")).toBe(true);
    expect(authorities.some((a) => a.courtLevel === "state_appellate")).toBe(true);

    const juris = new Set(authorities.map((a) => (a.authorityState ?? "").toUpperCase()).filter(Boolean));
    expect(juris.has("US")).toBe(true);
    expect(juris.size).toBe(52);

    const matrix = await buildBundleCoverageMatrix();
    expect(matrix.bundleAuthorityCount).toBe(authorities.length);
    expect(matrix.federal.regulationsPresent).toBe(true);
    expect(matrix.federal.courtRulesPresent).toBe(true);
    expect(matrix.summary.statesWithCorpus).toBe(51);
    expect(matrix.summary.statesNoCorpus).toBe(0);
    expect(matrix.honestClaims.length).toBeGreaterThan(0);
    expect(matrix.honestClaims.some((c) => /not exhaustive/i.test(c))).toBe(true);

    const pa = matrix.states.find((s) => s.jurisdiction === "PA");
    expect(pa?.statutesPresent).toBe(true);
    expect(pa?.highCourtCasesPresent).toBe(true);
    expect(pa?.coverageClass).toMatch(/seed_corpus|limited_corpus/);

    const roadmap = buildFiftyStateRoadmap(matrix);
    expect(roadmap.waves[0]?.id).toBe("wave1");
    expect(roadmap.waves[0]?.jurisdictions).toContain("US");
    expect(roadmap.waves[0]?.jurisdictions).toContain("PA");
    expect(classifyJurisdictionCoverage({ authorityCount: 0, statuteCount: 0, caseCount: 0, regulationCount: 0 })).toBe(
      "no_corpus",
    );
  });
});
