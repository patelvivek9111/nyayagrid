import { describe, expect, it } from "vitest";
import {
  isDeterministicCitingContextStatus,
  resolveEdgeCitingContext,
  resolveTargetCitingContext,
  weakFuzzyCaseNameScore,
} from "./citing-context-resolver.js";

const cands = [
  {
    clusterId: "A",
    caseName: "Alpha v. One",
    caseNameFull: "Alpha v. One",
    parallelCitations: ["100 U.S. 1", "1 S. Ct. 1"],
  },
  {
    clusterId: "B",
    caseName: "Beta v. Two",
    caseNameFull: "Beta v. Two",
    parallelCitations: ["100 U.S. 1", "90 S. Ct. 9"],
  },
];

describe("citing-context resolver", () => {
  it("case-name context uniquely resolves", () => {
    const r = resolveEdgeCitingContext({
      candidates: cands,
      edge: {
        edgeId: "e1",
        fromAuthorityId: "op1",
        rawCitation: "Alpha v. One, 100 U.S. 1",
        normalizedCitation: "100 U.S. 1",
        siblingCitationNorms: [],
        siblingResolvedClusterIds: [],
      },
    });
    expect(["RESOLVED_BY_EXACT_CASE_NAME_CONTEXT", "RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT"]).toContain(r.status);
    expect(r.clusterId).toBe("A");
    expect(isDeterministicCitingContextStatus(r.status)).toBe(true);
  });

  it("normalized case-name context resolves when exact string differs", () => {
    const r = resolveEdgeCitingContext({
      candidates: cands,
      edge: {
        edgeId: "e1",
        fromAuthorityId: "op1",
        rawCitation: "Alpha vs. One, 100 U.S. 1",
        normalizedCitation: "100 U.S. 1",
        siblingCitationNorms: [],
        siblingResolvedClusterIds: [],
      },
    });
    expect(r.status).toBe("RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT");
    expect(r.clusterId).toBe("A");
  });

  it("weak fuzzy name does not resolve", () => {
    expect(weakFuzzyCaseNameScore("Alpha v. One", "Alpha v. Ones")).toBeGreaterThan(0.5);
    const r = resolveEdgeCitingContext({
      candidates: cands,
      edge: {
        edgeId: "e1",
        fromAuthorityId: "op1",
        rawCitation: "Alpha v. Ones, 100 U.S. 1",
        normalizedCitation: "100 U.S. 1",
        siblingCitationNorms: [],
        siblingResolvedClusterIds: [],
      },
    });
    expect(isDeterministicCitingContextStatus(r.status)).toBe(false);
  });

  it("parallel co-occurrence uniquely resolves", () => {
    const r = resolveEdgeCitingContext({
      candidates: cands,
      edge: {
        edgeId: "e1",
        fromAuthorityId: "op1",
        rawCitation: "100 U.S. 1",
        normalizedCitation: "100 U.S. 1",
        siblingCitationNorms: ["90 s. ct. 9"],
        siblingResolvedClusterIds: [],
      },
      targetCitationNorms: ["100 U.S. 1"],
    });
    expect(r.status).toBe("RESOLVED_BY_CONTEXT_PARALLELS");
    expect(r.clusterId).toBe("B");
  });

  it("same-opinion stronger context propagates across edges of target", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      targetCitationNorms: ["100 U.S. 1"],
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["90 s. ct. 9"],
          siblingResolvedClusterIds: [],
        },
        {
          edgeId: "e2",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: [],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    expect(r.scope).toBe("target");
    expect(r.clusterId).toBe("B");
    expect(r.edgeResolutions.every((e) => e.clusterId === "B")).toBe(true);
  });

  it("cross-citer consensus resolves", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      targetCitationNorms: ["100 U.S. 1"],
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["90 s. ct. 9"],
          siblingResolvedClusterIds: [],
        },
        {
          edgeId: "e2",
          fromAuthorityId: "op2",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["90 s. ct. 9"],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    expect(r.clusterId).toBe("B");
    expect(["RESOLVED_BY_CROSS_CITER_CONSENSUS", "RESOLVED_BY_CONTEXT_PARALLELS"]).toContain(r.status);
  });

  it("cross-citer disagreement creates TRUE_COLLISION", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      targetCitationNorms: ["100 U.S. 1"],
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["1 s. ct. 1"],
          siblingResolvedClusterIds: [],
        },
        {
          edgeId: "e2",
          fromAuthorityId: "op2",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["90 s. ct. 9"],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    expect(r.status).toBe("TRUE_COLLISION");
    expect(r.scope).toBe("edge_split");
    expect(r.clusterId).toBeNull();
    expect(r.collidingClusterIds.sort()).toEqual(["A", "B"]);
  });

  it("edge-level resolution allowed for true collision", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      targetCitationNorms: ["100 U.S. 1"],
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["1 s. ct. 1"],
          siblingResolvedClusterIds: [],
        },
        {
          edgeId: "e2",
          fromAuthorityId: "op2",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: ["90 s. ct. 9"],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    const a = r.edgeResolutions.find((e) => e.edgeId === "e1");
    const b = r.edgeResolutions.find((e) => e.edgeId === "e2");
    expect(a?.clusterId).toBe("A");
    expect(b?.clusterId).toBe("B");
  });

  it("global target resolution prohibited for true collision", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      targetCitationNorms: ["100 U.S. 1"],
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "Alpha v. One, 100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: [],
          siblingResolvedClusterIds: [],
        },
        {
          edgeId: "e2",
          fromAuthorityId: "op2",
          rawCitation: "Beta v. Two, 100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: [],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    expect(r.status).toBe("TRUE_COLLISION");
    expect(r.scope).not.toBe("target");
    expect(r.clusterId).toBeNull();
  });

  it("missing context stays ambiguous / insufficient", () => {
    const r = resolveTargetCitingContext({
      candidates: cands,
      edges: [
        {
          edgeId: "e1",
          fromAuthorityId: "op1",
          rawCitation: "100 U.S. 1",
          normalizedCitation: "100 U.S. 1",
          siblingCitationNorms: [],
          siblingResolvedClusterIds: [],
        },
      ],
    });
    expect(r.status).toBe("CONTEXT_INSUFFICIENT");
    expect(r.clusterId).toBeNull();
  });

  it("sibling resolved cluster uniquely resolves", () => {
    const r = resolveEdgeCitingContext({
      candidates: cands,
      edge: {
        edgeId: "e1",
        fromAuthorityId: "op1",
        rawCitation: "100 U.S. 1",
        normalizedCitation: "100 U.S. 1",
        siblingCitationNorms: [],
        siblingResolvedClusterIds: ["B"],
      },
    });
    expect(r.status).toBe("RESOLVED_BY_SIBLING_RESOLVED_CLUSTER");
    expect(r.clusterId).toBe("B");
  });
});
