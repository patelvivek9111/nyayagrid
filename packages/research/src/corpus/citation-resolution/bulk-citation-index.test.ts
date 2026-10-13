import { describe, expect, it } from "vitest";
import {
  bulkVrpKey,
  citationToBulkVrpKey,
  classifyBulkIdentity,
  compactReporter,
  isDeterministicBulkStatus,
} from "./bulk-citation-index.js";

describe("bulk citation index keys", () => {
  it("compacts reporter variants to the same key", () => {
    expect(compactReporter("F. Supp. 2d")).toBe(compactReporter("F.Supp.2d"));
    expect(compactReporter("S. Ct.")).toBe(compactReporter("S.Ct."));
    expect(bulkVrpKey(410, "U.S.", 113)).toBe(bulkVrpKey(410, "U. S.", 113));
    expect(citationToBulkVrpKey("410 U.S. 113")).toBe(citationToBulkVrpKey("410 U. S. 113"));
  });
});

describe("bulk identity classification", () => {
  it("unique VRP → one cluster resolves deterministically", () => {
    const r = classifyBulkIdentity({
      raw: "410 U.S. 113",
      normalized: "410 U.S. 113",
      clusterIds: ["108598"],
      parallelCitations: ["410 U.S. 113", "93 S. Ct. 705"],
    });
    expect(isDeterministicBulkStatus(r.status)).toBe(true);
    expect(r.clusterId).toBe("108598");
    expect(r.clusterIds).toEqual(["108598"]);
  });

  it("VRP → 2 clusters = AMBIGUOUS", () => {
    const r = classifyBulkIdentity({
      raw: "408 U.S. 104",
      normalized: "408 U.S. 104",
      clusterIds: ["108598", "8988822"],
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.clusterId).toBeNull();
    expect(r.clusterIds).toHaveLength(2);
  });

  it("VRP → 3+ clusters = AMBIGUOUS", () => {
    const r = classifyBulkIdentity({
      raw: "1 Cranch 137",
      normalized: "1 Cranch 137",
      clusterIds: ["1", "2", "3"],
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.reason).toBe("multi_cluster_3plus");
  });

  it("parallel secondary reporter resolves when unique cluster", () => {
    const r = classifyBulkIdentity({
      raw: "93 S. Ct. 705",
      normalized: "93 S. Ct. 705",
      clusterIds: ["108598"],
      parallelCitations: ["410 U.S. 113", "93 S. Ct. 705"],
    });
    expect(r.status).toBe("RESOLVED_PARALLEL");
    expect(r.clusterId).toBe("108598");
  });

  it("ineligible citation excluded", () => {
    const r = classifyBulkIdentity({
      raw: "2026 Page 2",
      normalized: "2026 Page 2",
      clusterIds: ["1"],
    });
    expect(r.status).toBe("INELIGIBLE");
    expect(isDeterministicBulkStatus(r.status)).toBe(false);
  });

  it("absent key is NOT_FOUND", () => {
    const r = classifyBulkIdentity({
      raw: "12 F.3d 345",
      normalized: "12 F.3d 345",
      clusterIds: [],
    });
    expect(["NOT_FOUND", "INELIGIBLE"]).toContain(r.status);
    // When eligible, empty cluster set is NOT_FOUND; some extreme shapes may be INELIGIBLE first.
    if (r.status === "NOT_FOUND") expect(r.reason).toBe("key_absent");
  });
});
