import { describe, expect, it } from "vitest";
import {
  AUTHORITY_DISPLAY_LABELS,
  FACTUALITY_DISPLAY_LABELS,
  STALE_ACTION_USER_MESSAGE,
  actionCardTitle,
  confirmPhraseForActionType,
  filterRenderableMatterSources,
  isSafeMatterNavigationRoute,
  stageFromAskStreamEventType,
} from "./command-center-ux";

describe("Phase 5 Command Center UX helpers", () => {
  it("A — maps SSE events to truthful progress stages", () => {
    expect(stageFromAskStreamEventType("request_started")).toBe("REQUEST_ACCEPTED");
    expect(stageFromAskStreamEventType("retrieval_started")).toBe("RETRIEVING_MATTER");
    expect(stageFromAskStreamEventType("citation_check_started")).toBe("CONTEXT_LOADING");
    expect(stageFromAskStreamEventType("generation_completed")).toBe("COMPLETED");
    expect(stageFromAskStreamEventType("generation_stopped")).toBe("CANCELLED");
    expect(stageFromAskStreamEventType("generation_failed")).toBe("FAILED");
    expect(stageFromAskStreamEventType("text_delta")).toBeNull();
  });

  it("B — completed stage only from generation_completed", () => {
    expect(stageFromAskStreamEventType("generation_started")).not.toBe("COMPLETED");
    expect(stageFromAskStreamEventType("generation_completed")).toBe("COMPLETED");
  });

  it("G — factuality labels are human-readable", () => {
    expect(FACTUALITY_DISPLAY_LABELS.FACT).toBe("Record fact");
    expect(FACTUALITY_DISPLAY_LABELS.SUPPORTED_INFERENCE).toBe("Supported inference");
    expect(FACTUALITY_DISPLAY_LABELS.CONFLICT).toBe("Conflict");
    expect(FACTUALITY_DISPLAY_LABELS.UNKNOWN).toBe("Not established");
    expect(FACTUALITY_DISPLAY_LABELS.UNSUPPORTED).toMatch(/Unsupported/);
  });

  it("H — authority treatment unknown stays distinct from verified", () => {
    expect(AUTHORITY_DISPLAY_LABELS.treatmentNotVerified).toBe("Treatment not verified");
    expect(AUTHORITY_DISPLAY_LABELS.treatmentVerified).toBe("Treatment verified");
    expect(AUTHORITY_DISPLAY_LABELS.fullTextAvailable).not.toBe(
      AUTHORITY_DISPLAY_LABELS.authorityIdentified,
    );
  });

  it("F — foreign sources not rendered when allow-list excludes them", () => {
    const allowed = new Set(["doc-matter"]);
    const out = filterRenderableMatterSources(
      [
        { documentId: "doc-matter", chunkId: "c1", category: "case_evidence" },
        { documentId: "doc-foreign", chunkId: "c2", category: "case_evidence" },
        { documentId: "web:x", category: "web", url: "https://example.com" },
      ],
      { allowedDocumentIds: allowed, matterId: "m1" },
    );
    expect(out.map((s) => s.documentId)).toEqual(["doc-matter", "web:x"]);
  });

  it("K — navigation target validation fail-closed", () => {
    expect(isSafeMatterNavigationRoute("/app/cases/m1/timeline", "m1")).toBe(true);
    expect(isSafeMatterNavigationRoute("/app/cases/OTHER/timeline", "m1")).toBe(false);
    expect(isSafeMatterNavigationRoute("https://evil.example/x", "m1")).toBe(false);
    expect(isSafeMatterNavigationRoute("/app/cases/m1/../admin", "m1")).toBe(false);
  });

  it("I — stale action copy is explicit", () => {
    expect(STALE_ACTION_USER_MESSAGE).toMatch(/no longer current/i);
    expect(actionCardTitle("DRAFT_SAVE", "ACTION_CONFIRMATION_STALE")).toBe("Preview outdated");
  });

  it("confirm phrases bind by action type", () => {
    expect(confirmPhraseForActionType("DRAFT_GENERATE_PREVIEW")).toBe("save it");
    expect(confirmPhraseForActionType("TASK_CREATE")).toBe("create the task");
    expect(confirmPhraseForActionType("RESEARCH_READ")).toBe("save this research");
  });
});
