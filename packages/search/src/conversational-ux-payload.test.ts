import { describe, expect, it } from "vitest";
import { buildAskUxPayload } from "./conversational-ux-payload";
import {
  createPendingActionRecord,
  isCancelUtterance,
} from "./conversational-workflow-actions";
import { emptyWorkingState } from "./conversation-context";
import type { ReferentResolutionResult } from "./conversational-referent-resolver";

function ambiguousReferent(): ReferentResolutionResult {
  return {
    referentRequested: true,
    status: "AMBIGUOUS",
    referents: [],
    candidates: [
      {
        entityType: "motion",
        entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        label: "Motion to Compel — May 4",
      },
      {
        entityType: "motion",
        entityId: "ffffffff-1111-4222-8333-444444444444",
        label: "Summary Judgment — June 12",
      },
    ],
    userClarificationNeeded: true,
    clarificationPrompt: "Which motion do you mean?",
    routingQuestion: "open the motion",
    forceDomains: [],
    activeStateAfter: emptyWorkingState(),
    diagnostics: {
      referentRequested: true,
      referentType: "motion",
      resolutionMethod: null,
      candidateCount: 2,
      resolvedEntityId: null,
      ambiguity: true,
      activeContextBefore: {},
      activeContextAfter: {},
      routerDomainsAfterResolution: [],
      resolverLatencyMs: 1,
    },
    draftIntentPreview: null,
  };
}

describe("Phase 5 conversational UX payload", () => {
  it("J — builds ambiguity choices without exposing raw UUIDs", () => {
    const ux = buildAskUxPayload({
      matterId: "m1",
      referentResolution: ambiguousReferent(),
    });
    expect(ux.turnKind).toBe("ambiguity");
    expect(ux.ambiguity?.choices.map((c) => c.label)).toEqual([
      "Motion to Compel — May 4",
      "Summary Judgment — June 12",
    ]);
    expect(JSON.stringify(ux.ambiguity)).not.toMatch(
      /aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/,
    );
  });

  it("builds awaiting-confirmation action previews", () => {
    const pending = createPendingActionRecord({
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      conversationId: "c1",
      organizationId: "o1",
      matterId: "m1",
      workingState: emptyWorkingState(),
      previewPayload: {
        previewText: "Draft argument for Claim A",
        requestedPurpose: "argument",
      },
      classificationLatencyMs: 2,
    });
    const ux = buildAskUxPayload({ matterId: "m1", conversationalAction: pending });
    expect(ux.turnKind).toBe("action_preview");
    expect(ux.action?.confirmationRequired).toBe(true);
    expect(ux.action?.summary).toMatch(/Claim A|Draft/i);
  });

  it("K — builds navigation payload for validated routes", () => {
    const pending = createPendingActionRecord({
      actionType: "NAVIGATE",
      actionClass: "NAVIGATION",
      conversationId: "c1",
      organizationId: "o1",
      matterId: "m1",
      workingState: emptyWorkingState(),
      previewPayload: {
        kind: "OPEN_TIMELINE",
        route: "/app/cases/m1/timeline",
        label: "Timeline",
        targetEntityId: null,
      },
      classificationLatencyMs: 1,
    });
    pending.confirmationRequired = false;
    pending.actionStatus = "COMPLETED";
    pending.workflowStatus = "COMPLETED";
    const ux = buildAskUxPayload({ matterId: "m1", conversationalAction: pending });
    expect(ux.turnKind).toBe("navigation");
    expect(ux.navigation?.route).toBe("/app/cases/m1/timeline");
  });

  it("recognizes cancel utterances without treating them as confirm", () => {
    expect(isCancelUtterance("cancel")).toBe(true);
    expect(isCancelUtterance("never mind")).toBe(true);
    expect(isCancelUtterance("don't save")).toBe(true);
    expect(isCancelUtterance("confirm")).toBe(false);
    expect(isCancelUtterance("save it")).toBe(false);
  });
});
