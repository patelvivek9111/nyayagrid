import { describe, expect, it } from "vitest";
import type { AskStreamEvent, ProvenanceSummary } from "@nyayagrid/ai";
import { askProgressIsTerminal, progressFromAskEvents } from "./ask-progress";

function at() {
  return new Date().toISOString();
}

const emptyProvenance = {
  sourceScope: "case",
  counts: { caseSourceCount: 0, webSourceCount: 0, authoritySourceCount: 0 },
} as ProvenanceSummary;

describe("Phase 5 Ask progress truthfulness", () => {
  it("A/B — does not show Answer ready before generation_completed", () => {
    const mid: AskStreamEvent[] = [
      { type: "request_started", sourceScope: "case", usageActionId: "u1", at: at() },
      { type: "retrieval_started", label: "Retrieving", at: at() },
      { type: "generation_started", at: at() },
    ];
    const rows = progressFromAskEvents(mid);
    expect(askProgressIsTerminal(mid)).toBe(false);
    expect(rows.find((r) => r.id === "generation")?.label).toBe("Preparing answer…");
    expect(rows.find((r) => r.id === "generation")?.detail).not.toBe("COMPLETED");

    const done: AskStreamEvent[] = [
      ...mid,
      {
        type: "generation_completed",
        answer: "Done",
        conversationId: "c1",
        status: "completed",
        provenance: emptyProvenance,
        at: at(),
      },
    ];
    const doneRows = progressFromAskEvents(done);
    expect(askProgressIsTerminal(done)).toBe(true);
    expect(doneRows.find((r) => r.id === "generation")?.label).toBe("Answer ready");
  });

  it("C — cancelled terminal state is visible", () => {
    const events: AskStreamEvent[] = [
      { type: "request_started", sourceScope: "case", usageActionId: "u1", at: at() },
      { type: "generation_started", at: at() },
      {
        type: "generation_stopped",
        status: "cancelled",
        at: at(),
      },
    ];
    const rows = progressFromAskEvents(events);
    expect(askProgressIsTerminal(events)).toBe(true);
    expect(rows.find((r) => r.id === "generation")?.label).toBe("Cancelled");
  });

  it("cancel wins race against late generation_completed", () => {
    const events: AskStreamEvent[] = [
      { type: "generation_started", at: at() },
      { type: "generation_stopped", status: "cancelled", at: at() },
      {
        type: "generation_completed",
        answer: "Too late",
        conversationId: "c1",
        status: "completed",
        provenance: emptyProvenance,
        at: at(),
      },
    ];
    const rows = progressFromAskEvents(events);
    expect(rows.find((r) => r.id === "generation")?.label).toBe("Cancelled");
    expect(rows.find((r) => r.id === "generation")?.detail).toBe("CANCELLED");
  });

  it("shows waiting-for-confirmation when UX payload requires it", () => {
    const events: AskStreamEvent[] = [
      {
        type: "generation_completed",
        answer: "Preview",
        conversationId: "c1",
        status: "completed",
        provenance: emptyProvenance,
        ux: {
          turnKind: "action_preview",
          action: {
            pendingActionId: "p1",
            actionType: "DRAFT_GENERATE_PREVIEW",
            actionClass: "DRAFT_PREVIEW",
            actionStatus: "AWAITING_CONFIRMATION",
            confirmationRequired: true,
          },
        },
        at: at(),
      },
    ];
    const rows = progressFromAskEvents(events);
    expect(rows.find((r) => r.id === "generation")?.label).toBe("Waiting for confirmation…");
  });
});
