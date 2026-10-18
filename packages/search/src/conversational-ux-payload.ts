/**
 * Phase 5 — Build Ask SSE UX payload from Phase 3/4 artifacts.
 * No hidden reasoning. No schema migration.
 */
import type { AskUxPayload } from "@nyayagrid/ai";
import type { ConversationalActionRecord } from "./conversational-workflow-actions";
import type { ReferentResolutionResult } from "./conversational-referent-resolver";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function actionSummary(action: ConversationalActionRecord): string {
  const preview = asRecord(action.previewPayload);
  if (typeof preview.previewText === "string" && preview.previewText.trim()) {
    return preview.previewText.trim().slice(0, 400);
  }
  if (typeof preview.title === "string" && preview.title.trim()) {
    return preview.title.trim().slice(0, 200);
  }
  if (typeof preview.content === "string" && preview.content.trim()) {
    return preview.content.trim().slice(0, 400);
  }
  if (action.failureReason) return action.failureReason;
  return `${action.actionType.replace(/_/g, " ").toLowerCase()} · ${action.actionStatus}`;
}

function targetLabel(action: ConversationalActionRecord): string | undefined {
  const preview = asRecord(action.previewPayload);
  if (typeof preview.title === "string" && preview.title.trim()) return preview.title.trim();
  if (typeof preview.label === "string" && preview.label.trim()) return preview.label.trim();
  if (typeof preview.requestedPurpose === "string" && preview.requestedPurpose.trim()) {
    return preview.requestedPurpose.trim().slice(0, 120);
  }
  return undefined;
}

export function buildAskUxPayload(params: {
  matterId: string;
  factualityTypes?: string[];
  conversationalAction?: ConversationalActionRecord | null;
  referentResolution?: ReferentResolutionResult | null;
  cancelled?: boolean;
  /** Already-computed investigate-next validation snapshot (no new reasoning). */
  investigateNext?: Record<string, unknown> | null;
  /** Already-computed matter synthesis validation snapshot (no new reasoning). */
  matterSynthesis?: Record<string, unknown> | null;
}): AskUxPayload {
  const ux: AskUxPayload = {};
  if (params.factualityTypes?.length) {
    ux.factualityTypes = [...new Set(params.factualityTypes)].slice(0, 6);
  }
  if (params.investigateNext && typeof params.investigateNext === "object") {
    ux.investigateNext = params.investigateNext;
  }
  if (params.matterSynthesis && typeof params.matterSynthesis === "object") {
    ux.matterSynthesis = params.matterSynthesis;
  }

  const finish = (payload: AskUxPayload): AskUxPayload => payload;

  if (params.cancelled) {
    ux.turnKind = "cancelled";
    return finish(ux);
  }

  const referent = params.referentResolution;
  if (referent?.status === "AMBIGUOUS" && referent.candidates.length > 0) {
    ux.turnKind = "ambiguity";
    ux.ambiguity = {
      prompt: referent.clarificationPrompt ?? "Which one do you mean?",
      // Labels only — never expose raw UUIDs in Command Center choices.
      choices: referent.candidates.slice(0, 6).map((c) => ({
        label: c.label,
        entityType: c.entityType,
      })),
    };
    return finish(ux);
  }

  const action = params.conversationalAction;
  if (!action) {
    ux.turnKind = "answer";
    return finish(ux);
  }

  if (action.actionClass === "PROHIBITED_AUTONOMOUSLY" || action.actionStatus === "PROHIBITED") {
    ux.turnKind = "prohibited";
    ux.action = {
      pendingActionId: action.pendingActionId,
      actionType: action.actionType,
      actionClass: action.actionClass,
      actionStatus: action.actionStatus,
      workflowStatus: action.workflowStatus,
      confirmationRequired: false,
      summary: action.failureReason ?? "This action cannot be performed autonomously.",
      failureReason: action.failureReason,
    };
    return finish(ux);
  }

  if (action.actionClass === "NAVIGATION") {
    const nav = asRecord(action.previewPayload);
    const route = typeof nav.route === "string" ? nav.route : "";
    const label = typeof nav.label === "string" ? nav.label : "workspace item";
    const kind = typeof nav.kind === "string" ? nav.kind : "NAVIGATE";
    ux.turnKind = "navigation";
    ux.navigation = { kind, route, label };
    ux.action = {
      pendingActionId: action.pendingActionId,
      actionType: action.actionType,
      actionClass: action.actionClass,
      actionStatus: action.actionStatus,
      workflowStatus: action.workflowStatus,
      confirmationRequired: false,
      summary: `Open ${label}`,
      targetLabel: label,
    };
    return finish(ux);
  }

  const awaiting =
    action.confirmationRequired &&
    (action.actionStatus === "AWAITING_CONFIRMATION" ||
      action.actionStatus === "PREVIEW" ||
      action.actionStatus === "ACTION_CONFIRMATION_STALE");

  ux.turnKind =
    action.actionStatus === "COMPLETED"
      ? "action_result"
      : awaiting
        ? "action_preview"
        : "answer";

  const draftId =
    typeof asRecord(action.executionResult).draftId === "string"
      ? (asRecord(action.executionResult).draftId as string)
      : typeof asRecord(action.previewPayload).targetExistingDraftId === "string"
        ? (asRecord(action.previewPayload).targetExistingDraftId as string)
        : null;

  ux.action = {
    pendingActionId: action.pendingActionId,
    actionType: action.actionType,
    actionClass: action.actionClass,
    actionStatus: action.actionStatus,
    workflowStatus: action.workflowStatus,
    confirmationRequired: action.confirmationRequired,
    summary: actionSummary(action),
    targetLabel: targetLabel(action),
    sourceCount: action.sourceRefs.length,
    failureReason: action.failureReason,
    draftRoute: draftId
      ? `/app/cases/${params.matterId}/draft?draftId=${encodeURIComponent(draftId)}`
      : `/app/cases/${params.matterId}/draft`,
  };
  return finish(ux);
}
