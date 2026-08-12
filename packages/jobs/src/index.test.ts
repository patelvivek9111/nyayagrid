import { describe, expect, it } from "vitest";
import { handlePing, InMemoryJobDispatcher, type JobName } from "./index";

describe("job idempotency", () => {
  it("processes a given idempotency key once", async () => {
    let runs = 0;
    const dispatcher = new InMemoryJobDispatcher({
      ping: async (payload) => {
        runs += 1;
        return handlePing(payload);
      },
    });
    const payload = { idempotencyKey: "job_1" };
    await dispatcher.dispatch("ping", payload);
    await dispatcher.dispatch("ping", payload);
    expect(runs).toBe(1);
    expect(dispatcher.processed).toHaveLength(1);
  });

  it("type-safe dispatch accepts Phase 5 professional analysis job names and remains idempotent", async () => {
    const phase5JobNames: JobName[] = [
      "matter.analyze_contract",
      "matter.compare_documents",
      "matter.analyze_deposition",
      "matter.detect_contradictions",
      "matter.classify_discovery_document",
      "matter.detect_near_duplicates",
      "matter.refresh_evidence_matrix",
    ];

    let runs = 0;
    const dispatcher = new InMemoryJobDispatcher({
      "matter.analyze_contract": async () => {
        runs += 1;
        return { ok: true, message: "contract analyzed" };
      },
    });

    const payload = {
      organizationId: "org_1",
      matterId: "matter_1",
      documentId: "doc_1",
      documentVersionId: "version_1",
      idempotencyKey: "contract_analysis:version_1",
    };
    await dispatcher.dispatch("matter.analyze_contract", payload);
    await dispatcher.dispatch("matter.analyze_contract", payload);
    expect(runs).toBe(1);
    expect(dispatcher.processed).toHaveLength(1);
    expect(phase5JobNames).toContain("matter.analyze_contract");
  });
});
