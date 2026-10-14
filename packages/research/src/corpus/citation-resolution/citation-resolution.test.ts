import { describe, expect, it } from "vitest";
import { planGlobalBackfill, selectDemandFullTextTargets } from "./backfill";
import {
  CL_LOOKUP_TEXTS_PER_REQUEST,
  dedupeLookupTexts,
  emptyCheckpoint,
  parseCitationLookupResponse,
  runIdentityBatch,
  simulateLookupFromFixture,
} from "./cl-identity-client";
import { createResolutionRecord, supersedeRecord } from "./ledger";
import { LocalAuthorityIndex } from "./local-index";
import { dryRunLocalHighResolver, planBackfillFromProposals } from "./local-resolver";
import {
  computeCitationIdentityAccounting,
  metricsForNewCaseBatch,
} from "./metrics";
import {
  classifyCaseCitationLookupEligibility,
  classifyDemandLanePolicy,
  isCaseCitationLookupEligible,
  isStrategicIdentityException,
} from "./eligibility";
import {
  filterCaseIdentityQueueByClassification,
  isCaseIdentityEligible,
  isCitationArtifactClassification,
  isTrueCaseIdentityClassification,
  isUnknownClassification,
} from "./classification";
import {
  citationLookupAliases,
  deterministicCitationVariants,
  experimentalNormalize,
  isLookupSuitableCitation,
  isUnsafeOcrTransform,
  scrubCitationUnicode,
  targetKey,
} from "./normalize";
import { filterExternalIdentityQueueTargets, resolveNewCitationsLocalFirst } from "./pipeline";
import { buildUnresolvedTargetQueue, chunkTargetsForBatch, scoreUnresolvedTarget } from "./target-queue";
import { authorityCorpusState, type AuthorityIndexRow, type UnresolvedEdgeRow } from "./types";

const authority = (partial: Partial<AuthorityIndexRow> & { id: string }): AuthorityIndexRow => ({
  citation: null,
  normalizedCitation: null,
  metadata: {},
  ...partial,
});

describe("citation-resolution normalize", () => {
  it("collapses reporter variants to one target key", () => {
    const a = targetKey("410 U.S. 113", "410 U.S. 113");
    const b = targetKey("410 U. S. 113", null);
    const c = targetKey("410 US 113", null);
    expect(a).toBe(b);
    expect(experimentalNormalize("F.Supp..2d")).toContain("F.Supp");
    expect(citationLookupAliases("42 U.S.C. § 1983")).toContain("42 USC § 1983");
    expect(c).toBe(a);
  });

  it("supports historical/regional reporter punctuation and spacing variants", () => {
    expect(experimentalNormalize("123 P. 2d 456")).toBe("123 P.2d 456");
    expect(experimentalNormalize("10 F4th 20")).toBe("10 F.4th 20");
    expect(deterministicCitationVariants("55 So.2d 99")).toContain("55 So.2d 99");
    expect(deterministicCitationVariants("55 So 2d 99").some((v) => /So\.2d/i.test(v))).toBe(true);
    expect(citationLookupAliases("100 A.2d 1")).toContain("100 A.2d 1");
  });

  it("scrubs unicode punctuation safely and rejects unsafe OCR transforms", () => {
    expect(scrubCitationUnicode("410\u00A0U.S.\u2013113")).toContain("410 U.S.-113");
    expect(isUnsafeOcrTransform("410 U.S. 113", "411 U.S. 113")).toBe(true);
    expect(isUnsafeOcrTransform("100 F. 50", "100 F.2d 50")).toBe(true);
    expect(isUnsafeOcrTransform("100 F.2d 50", "100 F.2d 50")).toBe(false);
    expect(isUnsafeOcrTransform("100 F 2d 50", "100 F.2d 50")).toBe(false);
  });

  it("resolves unique normalized alias and refuses ambiguous normalized matches", () => {
    const index = new LocalAuthorityIndex([
      authority({
        id: "a1",
        citation: "123 P.2d 456",
        normalizedCitation: "123 P.2d 456",
        metadata: { citationAliases: ["123 P 2d 456"] },
      }),
      authority({
        id: "a2",
        citation: "999 A.2d 1",
        normalizedCitation: "999 A.2d 1",
      }),
      authority({
        id: "a3",
        citation: "999 A.2d 1",
        normalizedCitation: "999 A.2d 1 (alt)",
        metadata: { citationAliases: ["999 A.2d 1"] },
      }),
    ]);
    const unique = index.lookupCitation("123 P 2d 456", null);
    expect(unique.kind).toBe("one");
    if (unique.kind === "one") expect(unique.authorityId).toBe("a1");
    const amb = index.lookupCitation("999 A.2d 1", null);
    expect(amb.kind).toBe("ambiguous");
  });
});

describe("CourtListener identity parse + queue gates", () => {
  it("accepts unique HIGH identity and refuses ambiguous / empty results", () => {
    const high = parseCitationLookupResponse([
      {
        status: 200,
        normalized_citations: ["573 U.S. 373"],
        clusters: [{ id: 2812209, citations: ["573 U.S. 373"], case_name: "Example" }],
      },
    ]);
    expect(high.status).toBe("resolved");
    if (high.status === "resolved") expect(high.clusterId).toBe("2812209");

    const amb = parseCitationLookupResponse([
      {
        status: 200,
        clusters: [
          { id: 1, citations: ["1 F.3d 1"] },
          { id: 2, citations: ["1 F.3d 1"] },
        ],
      },
    ]);
    expect(amb.status).toBe("ambiguous");

    const nf = parseCitationLookupResponse([]);
    expect(nf.status).toBe("not_found");
  });

  it("formats cluster citation objects into strings (no [object Object])", () => {
    const high = parseCitationLookupResponse([
      {
        status: 200,
        normalized_citations: ["410 U.S. 113"],
        clusters: [
          {
            id: 108713,
            case_name: "Roe v. Wade",
            citations: [{ volume: "410", reporter: "U.S.", page: "113", type: 1 }],
          },
        ],
      },
    ]);
    expect(high.status).toBe("resolved");
    if (high.status === "resolved") {
      expect(high.citations).toContain("410 U.S. 113");
      expect(high.citations?.some((c) => c.includes("[object Object]"))).toBe(false);
    }
  });

  it("excludes ineligible targets from external identity queue", () => {
    const filtered = filterExternalIdentityQueueTargets([
      { representativeRaw: "573 U.S. 373", normalizedCitation: "573 U.S. 373" },
      { representativeRaw: "2026 Page 2", normalizedCitation: "2026 Page 2" },
      { representativeRaw: "42 U.S.C. § 1983", normalizedCitation: "42 U.S.C. § 1983" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.normalizedCitation).toBe("573 U.S. 373");
  });
});

describe("CASE_CITATION_LOOKUP_ELIGIBLE gate", () => {
  it("accepts valid federal, state, parallel, and neutral citations", () => {
    expect(isCaseCitationLookupEligible("410 U.S. 113")).toBe(true);
    expect(isCaseCitationLookupEligible("503 F.3d 284")).toBe(true);
    expect(isCaseCitationLookupEligible("106 S. Ct. 2505")).toBe(true);
    expect(isCaseCitationLookupEligible("163 Idaho 856")).toBe(true);
    expect(isCaseCitationLookupEligible("149 N.H. 31")).toBe(true);
    expect(isCaseCitationLookupEligible("16 Wall. 36")).toBe(true);
    expect(isCaseCitationLookupEligible("2026 ND 26")).toBe(true);
    expect(isLookupSuitableCitation("410 U.S. 113")).toBe(true);
  });

  it("rejects YYYY Page N, bare page, statute, regulation, rule, secondary, pin, malformed", () => {
    expect(classifyCaseCitationLookupEligibility("2026 Page 2").lane).toBe("MALFORMED_CASE_REFERENCE");
    expect(classifyCaseCitationLookupEligibility("2025 Page 7").eligible).toBe(false);
    expect(classifyCaseCitationLookupEligibility("at 123").lane).toBe("PIN_CITE_ONLY");
    expect(classifyCaseCitationLookupEligibility("42 U.S.C. § 1983").lane).toBe("STATUTE_RULE_REGULATION");
    expect(classifyCaseCitationLookupEligibility("42 C.F.R. § 100.1").lane).toBe("STATUTE_RULE_REGULATION");
    expect(classifyCaseCitationLookupEligibility("Fed. R. Civ. P. 12").lane).toBe("STATUTE_RULE_REGULATION");
    expect(classifyCaseCitationLookupEligibility("Am. Jur. 2d Contracts § 1").lane).toBe("NON_CASE_REFERENCE");
    expect(classifyCaseCitationLookupEligibility("ECF No. 12").lane).toBe("NON_CASE_REFERENCE");
    expect(classifyCaseCitationLookupEligibility("999 Zzzz 1").lane).toBe("UNKNOWN_REVIEW");
    expect(isLookupSuitableCitation("2026 Page 2")).toBe(false);
  });

  it("does not over-filter valid >=5 demand targets and allows strategic 1–2 exceptions", () => {
    const edges: UnresolvedEdgeRow[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `e${i}`,
        fromAuthorityId: `c${i}`,
        rawCitation: "410 U.S. 113",
        normalizedCitation: "410 U.S. 113",
        fromCourtId: "us-ca-3",
      })),
      {
        id: "s1",
        fromAuthorityId: "c9",
        rawCitation: "1 F.3d 1",
        normalizedCitation: "1 F.3d 1",
        fromCourtId: "us-ca-3",
      },
      {
        id: "bad",
        fromAuthorityId: "c8",
        rawCitation: "2026 Page 2",
        normalizedCitation: "2026 Page 2",
        fromCourtId: "st-in-high",
      },
    ];
    const q = buildUnresolvedTargetQueue(edges, new LocalAuthorityIndex([]));
    const eligible = filterExternalIdentityQueueTargets(q.targets);
    expect(eligible.some((t) => t.targetKey.includes("410"))).toBe(true);
    expect(eligible.some((t) => /page/i.test(t.normalizedCitation))).toBe(false);
    const pageTarget = q.targets.find((t) => /page/i.test(t.normalizedCitation));
    expect(pageTarget?.eligibilityLane).toBe("MALFORMED_CASE_REFERENCE");
    expect(pageTarget?.lookupSuitable).toBe(false);

    expect(
      isStrategicIdentityException({ edgeCount: 1, jurisdictions: ["us-ca-3"], priorityScore: 30 }),
    ).toBe(true);
    expect(classifyDemandLanePolicy({ eligible: true, edgeCount: 6 })).toBe("BULK_IDENTITY");
    expect(
      classifyDemandLanePolicy({
        eligible: true,
        edgeCount: 1,
        jurisdictions: ["us-d-paed"],
        priorityScore: 20,
      }),
    ).toBe("STRATEGIC_LOOKUP");
    expect(classifyDemandLanePolicy({ eligible: true, edgeCount: 1, jurisdictions: ["st-xx"] })).toBe("NO_BULK");
  });
});

describe("local authority index", () => {
  it("resolves exact and alias; rejects ambiguity", () => {
    const index = new LocalAuthorityIndex([
      authority({
        id: "A1",
        citation: "42 U.S.C. § 1983",
        normalizedCitation: "42 U.S.C. § 1983",
        metadata: { citationAliases: ["42 USC § 1983"] },
      }),
      authority({
        id: "A2",
        citation: "410 U.S. 113",
        normalizedCitation: "410 U.S. 113",
        metadata: { parallelCitations: ["93 S. Ct. 705"] },
      }),
      authority({ id: "A3", citation: "1 F.3d 1", normalizedCitation: "1 F.3d 1" }),
      authority({ id: "A4", citation: "1 F.3d 1", normalizedCitation: "1 F.3d 1" }),
    ]);

    const exact = index.lookupCitation("42 U. S. C. § 1983", "42 U.S.C. § 1983");
    expect(exact.kind).toBe("one");
    if (exact.kind === "one") expect(exact.authorityId).toBe("A1");

    const parallel = index.lookupCitation("93 S. Ct. 705", "93 S. Ct. 705");
    expect(parallel.kind).toBe("one");
    if (parallel.kind === "one") {
      expect(parallel.authorityId).toBe("A2");
      expect(parallel.method).toBe("LOCAL_PARALLEL");
    }

    const amb = index.lookupCitation("1 F.3d 1", "1 F.3d 1");
    expect(amb.kind).toBe("ambiguous");
  });

  it("looks up CourtListener external ids", () => {
    const index = new LocalAuthorityIndex([
      authority({ id: "C1", sourceExternalId: "cl-opinion-99", citation: "1 U.S. 1", normalizedCitation: "1 U.S. 1" }),
    ]);
    const hit = index.lookupExternalId("cl-opinion-99");
    expect(hit.kind).toBe("one");
  });
});

describe("unique target queue", () => {
  it("deduplicates edges and scores demand", () => {
    const index = new LocalAuthorityIndex([
      authority({ id: "A1", citation: "42 U.S.C. § 1983", normalizedCitation: "42 U.S.C. § 1983" }),
    ]);
    const edges: UnresolvedEdgeRow[] = [
      { id: "e1", fromAuthorityId: "c1", rawCitation: "410 U.S. 113", normalizedCitation: "410 U.S. 113", fromCourtId: "us-ca-3" },
      { id: "e2", fromAuthorityId: "c2", rawCitation: "410 U. S. 113", normalizedCitation: "410 U.S. 113", fromCourtId: "us-ca-3" },
      { id: "e3", fromAuthorityId: "c3", rawCitation: "42 U.S.C. § 1983", normalizedCitation: "42 U.S.C. § 1983", fromCourtId: "us-d-paed" },
    ];
    const q = buildUnresolvedTargetQueue(edges, index);
    expect(q.unresolvedEdges).toBe(3);
    expect(q.uniqueTargets).toBe(2);
    expect(q.dedupRatio).toBeCloseTo(1.5);
    expect(chunkTargetsForBatch(q.targets, 1)).toHaveLength(2);
    expect(scoreUnresolvedTarget({
      edgeCount: 10,
      uniqueCitingCases: 8,
      jurisdictions: ["us-ca-3"],
      reporter: "U.S.",
      lookupSuitable: true,
      localCandidateStatus: "NO_LOCAL_MATCH",
    })).toBeGreaterThan(40);
  });
});

describe("local HIGH resolver + backfill", () => {
  it("auto-resolves only deterministic HIGH; backfills many edges", () => {
    const index = new LocalAuthorityIndex([
      authority({ id: "A1", citation: "42 U.S.C. § 1983", normalizedCitation: "42 U.S.C. § 1983" }),
    ]);
    const edges: UnresolvedEdgeRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      fromAuthorityId: `c${i}`,
      rawCitation: "42 U. S. C. § 1983",
      normalizedCitation: "42 U.S.C. § 1983",
    }));
    const q = buildUnresolvedTargetQueue(edges, index);
    const dry = dryRunLocalHighResolver(q.targets, index);
    expect(dry.highTargets).toBe(1);
    expect(dry.highEdges).toBe(5);
    expect(dry.ambiguousSkipped).toBe(0);
    const plan = planBackfillFromProposals(dry.proposals);
    expect(plan.edgesBackfillable).toBe(5);

    const global = planGlobalBackfill(edges, [
      { targetKey: dry.proposals[0]!.targetKey, toAuthorityId: "A1", method: "LOCAL_EXACT" },
    ]);
    expect(global.edgesPlanned).toBe(5);
    expect(global.idempotentSafe).toBe(true);
  });

  it("does not merge competing authorities for same target key", () => {
    const edges: UnresolvedEdgeRow[] = [
      { id: "e1", fromAuthorityId: "c1", rawCitation: "1 U.S. 1", normalizedCitation: "1 U.S. 1" },
    ];
    const plan = planGlobalBackfill(edges, [
      { targetKey: targetKey("1 U.S. 1", "1 U.S. 1"), toAuthorityId: "A1", method: "LOCAL_EXACT" },
      { targetKey: targetKey("1 U.S. 1", "1 U.S. 1"), toAuthorityId: "A2", method: "LOCAL_EXACT" },
    ]);
    expect(plan.edgesPlanned).toBe(0);
  });
});

describe("CL identity client (mock)", () => {
  it("uses one text per request and handles ambiguity / not found", async () => {
    expect(CL_LOOKUP_TEXTS_PER_REQUEST).toBe(1);
    expect(dedupeLookupTexts(["410 U.S. 113", "410 U.S. 113", "93 S. Ct. 705"])).toEqual([
      "410 U.S. 113",
      "93 S. Ct. 705",
    ]);

    const amb = parseCitationLookupResponse([
      {
        status: 200,
        clusters: [
          { id: 1, citations: ["410 U.S. 113"] },
          { id: 2, citations: ["411 U.S. 1"] },
        ],
      },
    ]);
    expect(amb.status).toBe("ambiguous");

    const ok = simulateLookupFromFixture("410 U.S. 113", {
      "410 U.S. 113": [{ status: 200, clusters: [{ id: 55, case_name: "Roe", citations: ["410 U.S. 113"] }] }],
    });
    expect(ok.status).toBe("resolved");
    if (ok.status === "resolved") expect(ok.clusterId).toBe("55");

    const batch = await runIdentityBatch({
      texts: ["410 U.S. 113", "999 F.3d 999"],
      checkpoint: emptyCheckpoint(),
      fixtures: {
        "410 U.S. 113": [{ status: 200, clusters: [{ id: 55, citations: ["410 U.S. 113"] }] }],
      },
      maxRequests: 10,
    });
    expect(batch.checkpoint.resolved).toBe(1);
    expect(batch.checkpoint.notFound).toBe(1);
    expect(batch.checkpoint.requestsConsumed).toBe(2);
  });
});

describe("ledger reversibility + corpus-complete distinction", () => {
  it("supersedes mappings and keeps AUTHORITY_RESOLVED ≠ CORPUS_COMPLETE", () => {
    const r1 = createResolutionRecord({
      rawCitation: "42 U. S. C. § 1983",
      normalizedCitation: "42 U.S.C. § 1983",
      targetKey: "42 u.s.c. § 1983",
      toAuthorityId: "A1",
      method: "LOCAL_EXACT",
      confidence: "HIGH",
      evidence: ["exact"],
      citationEdgeId: "e1",
    });
    expect(r1.state).toBe("AUTHORITY_RESOLVED");
    expect(r1.rawCitation).toContain("U. S. C.");
    const r2 = createResolutionRecord({
      rawCitation: r1.rawCitation,
      normalizedCitation: r1.normalizedCitation,
      targetKey: r1.targetKey,
      toAuthorityId: "A9",
      method: "MANUAL",
      confidence: "HIGH",
      evidence: ["manual_correct"],
      citationEdgeId: "e1",
    });
    const old = supersedeRecord(r1, r2.id);
    expect(old.active).toBe(false);
    expect(old.supersededBy).toBe(r2.id);

    expect(authorityCorpusState(authority({ id: "A1", ingestionStatus: "pending" }))).toBe("AUTHORITY_RESOLVED");
    expect(authorityCorpusState(authority({ id: "A1", corpusComplete: true, ingestionStatus: "ready" }))).toBe(
      "CORPUS_COMPLETE",
    );
  });
});

describe("future ingestion local-first", () => {
  it("resolves locally and queues unique unresolved targets", () => {
    const authorities = [
      authority({ id: "A1", citation: "410 U.S. 113", normalizedCitation: "410 U.S. 113" }),
    ];
    const out = resolveNewCitationsLocalFirst(
      [
        { fromAuthorityId: "c1", rawCitation: "410 U.S. 113" },
        { fromAuthorityId: "c1", rawCitation: "999 F.3d 1" },
        { fromAuthorityId: "c2", rawCitation: "999 F. 3d 1" },
      ],
      authorities,
    );
    expect(out.results[0]!.edge.toAuthorityId).toBe("A1");
    expect(out.unresolvedEdges).toHaveLength(2);
    expect(out.metrics.EXTERNAL_LOOKUPS_AVOIDED).toBeGreaterThanOrEqual(0);
    expect(out.metrics.UNIQUE_NEW_UNRESOLVED_TARGETS).toBe(1);
  });
});

describe("demand full-text separation", () => {
  it("selects only high-demand missing case reporters", () => {
    const keys = selectDemandFullTextTargets([
      {
        targetKey: "a",
        edgeCount: 5,
        lookupSuitable: true,
        localCandidateStatus: "NO_LOCAL_MATCH",
        reporter: "U.S.",
        jurisdictions: ["us-ca-3"],
      },
      {
        targetKey: "b",
        edgeCount: 1,
        lookupSuitable: true,
        localCandidateStatus: "NO_LOCAL_MATCH",
        reporter: "U.S.",
        jurisdictions: [],
      },
    ]);
    expect(keys).toEqual(["a"]);
  });
});

describe("anti-regression metrics", () => {
  it("computes local resolution rate", () => {
    const m = metricsForNewCaseBatch({
      newEdgesTotal: 100,
      byMethod: { LOCAL_EXACT: 40, LOCAL_ALIAS: 10, COURTLISTENER_CITATION_LOOKUP: 20 },
      uniqueUnresolvedTargets: 25,
      oldEdgesBackfilled: 5,
      authoritiesResolvedWithoutAcquisition: 20,
      fullTextAcquisitions: 2,
      externalLookups: 20,
      externalLookupsAvoided: 30,
      newCases: 10,
    });
    expect(m.LOCAL_RESOLUTION_RATE).toBeCloseTo(0.5);
    expect(m.NEW_EDGES_IDENTITY_UNRESOLVED).toBe(30);
    expect(m.EXTERNAL_LOOKUPS_PER_1000_NEW_CASES).toBe(2000);
  });
});

describe("citation_target_classification semantics", () => {
  it("CASE_CITATION is case-identity eligible; artifacts are not", () => {
    expect(isCaseIdentityEligible("CASE_CITATION")).toBe(true);
    expect(isTrueCaseIdentityClassification("CASE_CITATION")).toBe(true);
    expect(isCitationArtifactClassification("CASE_CITATION")).toBe(false);

    for (const c of [
      "STATUTE",
      "RULE",
      "REGULATION",
      "YYYY_PAGE_N",
      "RECORD_REFERENCE",
      "EXHIBIT_REFERENCE",
      "OCR_MALFORMED",
      "PARSER_MALFORMED",
      "CASE_LIKE_BUT_MALFORMED",
      "BARE_PAGE",
      "PIN_CITE_ONLY",
      "DOCKET_REFERENCE",
      "SECTION_REFERENCE",
      "NON_CASE_REPORTER",
      "OTHER_NON_CASE",
      "UNKNOWN_ARTIFACT",
    ] as const) {
      expect(isCaseIdentityEligible(c)).toBe(false);
      expect(isCitationArtifactClassification(c)).toBe(true);
      expect(isTrueCaseIdentityClassification(c)).toBe(false);
    }
  });

  it("UNKNOWN is conservatively queue-eligible but not true-case", () => {
    expect(isCaseIdentityEligible("UNKNOWN")).toBe(true);
    expect(isCaseIdentityEligible(null)).toBe(true);
    expect(isCaseIdentityEligible(undefined)).toBe(true);
    expect(isUnknownClassification("UNKNOWN")).toBe(true);
    expect(isTrueCaseIdentityClassification("UNKNOWN")).toBe(false);
    expect(isCitationArtifactClassification("UNKNOWN")).toBe(false);
  });

  it("CASE_LIKE_BUT_MALFORMED is preserved as artifact (excluded from case queue)", () => {
    expect(isCitationArtifactClassification("CASE_LIKE_BUT_MALFORMED")).toBe(true);
    expect(isCaseIdentityEligible("CASE_LIKE_BUT_MALFORMED")).toBe(false);
  });

  it("honest metrics preserve RAW and split true-case / artifact / unknown", () => {
    const edges = [
      { toAuthorityId: null, citationTargetClassification: "CASE_CITATION" },
      { toAuthorityId: null, citationTargetClassification: "CASE_CITATION" },
      { toAuthorityId: null, citationTargetClassification: "STATUTE" },
      { toAuthorityId: null, citationTargetClassification: "YYYY_PAGE_N" },
      { toAuthorityId: null, citationTargetClassification: "UNKNOWN" },
      { toAuthorityId: null, citationTargetClassification: null },
      { toAuthorityId: "auth-1", citationTargetClassification: "CASE_CITATION" },
      { toAuthorityId: "auth-2", citationTargetClassification: "STATUTE" },
    ];
    const m = computeCitationIdentityAccounting(edges);
    expect(m.IDENTITY_UNRESOLVED_EDGES_RAW).toBe(6);
    expect(m.TRUE_CASE_IDENTITY_UNRESOLVED_EDGES).toBe(2);
    expect(m.INELIGIBLE_ARTIFACT_EDGES).toBe(2);
    expect(m.UNKNOWN_CLASSIFICATION_EDGES).toBe(2);
    expect(m.AUTHORITY_RESOLVED_EDGES).toBe(2);
    // Classification alone must not mutate authority-resolution accounting.
    expect(m.AUTHORITY_RESOLVED_EDGES + m.IDENTITY_UNRESOLVED_EDGES_RAW).toBe(edges.length);
  });

  it("queue excludes artifact classifications; keeps CASE_CITATION and UNKNOWN", () => {
    const items = [
      { id: "1", citationTargetClassification: "CASE_CITATION" as const },
      { id: "2", citationTargetClassification: "UNKNOWN" as const },
      { id: "3", citationTargetClassification: "STATUTE" as const },
      { id: "4", citationTargetClassification: "EXHIBIT_REFERENCE" as const },
      { id: "5", citationTargetClassification: "CASE_LIKE_BUT_MALFORMED" as const },
    ];
    const kept = filterCaseIdentityQueueByClassification(items);
    expect(kept.map((i) => i.id)).toEqual(["1", "2"]);

    const targets = [
      {
        representativeRaw: "410 U.S. 113",
        normalizedCitation: "410 U.S. 113",
        citationTargetClassification: "CASE_CITATION",
      },
      {
        representativeRaw: "42 U.S.C. § 1983",
        normalizedCitation: "42 U.S.C. § 1983",
        citationTargetClassification: "STATUTE",
      },
      {
        representativeRaw: "410 U.S. 113",
        normalizedCitation: "410 U.S. 113",
        citationTargetClassification: "OCR_MALFORMED",
      },
    ];
    const eligible = filterExternalIdentityQueueTargets(targets);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.citationTargetClassification).toBe("CASE_CITATION");
  });

  it("target queue propagates persisted classification without dropping raw evidence", () => {
    const edges: UnresolvedEdgeRow[] = [
      {
        id: "e1",
        fromAuthorityId: "c1",
        rawCitation: "2026 Page 2",
        normalizedCitation: "2026 Page 2",
        citationTargetClassification: "YYYY_PAGE_N",
      },
      {
        id: "e2",
        fromAuthorityId: "c2",
        rawCitation: "410 U.S. 113",
        normalizedCitation: "410 U.S. 113",
        citationTargetClassification: "CASE_CITATION",
      },
    ];
    const q = buildUnresolvedTargetQueue(edges, new LocalAuthorityIndex([]));
    const page = q.targets.find((t) => /page/i.test(t.normalizedCitation));
    const us = q.targets.find((t) => t.normalizedCitation.includes("410"));
    expect(page?.citationTargetClassification).toBe("YYYY_PAGE_N");
    expect(us?.citationTargetClassification).toBe("CASE_CITATION");
    expect(page?.representativeRaw).toBe("2026 Page 2");
    const filtered = filterExternalIdentityQueueTargets(q.targets);
    expect(filtered.every((t) => t.citationTargetClassification !== "YYYY_PAGE_N")).toBe(true);
  });
});
