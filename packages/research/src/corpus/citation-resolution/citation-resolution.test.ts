import { describe, expect, it } from "vitest";
import { planGlobalBackfill, selectDemandFullTextTargets } from "./backfill.js";
import {
  CL_LOOKUP_TEXTS_PER_REQUEST,
  dedupeLookupTexts,
  emptyCheckpoint,
  parseCitationLookupResponse,
  runIdentityBatch,
  simulateLookupFromFixture,
} from "./cl-identity-client.js";
import { createResolutionRecord, supersedeRecord } from "./ledger.js";
import { LocalAuthorityIndex } from "./local-index.js";
import { dryRunLocalHighResolver, planBackfillFromProposals } from "./local-resolver.js";
import { metricsForNewCaseBatch } from "./metrics.js";
import {
  citationLookupAliases,
  experimentalNormalize,
  targetKey,
} from "./normalize.js";
import { resolveNewCitationsLocalFirst } from "./pipeline.js";
import { buildUnresolvedTargetQueue, chunkTargetsForBatch, scoreUnresolvedTarget } from "./target-queue.js";
import { authorityCorpusState, type AuthorityIndexRow, type UnresolvedEdgeRow } from "./types.js";

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
