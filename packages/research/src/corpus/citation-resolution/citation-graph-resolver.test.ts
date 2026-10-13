import { describe, expect, it } from "vitest";
import {
  assertEdgeLevelOnly,
  disambiguateCollisionEdgeByCitationGraph,
  isDeterministicGraphStatus,
} from "./citation-graph-resolver.js";

describe("citation-graph-resolver", () => {
  const clusterOf: Record<string, string> = {
    "op-a": "cluster-cite-a",
    "op-b": "cluster-cite-b",
    "op-c": "cluster-cite-c",
    "op-x": "cluster-citer",
  };
  const outs: Record<string, string[]> = {
    "op-x": ["op-a"],
    "op-y": ["op-a", "op-b"],
  };

  it("resolves when citing opinion links exactly one candidate cluster", () => {
    const r = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: "cluster-citer",
      citingOpinionIds: ["op-x"],
      candidateClusterIds: ["cluster-cite-a", "cluster-cite-b"],
      citedOpinionIdsForCiting: (id) => outs[id] || [],
      clusterIdForOpinion: (id) => clusterOf[id],
    });
    expect(r.status).toBe("GRAPH_UNIQUE_EDGE_MATCH");
    expect(r.citedClusterId).toBe("cluster-cite-a");
    expect(isDeterministicGraphStatus(r.status)).toBe(true);
  });

  it("refuses when graph links two candidates", () => {
    const r = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: "cluster-citer",
      citingOpinionIds: ["op-y"],
      candidateClusterIds: ["cluster-cite-a", "cluster-cite-b"],
      citedOpinionIdsForCiting: (id) => outs[id] || [],
      clusterIdForOpinion: (id) => clusterOf[id],
    });
    expect(r.status).toBe("GRAPH_AMBIGUOUS");
    expect(r.citedClusterId).toBeNull();
  });

  it("refuses when graph has no candidate link", () => {
    const r = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: "cluster-citer",
      citingOpinionIds: ["op-x"],
      candidateClusterIds: ["cluster-cite-b", "cluster-cite-c"],
      citedOpinionIdsForCiting: (id) => outs[id] || [],
      clusterIdForOpinion: (id) => clusterOf[id],
    });
    expect(r.status).toBe("GRAPH_NO_MATCH");
  });

  it("refuses when citer unavailable", () => {
    const r = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: null,
      citingOpinionIds: [],
      candidateClusterIds: ["cluster-cite-a"],
      citedOpinionIdsForCiting: () => [],
      clusterIdForOpinion: () => null,
    });
    expect(r.status).toBe("GRAPH_CITER_UNAVAILABLE");
  });

  it("refuses when citer cluster has no opinion ids", () => {
    const r = disambiguateCollisionEdgeByCitationGraph({
      citingClusterId: "cluster-citer",
      citingOpinionIds: [],
      candidateClusterIds: ["cluster-cite-a", "cluster-cite-b"],
      citedOpinionIdsForCiting: () => [],
      clusterIdForOpinion: () => null,
    });
    expect(r.status).toBe("GRAPH_CITER_UNAVAILABLE");
    expect(r.reason).toBe("citer_cluster_without_opinions");
  });

  it("allows two edges of same VRP to resolve to different clusters (edge-level)", () => {
    const proposals = [
      { targetKey: "100|f2d|1", edgeId: "e1", clusterId: "c1" },
      { targetKey: "100|f2d|1", edgeId: "e2", clusterId: "c2" },
    ];
    const a = assertEdgeLevelOnly(proposals);
    expect(a.ok).toBe(true);
    expect(a.collisionsPreserved).toBe(1);
  });
});
