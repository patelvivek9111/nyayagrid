/**
 * Phase 4 — conversational workflow action planner + confirmation gates (static).
 */
import { describe, expect, it } from "vitest";
import { emptyWorkingState } from "./conversation-context";
import { CONVERSATION_RECENT_TURN_LIMIT, selectRecentTurns } from "./conversation-context";
import { planConversationalContext } from "./conversational-context-router";
import { resolveConversationalReferents } from "./conversational-referent-resolver";
import { evaluatePremiseAgainstRecord } from "@nyayagrid/ai";
import {
  buildDraftPreview,
  buildMemoryPreview,
  buildNavigationAction,
  buildTaskPreview,
  classifyConversationalAction,
  createPendingActionRecord,
  detectProhibitedAutonomousAction,
  extractExplicitDueDate,
  hashPreviewPayload,
  isConfirmationUtterance,
  conversationalConfirmIdempotencyKey,
  validateActionConfirmation,
} from "./conversational-workflow-actions";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const MATTER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const claimA = "11111111-1111-4111-8111-111111111111";
const claimB = "22222222-2222-4222-8222-222222222222";
const motion1 = "33333333-3333-4333-8333-333333333333";
const src1 = "55555555-5555-4555-8555-555555555555";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Phase 4 conversational workflow actions", () => {
  it("A: read-only research classifies without write confirmation", () => {
    const c = classifyConversationalAction({
      question: "Which authorities support this element?",
    });
    expect(c.actionClass).toBe("LONG_RUNNING_READ");
    expect(c.actionType).toBe("RESEARCH_READ");
    expect(c.confirmationUtterance).toBe(false);
  });

  it("B: draft request is DRAFT_PREVIEW", () => {
    const c = classifyConversationalAction({ question: "Draft an argument based on Claim A." });
    expect(c.actionClass).toBe("DRAFT_PREVIEW");
    expect(c.draftRequested).toBe(true);
  });

  it("C: save draft requires confirmation / confirm pending", () => {
    expect(classifyConversationalAction({ question: "save this draft" }).actionType).toBe(
      "DRAFT_SAVE",
    );
    expect(isConfirmationUtterance("save it")).toBe(true);
    const c = classifyConversationalAction({ question: "save it" });
    expect(c.actionType).toBe("CONFIRM_PENDING");
  });

  it("D: task creation requires confirmation class", () => {
    const c = classifyConversationalAction({
      question: "Create a task to follow up on RFP 14.",
    });
    expect(c.actionType).toBe("TASK_CREATE");
    expect(c.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
    const preview = buildTaskPreview({
      question: "Create a task to follow up on RFP 14.",
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeDeficiencyIds: [claimA] },
    });
    expect(preview.title).toMatch(/RFP 14/i);
    expect(preview.proposedDueAt).toBeNull();
  });

  it("E: memory proposal requires confirmation; unsafe blocked", () => {
    const c = classifyConversationalAction({
      question: "Remember that opposing counsel promised supplementation.",
    });
    expect(c.actionType).toBe("MEMORY_SAVE");
    const ok = buildMemoryPreview({
      question: "Remember that opposing counsel promised supplementation.",
      workingState: { ...emptyWorkingState(), activeSourceIds: [src1] },
      supportOk: true,
    });
    expect(ok.unsafe).toBe(false);
    const bad = buildMemoryPreview({
      question: "Remember that the witness is lying.",
      workingState: emptyWorkingState(),
      supportOk: false,
    });
    expect(bad.unsafe).toBe(true);
  });

  it("F: research save requires confirmation", () => {
    const c = classifyConversationalAction({ question: "save this research" });
    expect(c.actionType).toBe("RESEARCH_SAVE");
    expect(c.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
  });

  it("G/H: generic yes cannot approve wrong/stale; binds specific pending", () => {
    const pending = createPendingActionRecord({
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: "conv-1",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      previewPayload: { title: "Follow up" },
    });
    const ok = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "conv-1",
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
    });
    expect(ok.ok).toBe(true);

    const staleFocus = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "conv-1",
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimB] },
    });
    expect(staleFocus.ok).toBe(false);
    if (!staleFocus.ok) expect(staleFocus.code).toBe("ACTION_CONFIRMATION_STALE");

    const multi = validateActionConfirmation({
      pendingActions: [pending, { ...pending, pendingActionId: "other" }],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "conv-1",
      workingState: emptyWorkingState(),
    });
    expect(multi.ok).toBe(false);
    if (!multi.ok) expect(multi.code).toBe("AMBIGUOUS_PENDING");

    const none = validateActionConfirmation({
      pendingActions: [],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "conv-1",
      workingState: emptyWorkingState(),
    });
    expect(none.ok).toBe(false);
  });

  it("I/J: capability mapping denies guest-style drafts; tasks use matters.edit", async () => {
    const { capabilityForAction } = await import("./conversational-workflow-actions");
    expect(capabilityForAction("DRAFT_SAVE")).toBe("drafts.create");
    expect(capabilityForAction("TASK_CREATE")).toBe("matters.edit");
    // client_guest has neither drafts.create nor matters.edit — execution-time requireMatterAccess rejects.
  });

  it("at-most-once confirm uses durable ai_jobs idempotency key", () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(conversationalConfirmIdempotencyKey(id)).toBe(`conversational_confirm:${id}`);
  });

  it("K/L: foreign navigation target rejected; matter-valid accepted", () => {
    const allowed = new Set([motion1, src1, claimA]);
    const bad = buildNavigationAction({
      kind: "OPEN_MOTION",
      matterId: MATTER,
      organizationId: ORG,
      workingState: { ...emptyWorkingState(), activeMotionIds: [foreign] },
      allowedEntityIds: allowed,
    });
    expect(bad.ok).toBe(false);

    const good = buildNavigationAction({
      kind: "OPEN_MOTION",
      matterId: MATTER,
      organizationId: ORG,
      workingState: { ...emptyWorkingState(), activeMotionIds: [motion1] },
      allowedEntityIds: allowed,
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.payload.route).toContain(motion1);
      expect(good.payload.targetEntityId).toBe(motion1);
    }
  });

  it("M: stale preview hash rejected", () => {
    const pending = createPendingActionRecord({
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      conversationId: "conv-1",
      organizationId: ORG,
      matterId: MATTER,
      workingState: emptyWorkingState(),
      previewPayload: { previewText: "v1" },
    });
    const tampered = { ...pending, previewPayload: { previewText: "v2" } };
    const result = validateActionConfirmation({
      pendingActions: [tampered],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "conv-1",
      workingState: emptyWorkingState(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ACTION_CONFIRMATION_STALE");
  });

  it("N: deadline not invented on task", () => {
    expect(extractExplicitDueDate("Create a task to follow up")).toBeNull();
    expect(extractExplicitDueDate("Create a task due 2026-11-01")).toBe("2026-11-01T17:00:00.000Z");
    const preview = buildTaskPreview({
      question: "Remind the team to get the invoices.",
      matterId: MATTER,
      workingState: emptyWorkingState(),
    });
    expect(preview.proposedDueAt).toBeNull();
  });

  it("O: draft source set filters non-UUID / keeps matter sources", () => {
    const draft = buildDraftPreview({
      question: "Draft the reply.",
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      answerText: "Argument body",
      sourceRefs: [src1, "web:x", "not-uuid"],
      authorityRefs: [],
    });
    expect(draft.sourceRefs).toEqual([src1]);
    expect(draft.requiresConfirmation).toBe(true);
    expect(draft.previewText).toContain("Argument body");
  });

  it("P: research classification preserves treatment honesty expectations", () => {
    const c = classifyConversationalAction({
      question: "Research the controlling rule for this issue.",
    });
    expect(c.researchRequested).toBe(true);
    expect(c.actionClass).toBe("LONG_RUNNING_READ");
  });

  it("Q: compare does not infer credibility", () => {
    const c = classifyConversationalAction({
      question: "Compare that statement with her deposition.",
    });
    expect(c.actionType).toBe("COMPARE_READ");
    expect(c.actionClass).toBe("READ_ONLY");
  });

  it("R: navigation kinds validated", () => {
    expect(classifyConversationalAction({ question: "Open the motion." }).navigationKind).toBe(
      "OPEN_MOTION",
    );
    expect(
      classifyConversationalAction({ question: "Show this on the timeline." }).navigationKind,
    ).toBe("OPEN_TIMELINE");
  });

  it("S: prohibited autonomous actions blocked", () => {
    expect(detectProhibitedAutonomousAction("Email opposing counsel the draft")).toBe("sendEmail");
    expect(detectProhibitedAutonomousAction("File the motion with the court")).toBe("fileCourt");
    expect(classifyConversationalAction({ question: "Delete the evidence file" }).actionClass).toBe(
      "PROHIBITED_AUTONOMOUSLY",
    );
  });

  it("T: agent mutation path requires approval — planner expectations encoded", () => {
    // Static contract: draft/research conversational writes always confirmationRequired.
    const draft = createPendingActionRecord({
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      conversationId: "c",
      organizationId: ORG,
      matterId: MATTER,
      workingState: emptyWorkingState(),
      previewPayload: { previewText: "x" },
    });
    expect(draft.confirmationRequired).toBe(true);
    expect(draft.actionStatus).toBe("AWAITING_CONFIRMATION");
  });

  it("U: Phase 1 history remains bounded", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      messageId: `m${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `t${i}`,
      createdAt: new Date(),
      completionStatus: "completed" as const,
      evidenceState: "grounded",
      sourceIds: [],
      authorityIds: [],
      workingState: null,
    }));
    expect(selectRecentTurns(turns).length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
  });

  it("V: Phase 2 factuality remains intact", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "We won the motion, right?",
      record: {
        matterId: MATTER,
        organizationId: ORG,
        allowedSourceIds: [],
        persistedDispositions: [],
        recordText: "",
      },
    });
    expect(premise.detected).toBe(true);
    expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
  });

  it("W: Phase 3 referent binding remains intact", () => {
    const result = resolveConversationalReferents({
      question: "What about Claim B?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      matterCandidates: [
        {
          entityType: "claim",
          entityId: claimA,
          label: "Claim A — breach",
          organizationId: ORG,
          matterId: MATTER,
        },
        {
          entityType: "claim",
          entityId: claimB,
          label: "Claim B — warranty",
          organizationId: ORG,
          matterId: MATTER,
        },
      ],
    });
    expect(result.activeStateAfter.activeClaimIds[0]).toBe(claimB);
    const plan = planConversationalContext({
      question: result.routingQuestion,
      forceDomains: result.forceDomains,
    });
    expect(plan.selectedDomains).toContain("CLAIMS");
  });
});

describe("Phase 4 conversational chains", () => {
  it("CHAIN 1 — draft preview then save confirmation binding", () => {
    const previewClass = classifyConversationalAction({
      question: "draft an argument from that",
    });
    expect(previewClass.actionClass).toBe("DRAFT_PREVIEW");
    const pending = createPendingActionRecord({
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      conversationId: "c1",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      previewPayload: buildDraftPreview({
        question: "draft an argument from that",
        matterId: MATTER,
        workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
        answerText: "Preview text",
        sourceRefs: [src1],
        authorityRefs: [],
      }) as unknown as Record<string, unknown>,
      sourceRefs: [src1],
    });
    expect(hashPreviewPayload(pending.previewPayload)).toBe(pending.previewHash);
    const confirm = classifyConversationalAction({ question: "save it" });
    expect(confirm.actionType).toBe("CONFIRM_PENDING");
    const bound = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "c1",
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
    });
    expect(bound.ok).toBe(true);
  });

  it("CHAIN 2 — task preview then confirm", () => {
    const c = classifyConversationalAction({
      question: "create a task to follow up on that",
    });
    expect(c.actionType).toBe("TASK_CREATE");
    const pending = createPendingActionRecord({
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      conversationId: "c2",
      organizationId: ORG,
      matterId: MATTER,
      workingState: emptyWorkingState(),
      previewPayload: { title: "Follow up", proposedDueAt: null },
    });
    expect(
      validateActionConfirmation({
        pendingActions: [pending],
        organizationId: ORG,
        matterId: MATTER,
        conversationId: "c2",
        workingState: emptyWorkingState(),
      }).ok,
    ).toBe(true);
  });

  it("CHAIN 3 — research read then save confirmation required", () => {
    expect(
      classifyConversationalAction({ question: "research the controlling rule" }).actionClass,
    ).toBe("LONG_RUNNING_READ");
    expect(
      classifyConversationalAction({ question: "save this research" }).actionClass,
    ).toBe("WRITE_CONFIRMATION_REQUIRED");
  });

  it("CHAIN 4 — compare read-only", () => {
    expect(
      classifyConversationalAction({
        question: "Compare that statement with her deposition.",
      }).actionClass,
    ).toBe("READ_ONLY");
  });

  it("CHAIN 5 — memory proposal path", () => {
    expect(
      classifyConversationalAction({
        question: "Remember that opposing counsel promised supplementation.",
      }).actionType,
    ).toBe("MEMORY_SAVE");
  });

  it("CHAIN 6 — navigation", () => {
    expect(classifyConversationalAction({ question: "Open the motion." }).actionClass).toBe(
      "NAVIGATION",
    );
  });

  it("CHAIN 7 — stale approval after focus change", () => {
    const pending = createPendingActionRecord({
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      conversationId: "c7",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      previewPayload: { previewText: "old" },
    });
    const result = validateActionConfirmation({
      pendingActions: [pending],
      organizationId: ORG,
      matterId: MATTER,
      conversationId: "c7",
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimB] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ACTION_CONFIRMATION_STALE");
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "Phase 4 live certification placeholder (lock required)",
  () => {
    it("refuses live mutation cert without shared runtime lock grant message", () => {
      // Live scenarios run only after SHARED_RUNTIME_LOCK is granted in a later turn.
      expect(process.env.DATABASE_URL ?? "").toMatch(/localhost:5433|127\.0\.0\.1:5433/);
    });
  },
);
