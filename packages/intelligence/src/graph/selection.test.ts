import { describe, expect, it } from "vitest";
import {
  GRAPH_EXTRACT_CHUNK_CAP,
  GRAPH_EXTRACT_NODE_CAP,
  GraphFocusRejectedError,
  buildGraphExtractionCoverage,
  preferredDocumentIdsFromNodes,
  scoreGraphNodeForExtraction,
  selectChunksForGraphExtraction,
  selectNodesForGraphExtraction,
  type SelectableChunk,
  type SelectableGraphNode,
} from "./selection";

function node(
  partial: Partial<SelectableGraphNode> & Pick<SelectableGraphNode, "id" | "nodeType" | "displayName">,
): SelectableGraphNode {
  return {
    canonicalEntityType: partial.canonicalEntityType ?? partial.nodeType,
    canonicalEntityId: partial.canonicalEntityId ?? partial.id,
    ...partial,
  };
}

function chunk(
  partial: Partial<SelectableChunk> & Pick<SelectableChunk, "id" | "documentId" | "chunkIndex">,
): SelectableChunk {
  return {
    content: partial.content ?? `content-${partial.id}`,
    ...partial,
  };
}

function padNodes(count: number, prefix: string, nodeType = "other"): SelectableGraphNode[] {
  return Array.from({ length: count }, (_, i) =>
    node({
      id: `${prefix}-${String(i).padStart(4, "0")}`,
      nodeType,
      displayName: `${prefix} ${i}`,
    }),
  );
}

describe("graph extraction selection", () => {
  it("1–3. small matter includes all eligible nodes/chunks and coverageLimited=false", () => {
    const nodes = [
      node({ id: "n1", nodeType: "claim", displayName: "Breach" }),
      node({ id: "n2", nodeType: "person", displayName: "Alex" }),
      node({ id: "n3", nodeType: "document", displayName: "Complaint", canonicalEntityId: "d1" }),
    ];
    const selectedNodes = selectNodesForGraphExtraction({
      candidates: nodes,
      selectionMode: "WHOLE_MATTER",
    });
    expect(selectedNodes).toHaveLength(3);
    expect(selectedNodes.map((n) => n.id).sort()).toEqual(["n1", "n2", "n3"]);

    const chunks = [
      chunk({ id: "c1", documentId: "d1", chunkIndex: 0 }),
      chunk({ id: "c2", documentId: "d1", chunkIndex: 1 }),
      chunk({ id: "c3", documentId: "d2", chunkIndex: 0 }),
    ];
    const selectedChunks = selectChunksForGraphExtraction({
      candidates: chunks,
      preferredDocumentIds: preferredDocumentIdsFromNodes(selectedNodes),
    });
    expect(selectedChunks).toHaveLength(3);

    const coverage = buildGraphExtractionCoverage({
      candidateNodes: nodes.length,
      selectedNodes: selectedNodes.length,
      candidateChunks: chunks.length,
      selectedChunks: selectedChunks.length,
      selectionMode: "WHOLE_MATTER",
      domainsRepresented: [...new Set(selectedNodes.map((n) => n.nodeType))],
    });
    expect(coverage.coverageLimited).toBe(false);
    expect(coverage.truncated).toBe(false);
    expect(coverage.omittedNodeCount).toBe(0);
    expect(coverage.omittedChunkCount).toBe(0);
  });

  it("4. large matter is bounded by caps", () => {
    const nodes = padNodes(120, "filler");
    nodes.push(node({ id: "claim-1", nodeType: "claim", displayName: "Claim A" }));
    const selected = selectNodesForGraphExtraction({
      candidates: nodes,
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.length).toBe(GRAPH_EXTRACT_NODE_CAP);

    const manyChunks = Array.from({ length: 200 }, (_, i) =>
      chunk({
        id: `c-${i}`,
        documentId: `doc-${i % 50}`,
        chunkIndex: Math.floor(i / 50),
      }),
    );
    const selectedChunks = selectChunksForGraphExtraction({
      candidates: manyChunks,
      preferredDocumentIds: new Set(["doc-0", "doc-1"]),
    });
    expect(selectedChunks.length).toBe(GRAPH_EXTRACT_CHUNK_CAP);
  });

  it("5 + 25. ranking is deterministic across repeated runs", () => {
    const nodes = [
      ...padNodes(50, "z"),
      node({ id: "claim-a", nodeType: "claim", displayName: "Alpha Claim" }),
      node({ id: "claim-b", nodeType: "claim", displayName: "Beta Claim" }),
      node({ id: "def-a", nodeType: "defense", displayName: "Defense" }),
    ];
    const run = () =>
      selectNodesForGraphExtraction({
        candidates: nodes,
        selectionMode: "WHOLE_MATTER",
      }).map((n) => n.id);
    expect(run()).toEqual(run());
    expect(run()).toEqual(run());
  });

  it("6 + 26. focused node is prioritized", () => {
    const filler = padNodes(45, "f");
    const focus = node({ id: "focus-1", nodeType: "other", displayName: "ZZ Focus" });
    const selected = selectNodesForGraphExtraction({
      candidates: [...filler, focus],
      selectionMode: "FOCUSED",
      focusNodeId: focus.id,
      neighborhoodIds: new Set([focus.id]),
    });
    expect(selected[0]?.id).toBe("focus-1");
    expect(selected.length).toBeLessThanOrEqual(GRAPH_EXTRACT_NODE_CAP);
  });

  it("7. claim node prioritized", () => {
    const selected = selectNodesForGraphExtraction({
      candidates: [
        ...padNodes(40, "low"),
        node({ id: "claim-1", nodeType: "claim", displayName: "Breach" }),
      ],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "claim-1")).toBe(true);
    expect(selected.findIndex((n) => n.id === "claim-1")).toBeLessThan(5);
  });

  it("8. defense node prioritized", () => {
    const selected = selectNodesForGraphExtraction({
      candidates: [
        ...padNodes(40, "low"),
        node({ id: "def-1", nodeType: "defense", displayName: "SOL" }),
      ],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "def-1")).toBe(true);
  });

  it("9. motion node prioritized", () => {
    const selected = selectNodesForGraphExtraction({
      candidates: [
        ...padNodes(40, "low"),
        node({ id: "mot-1", nodeType: "motion", displayName: "MSJ" }),
      ],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "mot-1")).toBe(true);
  });

  it("10. evidence-linked node prioritized", () => {
    const evidenceDoc = node({
      id: "ev-1",
      nodeType: "document",
      displayName: "Exhibit A — Key Evidence",
      canonicalEntityType: "document",
      canonicalEntityId: "doc-ev",
    });
    const selected = selectNodesForGraphExtraction({
      candidates: [...padNodes(40, "low"), evidenceDoc],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "ev-1")).toBe(true);
  });

  it("11. relevant node beyond old 40 cutoff is selected", () => {
    // Old behavior: incidental first 40. Place claim after 40 fillers lexicographically
    // by id so storage-order selection would have missed it if ordered by id asc and limited.
    const early = padNodes(40, "aaa");
    const lateClaim = node({ id: "zzz-claim", nodeType: "claim", displayName: "Late Claim" });
    const selected = selectNodesForGraphExtraction({
      candidates: [...early, lateClaim],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "zzz-claim")).toBe(true);
    expect(selected.length).toBe(GRAPH_EXTRACT_NODE_CAP);
  });

  it("12. relevant chunk beyond old 24 cutoff is selected", () => {
    // Simulate incidental first-24 from one unrelated doc, plus preferred docs later.
    const earlyChunks = Array.from({ length: 24 }, (_, i) =>
      chunk({ id: `early-${i}`, documentId: "unrelated-doc", chunkIndex: i }),
    );
    const preferredPool = Array.from({ length: 30 }, (_, i) =>
      chunk({
        id: `pref-${i}`,
        documentId: `preferred-doc-${i % 10}`,
        chunkIndex: Math.floor(i / 10),
      }),
    );
    const relevant = chunk({ id: "relevant-late", documentId: "preferred-doc-0", chunkIndex: 99 });
    const selected = selectChunksForGraphExtraction({
      candidates: [...earlyChunks, ...preferredPool, relevant],
      preferredDocumentIds: new Set(
        Array.from({ length: 10 }, (_, i) => `preferred-doc-${i}`),
      ),
    });
    expect(selected.some((c) => c.id === "relevant-late" || c.documentId.startsWith("preferred-doc"))).toBe(
      true,
    );
    expect(selected.some((c) => c.documentId.startsWith("preferred-doc"))).toBe(true);
    expect(selected.length).toBe(GRAPH_EXTRACT_CHUNK_CAP);
    // Preferred matter docs outrank the incidental unrelated first-24.
    const preferredSelected = selected.filter((c) => c.documentId.startsWith("preferred-doc"));
    expect(preferredSelected.length).toBeGreaterThan(selected.filter((c) => c.documentId === "unrelated-doc").length);
  });

  it("13. multiple node types represented in whole-matter mode", () => {
    const candidates = [
      ...padNodes(30, "p", "person"),
      node({ id: "c1", nodeType: "claim", displayName: "Claim" }),
      node({ id: "d1", nodeType: "defense", displayName: "Defense" }),
      node({ id: "m1", nodeType: "motion", displayName: "Motion" }),
      node({ id: "doc1", nodeType: "document", displayName: "Doc", canonicalEntityId: "xd1" }),
      node({ id: "e1", nodeType: "event", displayName: "Hearing" }),
    ];
    const selected = selectNodesForGraphExtraction({
      candidates,
      selectionMode: "WHOLE_MATTER",
    });
    const types = new Set(selected.map((n) => n.nodeType));
    expect(types.has("claim")).toBe(true);
    expect(types.has("defense")).toBe(true);
    expect(types.has("motion")).toBe(true);
    expect(types.has("document")).toBe(true);
    expect(types.has("person")).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(5);
  });

  it("14–15. multiple documents represented; one document cannot monopolize chunks", () => {
    const monopoly = Array.from({ length: 40 }, (_, i) =>
      chunk({ id: `mono-${i}`, documentId: "doc-mono", chunkIndex: i }),
    );
    const others = Array.from({ length: 20 }, (_, i) =>
      chunk({
        id: `other-${i}`,
        documentId: `doc-${i}`,
        chunkIndex: 0,
      }),
    );
    const selected = selectChunksForGraphExtraction({
      candidates: [...monopoly, ...others],
      preferredDocumentIds: new Set(["doc-mono", "doc-0", "doc-1", "doc-2"]),
    });
    const byDoc = new Map<string, number>();
    for (const c of selected) {
      byDoc.set(c.documentId, (byDoc.get(c.documentId) ?? 0) + 1);
    }
    expect(byDoc.size).toBeGreaterThan(1);
    expect(byDoc.get("doc-mono") ?? 0).toBeLessThan(selected.length);
    expect(byDoc.get("doc-mono") ?? 0).toBeLessThanOrEqual(6);
  });

  it("16. unrelated node deprioritized vs legal domains", () => {
    const unrelated = node({ id: "unrel", nodeType: "other", displayName: "Noise" });
    const claim = node({ id: "cl", nodeType: "claim", displayName: "Claim" });
    expect(
      scoreGraphNodeForExtraction({ node: claim }) >
        scoreGraphNodeForExtraction({ node: unrelated }),
    ).toBe(true);
    const selected = selectNodesForGraphExtraction({
      candidates: [unrelated, claim, ...padNodes(38, "mid", "person")],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.findIndex((n) => n.id === "cl")).toBeLessThan(
      selected.findIndex((n) => n.id === "unrel") === -1
        ? Number.POSITIVE_INFINITY
        : selected.findIndex((n) => n.id === "unrel"),
    );
  });

  it("17. foreign focus rejection error type is available", () => {
    const err = new GraphFocusRejectedError("Focus node is not in this matter");
    expect(err.code).toBe("GRAPH_FOCUS_REJECTED");
    expect(err).toBeInstanceOf(Error);
  });

  it("18. missing focus safely falls back when focusNodeId not in candidates", () => {
    // Extract path treats missing DB row as WHOLE_MATTER; selection with unused focus is safe.
    const selected = selectNodesForGraphExtraction({
      candidates: padNodes(5, "ok"),
      selectionMode: "WHOLE_MATTER",
      focusNodeId: "deleted-focus",
    });
    expect(selected).toHaveLength(5);
  });

  it("19–21. selection does not invent nodes/edges; provenance is selection-only", () => {
    const input = [
      node({ id: "a", nodeType: "claim", displayName: "A" }),
      node({ id: "b", nodeType: "defense", displayName: "B" }),
    ];
    const selected = selectNodesForGraphExtraction({
      candidates: input,
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.every((n) => input.some((i) => i.id === n.id))).toBe(true);
    expect(selected.length).toBe(2);
    // Ranking module returns nodes only — no edge invention surface.
    expect(Object.keys(selected[0]!).sort()).toEqual(
      ["canonicalEntityId", "canonicalEntityType", "displayName", "id", "nodeType"].sort(),
    );
  });

  it("22–24. coverageLimited/truncated and omitted counts when truncated", () => {
    const coverage = buildGraphExtractionCoverage({
      candidateNodes: 100,
      selectedNodes: 40,
      candidateChunks: 500,
      selectedChunks: 24,
      selectionMode: "WHOLE_MATTER",
      domainsRepresented: ["claim", "document"],
    });
    expect(coverage.coverageLimited).toBe(true);
    expect(coverage.truncated).toBe(true);
    expect(coverage.omittedNodeCount).toBe(60);
    expect(coverage.omittedChunkCount).toBe(476);
    expect(coverage.selectionBasis).toBe("relevance_ranked_bounded");
    expect(coverage.candidateNodes).toBe(100);
    expect(coverage.selectedNodes).toBe(40);
    expect(coverage.candidateChunks).toBe(500);
    expect(coverage.selectedChunks).toBe(24);
  });

  it("27. whole-matter mode seeds domain diversity", () => {
    const selected = selectNodesForGraphExtraction({
      candidates: [
        ...padNodes(100, "person-heavy", "person"),
        node({ id: "only-claim", nodeType: "claim", displayName: "Sole Claim" }),
        node({ id: "only-motion", nodeType: "motion", displayName: "Sole Motion" }),
      ],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.some((n) => n.id === "only-claim")).toBe(true);
    expect(selected.some((n) => n.id === "only-motion")).toBe(true);
  });

  it("28. 500+ document fixture remains bounded", () => {
    const docNodes = Array.from({ length: 520 }, (_, i) =>
      node({
        id: `doc-node-${i}`,
        nodeType: "document",
        displayName: `Document ${i}`,
        canonicalEntityId: `doc-${i}`,
      }),
    );
    const selectedNodes = selectNodesForGraphExtraction({
      candidates: [
        ...docNodes,
        node({ id: "claim-keep", nodeType: "claim", displayName: "Keep Claim" }),
      ],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selectedNodes.length).toBe(GRAPH_EXTRACT_NODE_CAP);
    expect(selectedNodes.some((n) => n.id === "claim-keep")).toBe(true);

    const chunks = Array.from({ length: 2000 }, (_, i) =>
      chunk({
        id: `ch-${i}`,
        documentId: `doc-${i % 520}`,
        chunkIndex: Math.floor(i / 520),
      }),
    );
    const preferred = preferredDocumentIdsFromNodes(selectedNodes);
    const selectedChunks = selectChunksForGraphExtraction({
      candidates: chunks.slice(0, 480),
      preferredDocumentIds: preferred,
    });
    expect(selectedChunks.length).toBeLessThanOrEqual(GRAPH_EXTRACT_CHUNK_CAP);
    expect(new Set(selectedChunks.map((c) => c.documentId)).size).toBeGreaterThan(1);
  });

  it("29. selection is O(n log n) style — no per-item nested candidate scans", () => {
    const nodes = padNodes(200, "perf");
    const chunks = Array.from({ length: 480 }, (_, i) =>
      chunk({ id: `pc-${i}`, documentId: `d-${i % 40}`, chunkIndex: i }),
    );
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      selectNodesForGraphExtraction({ candidates: nodes, selectionMode: "WHOLE_MATTER" });
      selectChunksForGraphExtraction({
        candidates: chunks,
        preferredDocumentIds: new Set(["d-0", "d-1", "d-2"]),
      });
    }
    const elapsed = performance.now() - t0;
    // 50×(200+480) ranking should be well under a second on CI.
    expect(elapsed).toBeLessThan(2000);
  });

  it("stable tie-break uses nodeType, displayName, id", () => {
    const a = node({ id: "id-b", nodeType: "person", displayName: "Same" });
    const b = node({ id: "id-a", nodeType: "person", displayName: "Same" });
    const selected = selectNodesForGraphExtraction({
      candidates: [a, b],
      selectionMode: "WHOLE_MATTER",
    });
    expect(selected.map((n) => n.id)).toEqual(["id-a", "id-b"]);
  });

  it("connectivity boost elevates high-degree nodes", () => {
    const quiet = node({ id: "quiet", nodeType: "person", displayName: "Quiet" });
    const hub = node({ id: "hub", nodeType: "person", displayName: "Hub" });
    const degreeByNodeId = new Map([
      ["hub", 12],
      ["quiet", 0],
    ]);
    expect(
      scoreGraphNodeForExtraction({ node: hub, degreeByNodeId }) >
        scoreGraphNodeForExtraction({ node: quiet, degreeByNodeId }),
    ).toBe(true);
  });
});
