/**
 * Phase 4 — Conversational workflow action classification + confirmation-gated writes.
 * Reuses ai_artifacts.validation + agent_runs/agent_approvals. No schema migration.
 * CourtListener: 0.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  aiJobs,
  and,
  eq,
  sql,
  tasks,
  agentApprovals,
  agentRuns,
  type Database,
} from "@nyayagrid/database";
import { createDraft, createMatterMemory } from "@nyayagrid/intelligence";
import { createLogger } from "@nyayagrid/observability";
import {
  AuthorizationError,
  requireMatterAccess,
  writeAuditEvent,
} from "@nyayagrid/permissions";

const confirmLog = createLogger("conversational-confirm");
import type { ConversationWorkingState } from "./conversation-context";
import type { ReferentResolutionResult } from "./conversational-referent-resolver";
import {
  isHearingCompressionRequest,
  isHearingOutlineRequest,
  isHearingPrepQuestion,
} from "./conversational-hearing-prep";
import {
  isDepositionContinuityQuestion,
  isDepositionOutlineRequest,
  isDepositionPrepQuestion,
} from "./conversational-deposition-prep";
import {
  isConversationalDraftQuestion,
  isResearchToDraftRequest,
  isResearchWorkflowQuestion,
} from "./conversational-draft-research";

export const CONVERSATIONAL_ACTION_CLASSES = [
  "READ_ONLY",
  "DRAFT_PREVIEW",
  "WRITE_CONFIRMATION_REQUIRED",
  "NAVIGATION",
  "LONG_RUNNING_READ",
  "PROHIBITED_AUTONOMOUSLY",
] as const;
export type ConversationalActionClass = (typeof CONVERSATIONAL_ACTION_CLASSES)[number];

export const CONVERSATIONAL_ACTION_TYPES = [
  "NONE",
  "RESEARCH_READ",
  "COMPARE_READ",
  "DEPOSITION_PREP_PREVIEW",
  "HEARING_PREP_READ",
  "MEMORY_INSPECT",
  "GRAPH_SHOW",
  "TIMELINE_SHOW",
  "DRAFT_GENERATE_PREVIEW",
  "DRAFT_SAVE",
  "DRAFT_REVISE_PREVIEW",
  "TASK_CREATE",
  "MEMORY_SAVE",
  "RESEARCH_SAVE",
  "NAVIGATE",
  "PROHIBITED",
  "CONFIRM_PENDING",
] as const;
export type ConversationalActionType = (typeof CONVERSATIONAL_ACTION_TYPES)[number];

export const CONVERSATIONAL_ACTION_STATUSES = [
  "NONE",
  "PREVIEW",
  "AWAITING_CONFIRMATION",
  "APPROVED",
  "EXECUTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "PROHIBITED",
  "ACTION_CONFIRMATION_STALE",
] as const;
export type ConversationalActionStatus = (typeof CONVERSATIONAL_ACTION_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = [
  "PLANNED",
  "RUNNING",
  "AWAITING_CONFIRMATION",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const NAVIGATION_KINDS = [
  "OPEN_SOURCE",
  "OPEN_CLAIM",
  "OPEN_DISCOVERY",
  "OPEN_COMMUNICATION",
  "OPEN_MOTION",
  "OPEN_TIMELINE",
  "OPEN_GRAPH",
  "OPEN_AUTHORITY",
  "OPEN_RESEARCH",
  "OPEN_DRAFT",
  "OPEN_TASK",
] as const;
export type NavigationKind = (typeof NAVIGATION_KINDS)[number];

export type DraftIntentPayload = {
  draftType: string;
  targetMatter: string;
  relatedEntities: string[];
  sourceRefs: string[];
  authorityRefs: string[];
  requestedPurpose: string;
  previewText: string;
  requiresConfirmation: true;
  targetExistingDraftId: string | null;
};

export type TaskPreviewPayload = {
  title: string;
  description: string;
  linkedEntityIds: string[];
  linkedSourceIds: string[];
  proposedDueAt: string | null;
  assigneeUserId: string | null;
  matterId: string;
};

export type MemoryPreviewPayload = {
  title: string;
  content: string;
  memoryType: "strategic_note" | "factual_caveat" | "user_instruction" | "other";
  supportStatus: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
  sourceRefs: string[];
  unsafe: boolean;
  unsafeReason: string | null;
};

export type NavigationPayload = {
  kind: NavigationKind;
  route: string;
  targetEntityId: string | null;
  label: string;
};

export type ConversationalActionRecord = {
  pendingActionId: string;
  actionType: ConversationalActionType;
  actionClass: ConversationalActionClass;
  actionStatus: ConversationalActionStatus;
  workflowStatus: WorkflowRunStatus;
  conversationId: string;
  organizationId: string;
  matterId: string;
  targetEntityIds: string[];
  sourceRefs: string[];
  authorityRefs: string[];
  previewPayload: Record<string, unknown>;
  previewHash: string;
  confirmationRequired: boolean;
  agentRunId: string | null;
  agentApprovalId: string | null;
  activeSnapshot: Record<string, string[]>;
  executionResult: Record<string, unknown> | null;
  failureReason: string | null;
  createdAt: string;
  classificationLatencyMs: number;
};

export type ActionClassification = {
  actionType: ConversationalActionType;
  actionClass: ConversationalActionClass;
  confirmationUtterance: boolean;
  navigationKind: NavigationKind | null;
  draftRequested: boolean;
  researchRequested: boolean;
  compareRequested: boolean;
  taskRequested: boolean;
  memoryRequested: boolean;
  prohibitedReason: string | null;
  latencyMs: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Stable JSON for hashing — Postgres jsonb may reorder object keys on round-trip. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashPreviewPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 32);
}

export function isConfirmationUtterance(question: string): boolean {
  const q = question.trim();
  // Short confirmations bind to the pending preview.
  // Typed phrases like "save this research" are classified as write intents separately.
  return (
    /^(yes|yep|yeah|confirm|approved?|do it|proceed|go ahead)([.,!\s]|$)/i.test(q) ||
    /^(yes[, ]+)?(save it|create it|add it|do it|confirm it)\b/i.test(q) ||
    /^(yes[, ]+)?(create|add) the task\b/i.test(q)
  );
}

/** Explicit cancel of a pending preview — never executes the write. */
export function isCancelUtterance(question: string): boolean {
  const q = question.trim();
  return (
    /^(cancel|never mind|nevermind|dismiss|forget it)([.,!\s]|$)/i.test(q) ||
    /^(don'?t|do not)\s+(save|create|confirm|proceed)\b/i.test(q) ||
    /^cancel (that|it|this|the (draft|task|preview|action))\b/i.test(q)
  );
}

export function detectProhibitedAutonomousAction(question: string): string | null {
  if (/\b(send|email|mail)\b.+\b(counsel|client|court|opposing)\b/i.test(question)) {
    return "sendEmail";
  }
  if (/\b(file|e-?file|submit)\b.+\b(court|motion|pleading)\b/i.test(question)) {
    return "fileCourt";
  }
  if (/\b(call|contact|phone|text)\b.+\b(opposing|witness|client)\b/i.test(question)) {
    return "contactExternal";
  }
  if (/\b(approve|waive)\b.+\bprivilege\b/i.test(question)) return "approvePrivilege";
  if (/\b(delete|destroy|shred)\b.+\b(evidence|document|exhibit)\b/i.test(question)) {
    return "deleteEvidence";
  }
  if (/\b(pay|payment|wire|invoice settle)\b/i.test(question)) return "makePayment";
  if (/\b(charge|decline to charge|indict)\b.+\b(defendant|suspect)\b/i.test(question)) {
    return "finalChargingDecision";
  }
  if (/\b(recommend|advise)\b.+\b(plea|sentence|sentencing)\b/i.test(question)) {
    return "autonomousPleaSentencing";
  }
  return null;
}

export function classifyConversationalAction(params: {
  question: string;
  referent?: ReferentResolutionResult | null;
}): ActionClassification {
  const started = Date.now();
  const q = params.question.trim();
  const prohibited = detectProhibitedAutonomousAction(q);
  if (prohibited) {
    return {
      actionType: "PROHIBITED",
      actionClass: "PROHIBITED_AUTONOMOUSLY",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: prohibited,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  const confirmationUtterance = isConfirmationUtterance(q);
  if (confirmationUtterance) {
    return {
      actionType: "CONFIRM_PENDING",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      confirmationUtterance: true,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  const nav = detectNavigation(q);
  if (nav) {
    return {
      actionType: "NAVIGATE",
      actionClass: "NAVIGATION",
      confirmationUtterance: false,
      navigationKind: nav,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (
    /\b(create|add|make)\b.+\btask\b/i.test(q) ||
    /\bturn #?\d+ into a task\b/i.test(q) ||
    /\bremind the team\b/i.test(q) ||
    (/\bfollow up on\b/i.test(q) && /\btask\b/i.test(q))
  ) {
    return {
      actionType: "TASK_CREATE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: true,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (
    /\b(remember|save this as (an )?issue|save to memory|remember that)\b/i.test(q) ||
    /\bremember that\b/i.test(q)
  ) {
    return {
      actionType: "MEMORY_SAVE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: true,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (/\bsave (this |the )?research\b/i.test(q) || /\bsave (the )?research (session|artifact)\b/i.test(q)) {
    return {
      actionType: "RESEARCH_SAVE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: true,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (/\bsave (this |the )?draft\b|\bsave it\b/i.test(q)) {
    return {
      actionType: "DRAFT_SAVE",
      actionClass: "WRITE_CONFIRMATION_REQUIRED",
      confirmationUtterance: true,
      navigationKind: null,
      draftRequested: true,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  // Hearing outline / oral-argument compression → DRAFT_PREVIEW (save still confirmation-gated).
  if (
    isHearingOutlineRequest(q) ||
    (isHearingCompressionRequest(q) != null && /\b(outline|oral argument|version|bullet)\b/i.test(q)) ||
    (/\b(draft|write)\b/i.test(q) && /\bhearing outline\b/i.test(q))
  ) {
    return {
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: true,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  // Deposition outline → DRAFT_PREVIEW (save still confirmation-gated).
  if (
    isDepositionOutlineRequest(q) ||
    (/\b(draft|write|turn this into)\b/i.test(q) && /\bdeposition outline\b/i.test(q))
  ) {
    return {
      actionType: "DEPOSITION_PREP_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: true,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  // Phase 3 — research→draft / grounded conversational draft → DRAFT_PREVIEW.
  if (
    isResearchToDraftRequest(q) ||
    isConversationalDraftQuestion(q) ||
    Boolean(params.referent?.draftIntentPreview?.requested)
  ) {
    if (
      /\b(draft|write|revise|turn .+ into|factual background|argument section|research memo|make (it |this )?(stronger|more persuasive|shorter)|remove anything|rewrite paragraph|only use)\b/i.test(
        q,
      ) ||
      Boolean(params.referent?.draftIntentPreview?.requested)
    ) {
      return {
        actionType: "DRAFT_GENERATE_PREVIEW",
        actionClass: "DRAFT_PREVIEW",
        confirmationUtterance: false,
        navigationKind: null,
        draftRequested: true,
        researchRequested: false,
        compareRequested: false,
        taskRequested: false,
        memoryRequested: false,
        prohibitedReason: null,
        latencyMs: Math.max(0, Date.now() - started),
      };
    }
  }

  const draftRequested =
    Boolean(params.referent?.draftIntentPreview?.requested) ||
    /\b(draft|write|turn this into|revise the draft)\b/i.test(q);
  if (
    draftRequested &&
    /\b(draft|write|revise|turn this into|motion section|argument|reply)\b/i.test(q) &&
    !isDepositionPrepQuestion(q) &&
    !isDepositionContinuityQuestion(q)
  ) {
    return {
      actionType: "DRAFT_GENERATE_PREVIEW",
      actionClass: "DRAFT_PREVIEW",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: true,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  // Hearing preparation itself is READ_ONLY (evaluate the record; no writes).
  if (isHearingPrepQuestion(q)) {
    return {
      actionType: "HEARING_PREP_READ",
      actionClass: "READ_ONLY",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (/\bcompare\b/i.test(q)) {
    return {
      actionType: "COMPARE_READ",
      actionClass: "READ_ONLY",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: true,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  // Deposition preparation / analysis is READ_ONLY (evaluate the record; no writes).
  const hasPersonReferent = Boolean(
    params.referent?.referents.some((r) => r.entityType === "person" && r.entityId),
  );
  if (
    isDepositionPrepQuestion(q) ||
    (isDepositionContinuityQuestion(q) && hasPersonReferent)
  ) {
    return {
      actionType: "DEPOSITION_PREP_PREVIEW",
      actionClass: "READ_ONLY",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: false,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  if (
    isResearchWorkflowQuestion(q) ||
    /\b(research|controlling (case|authority|rule)|find (controlling )?cases|which (cases|authorities) support)\b/i.test(
      q,
    )
  ) {
    return {
      actionType: "RESEARCH_READ",
      actionClass: "LONG_RUNNING_READ",
      confirmationUtterance: false,
      navigationKind: null,
      draftRequested: false,
      researchRequested: true,
      compareRequested: false,
      taskRequested: false,
      memoryRequested: false,
      prohibitedReason: null,
      latencyMs: Math.max(0, Date.now() - started),
    };
  }

  return {
    actionType: "NONE",
    actionClass: "READ_ONLY",
    confirmationUtterance: false,
    navigationKind: null,
    draftRequested: false,
    researchRequested: false,
    compareRequested: false,
    taskRequested: false,
    memoryRequested: false,
    prohibitedReason: null,
    latencyMs: Math.max(0, Date.now() - started),
  };
}

function detectNavigation(question: string): NavigationKind | null {
  if (/\b(open|show|take me to)\b.+\bmotion\b/i.test(question) || /\bopen the motion\b/i.test(question)) {
    return "OPEN_MOTION";
  }
  if (
    /\b(open|show|take me to)\b.+\bdiscovery\b/i.test(question) ||
    /\bopen\s+RFP\b/i.test(question)
  ) {
    return "OPEN_DISCOVERY";
  }
  if (/\b(show|open).+\btimeline\b|\bshow this on the timeline\b/i.test(question)) {
    return "OPEN_TIMELINE";
  }
  if (/\b(open|show).+\bgraph\b/i.test(question)) return "OPEN_GRAPH";
  if (/\b(open|show).+\b(source|document|exhibit)\b/i.test(question)) return "OPEN_SOURCE";
  if (/\b(open|show).+\bclaim\b/i.test(question)) return "OPEN_CLAIM";
  if (/\b(open|show).+\b(authority|case law)\b/i.test(question)) return "OPEN_AUTHORITY";
  if (/\b(open|take me to)\b.+\bresearch\b/i.test(question)) return "OPEN_RESEARCH";
  if (/\b(open|take me to)\b.+\bdraft\b/i.test(question)) return "OPEN_DRAFT";
  if (/\b(open|show).+\btask\b/i.test(question)) return "OPEN_TASK";
  if (/\b(open|show).+\bcommunication\b/i.test(question)) return "OPEN_COMMUNICATION";
  return null;
}

export function buildNavigationAction(params: {
  kind: NavigationKind;
  matterId: string;
  organizationId: string;
  workingState: ConversationWorkingState;
  allowedEntityIds: ReadonlySet<string>;
  foreignRejectedIds?: string[];
}): { ok: true; payload: NavigationPayload } | { ok: false; reason: string } {
  const pickFirst = (ids: string[]): string | null => {
    for (const id of ids) {
      if (params.allowedEntityIds.has(id) && UUID_RE.test(id)) return id;
    }
    return null;
  };

  let target: string | null = null;
  let route = `/app/cases/${params.matterId}`;
  let label = "Matter";

  switch (params.kind) {
    case "OPEN_MOTION":
      target = pickFirst(params.workingState.activeMotionIds);
      if (!target) return { ok: false, reason: "No validated motion target in active context." };
      route = `/app/cases/${params.matterId}/motions/${target}`;
      label = "Motion";
      break;
    case "OPEN_DISCOVERY":
      target =
        pickFirst(params.workingState.activeDeficiencyIds) ??
        pickFirst(params.workingState.activeDiscoveryIds);
      route = `/app/cases/${params.matterId}/discovery`;
      label = "Discovery";
      break;
    case "OPEN_TIMELINE":
      route = `/app/cases/${params.matterId}/timeline`;
      label = "Timeline";
      break;
    case "OPEN_GRAPH":
      route = `/app/cases/${params.matterId}/graph`;
      label = "Graph";
      break;
    case "OPEN_SOURCE":
      target = pickFirst(params.workingState.activeSourceIds);
      if (!target) return { ok: false, reason: "No validated source target in active context." };
      route = `/app/cases/${params.matterId}/documents`;
      label = "Source";
      break;
    case "OPEN_CLAIM":
      target = pickFirst(params.workingState.activeClaimIds);
      if (!target) return { ok: false, reason: "No validated claim target in active context." };
      route = `/app/cases/${params.matterId}/claims`;
      label = "Claim";
      break;
    case "OPEN_AUTHORITY":
      target = pickFirst(params.workingState.activeAuthorityIds);
      route = target
        ? `/app/research/authorities/${target}`
        : `/app/cases/${params.matterId}/research`;
      label = "Authority";
      break;
    case "OPEN_RESEARCH":
      route = `/app/cases/${params.matterId}/research`;
      label = "Research";
      break;
    case "OPEN_DRAFT":
      route = `/app/cases/${params.matterId}/draft`;
      label = "Draft";
      break;
    case "OPEN_TASK":
      route = `/app/cases/${params.matterId}/tasks`;
      label = "Tasks";
      break;
    case "OPEN_COMMUNICATION":
      target = pickFirst(params.workingState.activeCommunicationIds);
      route = target
        ? `/app/cases/${params.matterId}/communications/${target}`
        : `/app/cases/${params.matterId}/communications`;
      label = "Communication";
      break;
  }

  if (target && !params.allowedEntityIds.has(target)) {
    return { ok: false, reason: "Navigation target failed matter/org validation." };
  }

  return {
    ok: true,
    payload: {
      kind: params.kind,
      route,
      targetEntityId: target,
      label,
    },
  };
}

export function extractExplicitDueDate(question: string): string | null {
  const iso = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return `${iso[1]}T17:00:00.000Z`;
  return null;
}

export function buildDraftPreview(params: {
  question: string;
  matterId: string;
  workingState: ConversationWorkingState;
  answerText: string;
  sourceRefs: string[];
  authorityRefs: string[];
}): DraftIntentPayload {
  const draftType = /\bmotion\b/i.test(params.question)
    ? "motion"
    : /\breply|correspondence|letter\b/i.test(params.question)
      ? "letter"
      : /\bmemo\b/i.test(params.question)
        ? "memo"
        : "argument";
  return {
    draftType,
    targetMatter: params.matterId,
    relatedEntities: [
      ...params.workingState.activeClaimIds,
      ...params.workingState.activeMotionIds,
    ].slice(0, 8),
    sourceRefs: params.sourceRefs.filter((id) => UUID_RE.test(id)).slice(0, 12),
    authorityRefs: params.authorityRefs.slice(0, 8),
    requestedPurpose: params.question.slice(0, 400),
    previewText: params.answerText.slice(0, 12_000),
    requiresConfirmation: true,
    targetExistingDraftId: null,
  };
}

export function buildTaskPreview(params: {
  question: string;
  matterId: string;
  workingState: ConversationWorkingState;
}): TaskPreviewPayload {
  const linked = [
    ...params.workingState.activeDeficiencyIds,
    ...params.workingState.activeDiscoveryIds,
    ...params.workingState.activeClaimIds,
    ...params.workingState.activeMotionIds,
  ].slice(0, 6);
  const rfp = params.question.match(/\bRFP\s*#?\s*(\d+)\b/i);
  const title = rfp
    ? `Follow up on RFP ${rfp[1]}`
    : params.question.replace(/^(create|add|make)\s+(a\s+)?task\s+(to\s+)?/i, "").slice(0, 200) ||
      "Follow-up task";
  return {
    title: title.slice(0, 200),
    description: `Conversational task proposal from Ask. Linked entities: ${linked.join(", ") || "none"}.`,
    linkedEntityIds: linked,
    linkedSourceIds: params.workingState.activeSourceIds.slice(0, 8),
    proposedDueAt: extractExplicitDueDate(params.question),
    assigneeUserId: null,
    matterId: params.matterId,
  };
}

export function buildMemoryPreview(params: {
  question: string;
  workingState: ConversationWorkingState;
  supportOk: boolean;
}): MemoryPreviewPayload {
  const content = params.question
    .replace(/^remember( that)?\s+/i, "")
    .replace(/^save this as (an )?issue[:\s]*/i, "")
    .trim()
    .slice(0, 2000);
  const credibilityUnsafe = /\b(lied|lying|liar|dishonest|unreliable witness)\b/i.test(content);
  const outcomeUnsafe = /\b(will win|guaranteed outcome|certain to)\b/i.test(content);
  const treatmentUnsafe = /\b(overruled|still good law|bad law)\b/i.test(content);
  const blocked = credibilityUnsafe || outcomeUnsafe || treatmentUnsafe;
  return {
    title: content.slice(0, 120) || "Matter note",
    content: content || "Matter note",
    memoryType: blocked ? "other" : "strategic_note",
    supportStatus: blocked ? "UNSUPPORTED" : params.supportOk ? "SUPPORTED" : "UNKNOWN",
    sourceRefs: params.workingState.activeSourceIds.slice(0, 8),
    unsafe: blocked,
    unsafeReason: blocked
      ? credibilityUnsafe
        ? "Credibility judgments cannot be saved as matter memory."
        : outcomeUnsafe
          ? "Predicted outcomes cannot be saved as matter memory."
          : "Unsupported treatment claims cannot be saved as matter memory."
      : null,
  };
}

export function buildComparePreview(params: {
  question: string;
  leftIds: string[];
  rightIds: string[];
  differences: Array<{ kind: "SAME" | "DIFFERENCE" | "CONFLICT" | "MISSING_CONTEXT"; text: string; sourceIds: string[] }>;
}): Record<string, unknown> {
  return {
    leftEntityIds: params.leftIds,
    rightEntityIds: params.rightIds,
    differences: params.differences,
    credibilityConclusion: null,
    note: "Differences are source-backed observations only; conflict ≠ dishonesty.",
  };
}

function activeSnapshot(state: ConversationWorkingState): Record<string, string[]> {
  return {
    claims: [...state.activeClaimIds],
    defenses: [...state.activeDefenseIds],
    motions: [...state.activeMotionIds],
    deficiencies: [...state.activeDeficiencyIds],
    authorities: [...state.activeAuthorityIds],
    sources: [...state.activeSourceIds],
    persons: [...state.activePersonIds],
    drafts: [...state.activeDraftIds],
    researchIssues: [...state.activeResearchIssueIds],
    investigateGaps: [...state.activeInvestigateGapIds],
    lastWorkflow: state.lastWorkflowKind ? [state.lastWorkflowKind] : [],
  };
}

export function createPendingActionRecord(params: {
  actionType: ConversationalActionType;
  actionClass: ConversationalActionClass;
  conversationId: string;
  organizationId: string;
  matterId: string;
  workingState: ConversationWorkingState;
  previewPayload: Record<string, unknown>;
  sourceRefs?: string[];
  authorityRefs?: string[];
  targetEntityIds?: string[];
  classificationLatencyMs?: number;
  agentRunId?: string | null;
  agentApprovalId?: string | null;
}): ConversationalActionRecord {
  const previewHash = hashPreviewPayload(params.previewPayload);
  return {
    pendingActionId: randomUUID(),
    actionType: params.actionType,
    actionClass: params.actionClass,
    actionStatus: "AWAITING_CONFIRMATION",
    workflowStatus: "AWAITING_CONFIRMATION",
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    targetEntityIds: params.targetEntityIds ?? [],
    sourceRefs: params.sourceRefs ?? [],
    authorityRefs: params.authorityRefs ?? [],
    previewPayload: params.previewPayload,
    previewHash,
    confirmationRequired: true,
    agentRunId: params.agentRunId ?? null,
    agentApprovalId: params.agentApprovalId ?? null,
    activeSnapshot: activeSnapshot(params.workingState),
    executionResult: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
    classificationLatencyMs: params.classificationLatencyMs ?? 0,
  };
}

export function parseConversationalAction(raw: unknown): ConversationalActionRecord | null {
  const obj = asRecord(raw);
  if (typeof obj.pendingActionId !== "string" || typeof obj.previewHash !== "string") return null;
  if (typeof obj.actionType !== "string" || typeof obj.actionClass !== "string") return null;
  return obj as unknown as ConversationalActionRecord;
}

export function loadPendingActionFromValidation(validation: unknown): ConversationalActionRecord | null {
  const v = asRecord(validation);
  const action = parseConversationalAction(v.conversationalAction);
  if (!action) return null;
  if (action.actionStatus !== "AWAITING_CONFIRMATION" && action.actionStatus !== "PREVIEW") {
    return null;
  }
  return action;
}

/**
 * Collect open pending actions from newest→oldest artifact validations.
 * Completed/failed/cancelled ids suppress older matching pending rows.
 */
export function collectPendingActionsFromValidations(
  validations: unknown[],
): ConversationalActionRecord[] {
  const completedIds = new Set<string>();
  const pending: ConversationalActionRecord[] = [];
  const seenPending = new Set<string>();
  for (const raw of validations) {
    const action = parseConversationalAction(asRecord(raw).conversationalAction);
    if (!action) continue;
    if (
      action.actionStatus === "COMPLETED" ||
      action.actionStatus === "FAILED" ||
      action.actionStatus === "CANCELLED" ||
      action.actionStatus === "PROHIBITED"
    ) {
      completedIds.add(action.pendingActionId);
      const extra = action.executionResult?.cancelledPendingActionIds;
      if (Array.isArray(extra)) {
        for (const id of extra) {
          if (typeof id === "string" && id) completedIds.add(id);
        }
      }
      continue;
    }
    if (action.actionStatus !== "AWAITING_CONFIRMATION" && action.actionStatus !== "PREVIEW") {
      continue;
    }
    if (completedIds.has(action.pendingActionId)) continue;
    if (seenPending.has(action.pendingActionId)) continue;
    seenPending.add(action.pendingActionId);
    pending.push(action);
  }
  return pending;
}

export type ConfirmationValidationResult =
  | { ok: true; pending: ConversationalActionRecord }
  | {
      ok: false;
      code: "ACTION_CONFIRMATION_STALE" | "NO_PENDING_ACTION" | "AMBIGUOUS_PENDING" | "SCOPE_MISMATCH";
      reason: string;
    };

export function validateActionConfirmation(params: {
  pendingActions: ConversationalActionRecord[];
  organizationId: string;
  matterId: string;
  conversationId: string;
  workingState: ConversationWorkingState;
  /** When topic/target materially changed since preview. */
  focusChanged?: boolean;
}): ConfirmationValidationResult {
  const pending = params.pendingActions.filter(
    (a) =>
      a.actionStatus === "AWAITING_CONFIRMATION" || a.actionStatus === "PREVIEW",
  );
  if (pending.length === 0) {
    return { ok: false, code: "NO_PENDING_ACTION", reason: "No pending conversational action to confirm." };
  }
  if (pending.length > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS_PENDING",
      reason: "Multiple pending actions exist; name the specific action to confirm.",
    };
  }
  const action = pending[0]!;
  if (
    action.organizationId !== params.organizationId ||
    action.matterId !== params.matterId ||
    action.conversationId !== params.conversationId
  ) {
    return { ok: false, code: "SCOPE_MISMATCH", reason: "Pending action is outside this conversation scope." };
  }
  if (params.focusChanged) {
    return {
      ok: false,
      code: "ACTION_CONFIRMATION_STALE",
      reason: "Active target changed since the preview; regenerate before confirming.",
    };
  }
  const snap = action.activeSnapshot;
  // Stale when primary focus changed, was cleared, or original id is no longer primary/active.
  const drifted = (key: string, active: string[]) => {
    const priorPrimary = snap[key]?.[0];
    if (!priorPrimary) return false;
    if (active.length === 0) return true;
    if (active[0] !== priorPrimary) return true;
    return !active.includes(priorPrimary);
  };
  const claimDrift = drifted("claims", params.workingState.activeClaimIds);
  const motionDrift = drifted("motions", params.workingState.activeMotionIds);
  const personDrift = drifted("persons", params.workingState.activePersonIds);
  const draftDrift = drifted("drafts", params.workingState.activeDraftIds);
  const researchDrift = drifted("researchIssues", params.workingState.activeResearchIssueIds);
  const investigateDrift = drifted("investigateGaps", params.workingState.activeInvestigateGapIds);
  const sourceDrift = drifted("sources", params.workingState.activeSourceIds);
  if (
    claimDrift ||
    motionDrift ||
    personDrift ||
    draftDrift ||
    researchDrift ||
    investigateDrift ||
    sourceDrift
  ) {
    return {
      ok: false,
      code: "ACTION_CONFIRMATION_STALE",
      reason: "Referent focus drifted from the pending preview.",
    };
  }
  const expectedHash = hashPreviewPayload(action.previewPayload);
  if (expectedHash !== action.previewHash) {
    return {
      ok: false,
      code: "ACTION_CONFIRMATION_STALE",
      reason: "Preview payload hash mismatch.",
    };
  }
  return { ok: true, pending: action };
}

export function detectMaterialFocusChange(params: {
  priorPending: ConversationalActionRecord | null;
  question: string;
  workingStateBeforeConfirm: ConversationWorkingState;
}): boolean {
  if (!params.priorPending) return false;
  // Explicit topic switch language before yes.
  if (
    /\b(instead|different|claim b|other motion|never ?mind|switch to|focus on)\b/i.test(
      params.question,
    )
  ) {
    return true;
  }
  const snap = params.priorPending.activeSnapshot;
  const drift = (key: string, active: string[]) => {
    const priorPrimary = snap[key]?.[0];
    if (!priorPrimary) return false;
    if (active.length === 0) return true;
    return active[0] !== priorPrimary || !active.includes(priorPrimary);
  };
  return (
    drift("claims", params.workingStateBeforeConfirm.activeClaimIds) ||
    drift("motions", params.workingStateBeforeConfirm.activeMotionIds) ||
    drift("persons", params.workingStateBeforeConfirm.activePersonIds) ||
    drift("drafts", params.workingStateBeforeConfirm.activeDraftIds) ||
    drift("researchIssues", params.workingStateBeforeConfirm.activeResearchIssueIds) ||
    drift("investigateGaps", params.workingStateBeforeConfirm.activeInvestigateGapIds) ||
    drift("sources", params.workingStateBeforeConfirm.activeSourceIds)
  );
}

async function ensureConversationalAgentRun(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  goal: string;
}): Promise<string> {
  const [run] = await params.db
    .insert(agentRuns)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      goal: params.goal.slice(0, 2000),
      agentMode: "ask",
      intent: "conversational_workflow",
      status: "awaiting_approval",
      planVersion: 1,
      plan: { steps: [] },
      userFacingPlan: "Conversational Command Center write confirmation",
      limitations: ["Write executes only after explicit user confirmation in chat."],
      budgets: {},
    })
    .returning();
  return run!.id;
}

async function createPendingApprovalRow(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  runId: string;
  actionType: "CREATE_TASK" | "SAVE_MEMORY" | "CREATE_DRAFT" | "OTHER";
  proposedData: Record<string, unknown>;
  riskLevel?: "low" | "medium" | "high";
}): Promise<string> {
  const [row] = await params.db
    .insert(agentApprovals)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      runId: params.runId,
      actionType: params.actionType,
      proposedData: params.proposedData,
      rationale: "Conversational Command Center confirmation-gated write",
      provenance: [],
      riskLevel: params.riskLevel ?? "high",
      status: "pending",
    })
    .returning();
  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "agent.approval.created",
    targetType: "agent_approval",
    targetId: row!.id,
    metadata: { origin: "conversational_workflow", actionType: params.actionType },
  });
  return row!.id;
}

export type ExecuteConfirmedActionResult = {
  status: ConversationalActionStatus;
  workflowStatus: WorkflowRunStatus;
  executionResult: Record<string, unknown> | null;
  failureReason: string | null;
  latencyMs: number;
  updatedAction: ConversationalActionRecord;
  /** True when a prior successful confirm for the same pendingActionId was reused. */
  alreadyExecuted?: boolean;
};

/** Durable at-most-once key for confirmation writes (uses existing ai_jobs unique index). */
export function conversationalConfirmIdempotencyKey(pendingActionId: string): string {
  return `conversational_confirm:${pendingActionId}`;
}

function completedResultFromJobPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const exec = payload?.executionResult;
  if (exec && typeof exec === "object" && !Array.isArray(exec)) {
    return exec as Record<string, unknown>;
  }
  return null;
}

/**
 * Re-checks matter edit capability at execution time, then performs the confirmed write.
 * Concurrent/repeated confirms for the same pendingActionId are serialized and at-most-once
 * via pg_advisory_xact_lock + ai_jobs.idempotency_key (no new migration).
 */
export async function executeConfirmedConversationalAction(params: {
  db: Database;
  userId: string;
  pending: ConversationalActionRecord;
  /** Capability expected for this write (rechecked at execution time). */
  capability: "matters.edit" | "drafts.create" | "research.run";
  /** Optional HTTP correlation id (never log preview/body content). */
  correlationId?: string;
}): Promise<ExecuteConfirmedActionResult> {
  const started = Date.now();
  const base = { ...params.pending, actionStatus: "EXECUTING" as const, workflowStatus: "RUNNING" as const };
  const safeFields = {
    correlationId: params.correlationId ?? null,
    pendingActionId: params.pending.pendingActionId,
    actionType: params.pending.actionType,
    actionClass: params.pending.actionClass,
    matterId: params.pending.matterId,
  };

  try {
    await requireMatterAccess(params.db, {
      userId: params.userId,
      matterId: params.pending.matterId,
      minAccess: "edit",
      capability: params.capability,
    });
  } catch (err) {
    const reason =
      err instanceof AuthorizationError ? err.message : "Authorization failed at execution time.";
    const updated: ConversationalActionRecord = {
      ...base,
      actionStatus: "FAILED",
      workflowStatus: "FAILED",
      failureReason: reason,
      executionResult: null,
    };
    const latencyMs = Math.max(0, Date.now() - started);
    confirmLog.warn("confirm.denied", {
      ...safeFields,
      outcome: "FAILED",
      errorCode: "AUTHORIZATION",
      alreadyExecuted: false,
      durationMs: latencyMs,
    });
    return {
      status: "FAILED",
      workflowStatus: "FAILED",
      executionResult: null,
      failureReason: reason,
      latencyMs,
      updatedAction: updated,
    };
  }

  const idempotencyKey = conversationalConfirmIdempotencyKey(params.pending.pendingActionId);

  try {
    return await params.db.transaction(async (tx) => {
      // Serialize concurrent confirms for this token (session-scoped xact lock).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${params.pending.pendingActionId}))`,
      );

      const [existingJob] = await tx
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existingJob?.status === "completed") {
        const prior = completedResultFromJobPayload(
          existingJob.payload as Record<string, unknown> | null,
        ) ?? { reused: true };
        const updated: ConversationalActionRecord = {
          ...base,
          actionStatus: "COMPLETED",
          workflowStatus: "COMPLETED",
          executionResult: prior,
          failureReason: null,
        };
        const latencyMs = Math.max(0, Date.now() - started);
        confirmLog.info("confirm.completed", {
          ...safeFields,
          outcome: "COMPLETED",
          alreadyExecuted: true,
          durationMs: latencyMs,
        });
        return {
          status: "COMPLETED" as const,
          workflowStatus: "COMPLETED" as const,
          executionResult: prior,
          failureReason: null,
          latencyMs,
          updatedAction: updated,
          alreadyExecuted: true,
        };
      }

      let executionResult: Record<string, unknown> = {};
      const preview = params.pending.previewPayload;

      if (params.pending.actionType === "TASK_CREATE") {
        const title = String(preview.title ?? "").trim();
        if (!title) throw new Error("Task preview missing title");
        const dueAtRaw = typeof preview.proposedDueAt === "string" ? preview.proposedDueAt : null;
        const [task] = await tx
          .insert(tasks)
          .values({
            organizationId: params.pending.organizationId,
            matterId: params.pending.matterId,
            title,
            description: typeof preview.description === "string" ? preview.description : null,
            priority: "medium",
            assignedToUserId: params.userId,
            createdByUserId: params.userId,
            dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
          })
          .returning();
        executionResult = { taskId: task!.id, dueAt: dueAtRaw };
        await writeAuditEvent(tx as unknown as Database, {
          organizationId: params.pending.organizationId,
          actorUserId: params.userId,
          matterId: params.pending.matterId,
          action: "task.created",
          targetType: "task",
          targetId: task!.id,
          metadata: {
            origin: "conversational_workflow",
            pendingActionId: params.pending.pendingActionId,
            conversationId: params.pending.conversationId,
          },
        });
      } else if (
        params.pending.actionType === "DRAFT_SAVE" ||
        params.pending.actionType === "DRAFT_GENERATE_PREVIEW"
      ) {
        const draftType = String(preview.draftType ?? "argument");
        const title = String(preview.requestedPurpose ?? "Conversational draft").slice(0, 200);
        const content = String(preview.previewText ?? "");
        const sourceRefs = Array.isArray(preview.sourceRefs)
          ? preview.sourceRefs.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
          : params.pending.sourceRefs;
        for (const id of sourceRefs) {
          if (!UUID_RE.test(id)) throw new Error("Invalid source id in draft preview");
        }
        const created = await createDraft({
          db: tx as unknown as Database,
          organizationId: params.pending.organizationId,
          matterId: params.pending.matterId,
          userId: params.userId,
          title,
          draftType,
          content,
          aiGenerated: true,
        });
        executionResult = {
          draftId: created.draft.id,
          versionId: created.version.id,
          sourceRefs,
        };
      } else if (params.pending.actionType === "MEMORY_SAVE") {
        if (preview.unsafe === true) {
          throw new Error(String(preview.unsafeReason ?? "Unsafe memory proposal blocked."));
        }
        const memory = await createMatterMemory({
          db: tx as unknown as Database,
          organizationId: params.pending.organizationId,
          matterId: params.pending.matterId,
          userId: params.userId,
          memoryType:
            preview.memoryType === "factual_caveat" ||
            preview.memoryType === "user_instruction" ||
            preview.memoryType === "strategic_note"
              ? preview.memoryType
              : "other",
          title: String(preview.title ?? "Matter note").slice(0, 200),
          content: String(preview.content ?? ""),
          origin: "ai",
          status: "approved",
          sourceType: "conversational_workflow",
          sourceReference: {
            pendingActionId: params.pending.pendingActionId,
            conversationId: params.pending.conversationId,
            sourceRefs: preview.sourceRefs ?? [],
          },
        });
        executionResult = { memoryId: memory.id };
      } else if (params.pending.actionType === "RESEARCH_SAVE") {
        executionResult = {
          savedIntent: true,
          question: preview.question ?? null,
          note: "Research save confirmed; use Research workspace to persist the artifact from this session context.",
          authorityRefs: params.pending.authorityRefs,
          treatmentVerified: false,
        };
        await writeAuditEvent(tx as unknown as Database, {
          organizationId: params.pending.organizationId,
          actorUserId: params.userId,
          matterId: params.pending.matterId,
          action: "conversational_workflow.research_save_confirmed",
          targetType: "conversational_action",
          targetId: params.pending.pendingActionId,
          metadata: { conversationId: params.pending.conversationId },
        });
      } else {
        throw new Error(`Unsupported confirmed action type: ${params.pending.actionType}`);
      }

      if (params.pending.agentApprovalId) {
        await tx
          .update(agentApprovals)
          .set({
            status: "approved",
            reviewedByUserId: params.userId,
            reviewedAt: new Date(),
            reviewNote: "Confirmed in conversational Command Center",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentApprovals.id, params.pending.agentApprovalId),
              eq(agentApprovals.organizationId, params.pending.organizationId),
            ),
          );
      }
      if (params.pending.agentRunId) {
        await tx
          .update(agentRuns)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(agentRuns.id, params.pending.agentRunId),
              eq(agentRuns.organizationId, params.pending.organizationId),
            ),
          );
      }

      const jobPayload = {
        pendingActionId: params.pending.pendingActionId,
        actionType: params.pending.actionType,
        conversationId: params.pending.conversationId,
        executionResult,
      };
      if (existingJob) {
        await tx
          .update(aiJobs)
          .set({
            status: "completed",
            payload: jobPayload,
            updatedAt: new Date(),
            lastError: null,
          })
          .where(eq(aiJobs.id, existingJob.id));
      } else {
        await tx.insert(aiJobs).values({
          organizationId: params.pending.organizationId,
          jobType: "conversational_action_confirm",
          idempotencyKey,
          status: "completed",
          payload: jobPayload,
        });
      }

      const updated: ConversationalActionRecord = {
        ...base,
        actionStatus: "COMPLETED",
        workflowStatus: "COMPLETED",
        executionResult,
        failureReason: null,
      };
      const latencyMs = Math.max(0, Date.now() - started);
      confirmLog.info("confirm.completed", {
        ...safeFields,
        outcome: "COMPLETED",
        alreadyExecuted: false,
        durationMs: latencyMs,
      });
      return {
        status: "COMPLETED" as const,
        workflowStatus: "COMPLETED" as const,
        executionResult,
        failureReason: null,
        latencyMs,
        updatedAction: updated,
        alreadyExecuted: false,
      };
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Write execution failed.";
    const updated: ConversationalActionRecord = {
      ...base,
      actionStatus: "FAILED",
      workflowStatus: "FAILED",
      failureReason: reason,
      executionResult: null,
    };
    const latencyMs = Math.max(0, Date.now() - started);
    confirmLog.error("confirm.failed", {
      ...safeFields,
      outcome: "FAILED",
      errorCode: "WRITE_EXECUTION_FAILED",
      alreadyExecuted: false,
      durationMs: latencyMs,
    });
    return {
      status: "FAILED",
      workflowStatus: "FAILED",
      executionResult: null,
      failureReason: reason,
      latencyMs,
      updatedAction: updated,
    };
  }
}

export async function attachApprovalScaffold(params: {
  db: Database;
  userId: string;
  pending: ConversationalActionRecord;
}): Promise<ConversationalActionRecord> {
  const agentActionType =
    params.pending.actionType === "TASK_CREATE"
      ? ("CREATE_TASK" as const)
      : params.pending.actionType === "MEMORY_SAVE"
        ? ("SAVE_MEMORY" as const)
        : params.pending.actionType === "DRAFT_SAVE" ||
            params.pending.actionType === "DRAFT_GENERATE_PREVIEW"
          ? ("CREATE_DRAFT" as const)
          : ("OTHER" as const);
  const runId = await ensureConversationalAgentRun({
    db: params.db,
    organizationId: params.pending.organizationId,
    matterId: params.pending.matterId,
    userId: params.userId,
    goal: `${params.pending.actionType}:${params.pending.pendingActionId}`,
  });
  const approvalId = await createPendingApprovalRow({
    db: params.db,
    organizationId: params.pending.organizationId,
    matterId: params.pending.matterId,
    userId: params.userId,
    runId,
    actionType: agentActionType,
    proposedData: {
      ...params.pending.previewPayload,
      pendingActionId: params.pending.pendingActionId,
      conversationId: params.pending.conversationId,
      previewHash: params.pending.previewHash,
    },
  });
  return { ...params.pending, agentRunId: runId, agentApprovalId: approvalId };
}

export function formatActionPreviewAnswer(params: {
  classification: ActionClassification;
  pending: ConversationalActionRecord | null;
  navigation?: NavigationPayload | null;
  prohibitedReason?: string | null;
  staleReason?: string | null;
  execution?: ExecuteConfirmedActionResult | null;
}): string {
  if (params.prohibitedReason) {
    return `I cannot perform "${params.prohibitedReason}" autonomously. That action requires an authorized human workflow outside chat.`;
  }
  if (params.staleReason) {
    return `Confirmation rejected (${params.staleReason}). Ask me to regenerate the preview, then confirm that specific action.`;
  }
  if (params.execution?.status === "COMPLETED") {
    const id =
      (params.execution.executionResult?.taskId as string | undefined) ??
      (params.execution.executionResult?.draftId as string | undefined) ??
      (params.execution.executionResult?.memoryId as string | undefined) ??
      "record";
    return `Confirmed. The ${params.execution.updatedAction.actionType.toLowerCase().replace(/_/g, " ")} completed (${id}).`;
  }
  if (params.execution?.status === "FAILED") {
    return `I could not complete that write: ${params.execution.failureReason ?? "authorization or validation failed"}.`;
  }
  if (params.navigation) {
    return `Opening ${params.navigation.label}: ${params.navigation.route}${
      params.navigation.targetEntityId ? ` (id ${params.navigation.targetEntityId})` : ""
    }.`;
  }
  if (params.pending?.actionType === "TASK_CREATE") {
    const p = params.pending.previewPayload;
    return [
      "Proposed task (not created yet):",
      `Title: ${p.title}`,
      `Description: ${p.description}`,
      `Due date: ${p.proposedDueAt ?? "UNKNOWN / none (not invented)"}`,
      "Confirm with “create the task” or “confirm” to save it.",
    ].join("\n");
  }
  if (
    params.pending?.actionType === "DRAFT_GENERATE_PREVIEW" ||
    params.classification.actionClass === "DRAFT_PREVIEW"
  ) {
    const p = params.pending?.previewPayload ?? {};
    return [
      "Draft preview (not saved):",
      String(p.previewText ?? "").slice(0, 4000),
      "",
      "Say “save this draft” or “save it” to persist this preview to Drafts.",
    ].join("\n");
  }
  if (params.pending?.actionType === "MEMORY_SAVE") {
    const p = params.pending.previewPayload;
    if (p.unsafe) {
      return `I cannot save that as matter memory: ${p.unsafeReason}`;
    }
    return [
      "Memory proposal (not saved):",
      `Title: ${p.title}`,
      `Support: ${p.supportStatus}`,
      "Confirm with “save it” or “confirm” to write this to Nyaya Memory.",
    ].join("\n");
  }
  if (params.pending?.actionType === "RESEARCH_SAVE") {
    return [
      "Research save requires confirmation.",
      "Confirm with “save this research” / “confirm” to record the save intent for this matter.",
      "Authority treatment remains NOT VERIFIED unless treatmentVerified=true on the record.",
    ].join("\n");
  }
  return "";
}

export function capabilityForAction(
  actionType: ConversationalActionType,
): "matters.edit" | "drafts.create" | "research.run" {
  switch (actionType) {
    case "DRAFT_SAVE":
    case "DRAFT_GENERATE_PREVIEW":
      return "drafts.create";
    case "RESEARCH_SAVE":
      return "research.run";
    case "TASK_CREATE":
    case "MEMORY_SAVE":
    default:
      return "matters.edit";
  }
}
