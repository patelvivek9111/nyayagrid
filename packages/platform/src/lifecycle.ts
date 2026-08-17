import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Database } from "@nyayagrid/database";
import {
  auditEvents,
  clients,
  conversations,
  dataDeletionRequests,
  documents,
  documentVersions,
  guideConsultationPackets,
  guideConversations,
  guideDocuments,
  guideMessages,
  guideSituations,
  legalHolds,
  matters,
  messages,
  notes,
  organizations,
  studentCaseBriefs,
  studentCaseComparisons,
  studentCases,
  studentConversations,
  studentMessages,
  studentSavedItems,
  tasks,
  timelineEvents,
  aiArtifacts,
  trainingConsents,
  type DataDeletionRequest,
  type DataDeletionRequestStatus,
  type DataDeletionScope,
  type LegalHold,
  type OperationalWorkspace,
  type TrainingConsent,
} from "@nyayagrid/database";
import { sanitizeUsageMetadata } from "./usage";

export class LegalHoldActiveError extends Error {
  readonly code = "LEGAL_HOLD_ACTIVE";
  constructor(message = "An active legal hold blocks this operation") {
    super(message);
    this.name = "LegalHoldActiveError";
  }
}

export class LifecycleNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "Resource not found") {
    super(message);
    this.name = "LifecycleNotFoundError";
  }
}

export class LifecycleValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "LifecycleValidationError";
  }
}

async function writeLifecycleAuditEvent(
  db: Database,
  event: {
    organizationId?: string | null;
    actorUserId?: string | null;
    matterId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    organizationId: event.organizationId ?? null,
    actorUserId: event.actorUserId ?? null,
    matterId: event.matterId ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata ?? {},
  });
}

/**
 * Places a legal (litigation) hold. Omitting both `matterId` and `documentId` places an
 * organization-wide hold. When both are given the hold is scoped to the intersection of the two
 * (the document must belong to that matter for the hold to make practical sense, but this
 * function does not enforce that — callers scope inputs themselves).
 */
export async function placeLegalHold(params: {
  db: Database;
  organizationId: string;
  matterId?: string | null;
  documentId?: string | null;
  userId: string;
  reason: string;
}): Promise<LegalHold> {
  if (params.matterId) {
    const [matter] = await params.db
      .select({ id: matters.id })
      .from(matters)
      .where(
        and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)),
      )
      .limit(1);
    if (!matter) throw new LifecycleNotFoundError("Matter not found in organization");
  }
  if (params.documentId) {
    const [document] = await params.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, params.documentId),
          eq(documents.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!document) throw new LifecycleNotFoundError("Document not found in organization");
  }

  const [hold] = await params.db
    .insert(legalHolds)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId ?? null,
      documentId: params.documentId ?? null,
      reason: params.reason,
      placedByUserId: params.userId,
    })
    .returning();
  if (!hold) throw new Error("Failed to create legal hold");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId ?? null,
    action: "legal_hold.placed",
    targetType: "legal_hold",
    targetId: hold.id,
    metadata: { matterId: params.matterId ?? null, documentId: params.documentId ?? null },
  });

  return hold;
}

export async function releaseLegalHold(params: {
  db: Database;
  organizationId: string;
  holdId: string;
  userId: string;
}): Promise<LegalHold> {
  const [existing] = await params.db
    .select()
    .from(legalHolds)
    .where(
      and(eq(legalHolds.id, params.holdId), eq(legalHolds.organizationId, params.organizationId)),
    )
    .limit(1);
  if (!existing) throw new LifecycleNotFoundError("Legal hold not found");
  if (existing.releasedAt) return existing;

  const [released] = await params.db
    .update(legalHolds)
    .set({
      releasedByUserId: params.userId,
      releasedAt: new Date(),
    })
    .where(eq(legalHolds.id, params.holdId))
    .returning();
  if (!released) throw new Error("Failed to release legal hold");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: existing.matterId,
    action: "legal_hold.released",
    targetType: "legal_hold",
    targetId: released.id,
  });

  return released;
}

export async function listLegalHolds(params: {
  db: Database;
  organizationId: string;
  matterId?: string | null;
}): Promise<LegalHold[]> {
  return params.db
    .select()
    .from(legalHolds)
    .where(
      params.matterId
        ? and(
            eq(legalHolds.organizationId, params.organizationId),
            eq(legalHolds.matterId, params.matterId),
          )
        : eq(legalHolds.organizationId, params.organizationId),
    )
    .orderBy(desc(legalHolds.createdAt));
}

/**
 * Throws `LegalHoldActiveError` when an active legal hold covers the given matter or document —
 * either directly, or via an organization-wide hold (a hold row with no matterId/documentId).
 * Every destructive data-deletion path must call this before it does irreversible work.
 */
export async function assertNotOnLegalHold(
  db: Database,
  params: { organizationId: string; matterId?: string | null; documentId?: string | null },
): Promise<void> {
  const orgWide = and(isNull(legalHolds.matterId), isNull(legalHolds.documentId));
  const matterScoped = params.matterId ? eq(legalHolds.matterId, params.matterId) : undefined;
  const documentScoped = params.documentId
    ? eq(legalHolds.documentId, params.documentId)
    : undefined;
  const scopeMatch = [orgWide, matterScoped, documentScoped].filter(
    (c): c is NonNullable<typeof c> => Boolean(c),
  );

  const rows = await db
    .select({ id: legalHolds.id, reason: legalHolds.reason })
    .from(legalHolds)
    .where(
      and(
        eq(legalHolds.organizationId, params.organizationId),
        isNull(legalHolds.releasedAt),
        or(...scopeMatch),
      ),
    )
    .limit(1);

  const [active] = rows;
  if (active) {
    throw new LegalHoldActiveError(`Blocked by active legal hold ${active.id}: ${active.reason}`);
  }
}

/**
 * Records a request to delete data. Deletion is never performed synchronously here — this only
 * records intent and, up front, checks for a legal hold covering the requested scope so the
 * request can be marked `rejected` immediately instead of silently queueing undeletable data. An
 * operational process (out of scope for this module) is responsible for actually executing a
 * `pending`/`scheduled` request once its grace period elapses, re-checking holds at that time too.
 *
 * `workspace: "professional"` requires `organizationId` and checks legal holds: an organization-
 * wide hold when `scope.matterIds`/`scope.documentIds` are both empty, or a hold on each listed
 * matter/document otherwise. `student`/`public` workspace requests are user-scoped and have no
 * legal-hold concept, since holds only ever apply to organization data.
 */
export async function requestDataDeletion(params: {
  db: Database;
  userId: string;
  workspace: OperationalWorkspace;
  organizationId?: string | null;
  scope?: DataDeletionScope;
  scheduledFor?: Date | null;
}): Promise<DataDeletionRequest> {
  if (params.workspace === "professional" && !params.organizationId) {
    throw new LifecycleValidationError("organizationId is required when workspace is professional");
  }

  const scope: DataDeletionScope = { ...(params.scope ?? {}) };
  let status: DataDeletionRequestStatus = params.scheduledFor ? "scheduled" : "pending";

  if (params.workspace === "professional" && params.organizationId) {
    const matterIds = scope.matterIds ?? [];
    const documentIds = scope.documentIds ?? [];
    const holdChecks: Array<{ matterId?: string | null; documentId?: string | null }> =
      matterIds.length > 0 || documentIds.length > 0
        ? [
            ...matterIds.map((matterId) => ({ matterId })),
            ...documentIds.map((documentId) => ({ documentId })),
          ]
        : [{}]; // no specific matter/document listed: this is a whole-organization request

    for (const check of holdChecks) {
      try {
        await assertNotOnLegalHold(params.db, {
          organizationId: params.organizationId,
          matterId: check.matterId ?? null,
          documentId: check.documentId ?? null,
        });
      } catch (error) {
        if (error instanceof LegalHoldActiveError) {
          status = "rejected";
          scope.note = scope.note ? `${scope.note} | ${error.message}` : error.message;
          break;
        }
        throw error;
      }
    }
  }

  const [request] = await params.db
    .insert(dataDeletionRequests)
    .values({
      organizationId: params.organizationId ?? null,
      userId: params.userId,
      workspace: params.workspace,
      scope,
      status,
      scheduledFor: params.scheduledFor ?? null,
    })
    .returning();
  if (!request) throw new Error("Failed to create data deletion request");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId ?? null,
    actorUserId: params.userId,
    action: "data_deletion.requested",
    targetType: "data_deletion_request",
    targetId: request.id,
    metadata: { workspace: params.workspace, status },
  });

  return request;
}

export async function cancelDeletion(params: {
  db: Database;
  requestId: string;
  userId: string;
  note?: string | null;
}): Promise<DataDeletionRequest> {
  const [existing] = await params.db
    .select()
    .from(dataDeletionRequests)
    .where(eq(dataDeletionRequests.id, params.requestId))
    .limit(1);
  if (!existing) throw new LifecycleNotFoundError("Data deletion request not found");
  if (existing.status === "completed") {
    throw new LifecycleValidationError("Cannot cancel a completed deletion request");
  }
  if (existing.status === "cancelled") return existing;

  const scope: DataDeletionScope = { ...existing.scope };
  if (params.note) scope.note = scope.note ? `${scope.note} | ${params.note}` : params.note;

  const [cancelled] = await params.db
    .update(dataDeletionRequests)
    .set({ status: "cancelled", scope })
    .where(eq(dataDeletionRequests.id, params.requestId))
    .returning();
  if (!cancelled) throw new Error("Failed to cancel data deletion request");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: existing.organizationId,
    actorUserId: params.userId,
    action: "data_deletion.cancelled",
    targetType: "data_deletion_request",
    targetId: cancelled.id,
  });

  return cancelled;
}

/** Soft-archives a matter (status -> "archived"). Does not touch documents or delete anything. */
export async function archiveMatter(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
}) {
  const [existing] = await params.db
    .select()
    .from(matters)
    .where(and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)))
    .limit(1);
  if (!existing) throw new LifecycleNotFoundError("Matter not found in organization");

  const [archived] = await params.db
    .update(matters)
    .set({ status: "archived", closedAt: existing.closedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(matters.id, params.matterId))
    .returning();
  if (!archived) throw new Error("Failed to archive matter");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter.archived",
    targetType: "matter",
    targetId: params.matterId,
  });

  return archived;
}

export type OrganizationDataExport = {
  organization: { id: string; name: string; slug: string; type: string } | null;
  clients: Array<{ id: string; displayName: string; clientType: string; status: string }>;
  matters: Array<{
    id: string;
    matterNumber: string;
    title: string;
    status: string;
    clientId: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    matterId: string | null;
    processingState: string;
    /** Latest version metadata only — never the object body. */
    latestVersionRef: { versionId: string; storageKey: string; byteSize: number } | null;
  }>;
  counts: {
    clients: number;
    matters: number;
    documents: number;
    notes: number;
    tasks: number;
    timelineEvents: number;
    conversations: number;
    messages: number;
    aiArtifacts: number;
  };
  generatedAt: string;
  requestedByUserId: string;
};

/**
 * Exports a JSON-serializable summary of one organization's data for compliance/portability
 * requests. Every query below filters by `organizationId`, so this can never return another
 * tenant's rows. Document bodies are never included — only metadata plus a storage-key reference
 * the caller can use to fetch the object separately if authorized to do so.
 */
export async function exportOrganizationData(params: {
  db: Database;
  organizationId: string;
  userId: string;
}): Promise<OrganizationDataExport> {
  const [org] = await params.db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      type: organizations.type,
    })
    .from(organizations)
    .where(eq(organizations.id, params.organizationId))
    .limit(1);

  const [
    clientRows,
    matterRows,
    documentRows,
    versionRows,
    noteRows,
    taskRows,
    eventRows,
    convoRows,
    msgRows,
    artifactRows,
  ] = await Promise.all([
    params.db
      .select({
        id: clients.id,
        displayName: clients.displayName,
        clientType: clients.clientType,
        status: clients.status,
      })
      .from(clients)
      .where(eq(clients.organizationId, params.organizationId)),
    params.db
      .select({
        id: matters.id,
        matterNumber: matters.matterNumber,
        title: matters.title,
        status: matters.status,
        clientId: matters.clientId,
      })
      .from(matters)
      .where(eq(matters.organizationId, params.organizationId)),
    params.db
      .select({
        id: documents.id,
        title: documents.title,
        matterId: documents.matterId,
        processingState: documents.processingState,
      })
      .from(documents)
      .where(eq(documents.organizationId, params.organizationId)),
    params.db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        versionNumber: documentVersions.versionNumber,
        storageKey: documentVersions.storageKey,
        byteSize: documentVersions.byteSize,
      })
      .from(documentVersions)
      .where(eq(documentVersions.organizationId, params.organizationId)),
    params.db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.organizationId, params.organizationId)),
    params.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.organizationId, params.organizationId)),
    params.db
      .select({ id: timelineEvents.id })
      .from(timelineEvents)
      .where(eq(timelineEvents.organizationId, params.organizationId)),
    params.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.organizationId, params.organizationId)),
    params.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.organizationId, params.organizationId)),
    params.db
      .select({ id: aiArtifacts.id })
      .from(aiArtifacts)
      .where(eq(aiArtifacts.organizationId, params.organizationId)),
  ]);

  const latestVersionByDocument = new Map<string, (typeof versionRows)[number]>();
  for (const version of versionRows) {
    const current = latestVersionByDocument.get(version.documentId);
    if (!current || version.versionNumber > current.versionNumber) {
      latestVersionByDocument.set(version.documentId, version);
    }
  }

  return {
    organization: org ?? null,
    clients: clientRows,
    matters: matterRows,
    documents: documentRows.map((doc) => {
      const latest = latestVersionByDocument.get(doc.id);
      return {
        ...doc,
        latestVersionRef: latest
          ? { versionId: latest.id, storageKey: latest.storageKey, byteSize: latest.byteSize }
          : null,
      };
    }),
    counts: {
      clients: clientRows.length,
      matters: matterRows.length,
      documents: documentRows.length,
      notes: noteRows.length,
      tasks: taskRows.length,
      timelineEvents: eventRows.length,
      conversations: convoRows.length,
      messages: msgRows.length,
      aiArtifacts: artifactRows.length,
    },
    generatedAt: new Date().toISOString(),
    requestedByUserId: params.userId,
  };
}

export type UserPersonalDataExport = {
  userId: string;
  studentCases: Array<{
    id: string;
    title: string;
    citation: string | null;
    court: string | null;
    processingState: string;
  }>;
  studentSavedItems: Array<{ id: string; itemType: string; title: string }>;
  guideDocuments: Array<{
    id: string;
    title: string;
    documentKind: string | null;
    processingState: string;
  }>;
  guideSituations: Array<{ id: string; title: string; jurisdiction: string | null }>;
  counts: {
    studentCases: number;
    studentConversations: number;
    studentMessages: number;
    studentCaseBriefs: number;
    studentCaseComparisons: number;
    studentSavedItems: number;
    guideDocuments: number;
    guideSituations: number;
    guideConversations: number;
    guideMessages: number;
    guideConsultationPackets: number;
  };
  generatedAt: string;
};

/**
 * Exports a JSON-serializable summary of one user's Nyaya Professor / Nyaya Guide data. These
 * workspaces are user-scoped by construction (no organizationId), so `userId` alone is the
 * complete authorization boundary. Case/document/brief bodies are excluded — only metadata.
 */
export async function exportUserPersonalData(params: {
  db: Database;
  userId: string;
}): Promise<UserPersonalDataExport> {
  const [
    caseRows,
    savedItemRows,
    guideDocRows,
    guideSituationRows,
    studentConvoRows,
    studentMsgRows,
    briefRows,
    comparisonRows,
    guideConvoRows,
    guideMsgRows,
    guidePacketRows,
  ] = await Promise.all([
    params.db
      .select({
        id: studentCases.id,
        title: studentCases.title,
        citation: studentCases.citation,
        court: studentCases.court,
        processingState: studentCases.processingState,
      })
      .from(studentCases)
      .where(eq(studentCases.userId, params.userId)),
    params.db
      .select({
        id: studentSavedItems.id,
        itemType: studentSavedItems.itemType,
        title: studentSavedItems.title,
      })
      .from(studentSavedItems)
      .where(eq(studentSavedItems.userId, params.userId)),
    params.db
      .select({
        id: guideDocuments.id,
        title: guideDocuments.title,
        documentKind: guideDocuments.documentKind,
        processingState: guideDocuments.processingState,
      })
      .from(guideDocuments)
      .where(eq(guideDocuments.userId, params.userId)),
    params.db
      .select({
        id: guideSituations.id,
        title: guideSituations.title,
        jurisdiction: guideSituations.jurisdiction,
      })
      .from(guideSituations)
      .where(eq(guideSituations.userId, params.userId)),
    params.db
      .select({ id: studentConversations.id })
      .from(studentConversations)
      .where(eq(studentConversations.userId, params.userId)),
    params.db
      .select({ id: studentMessages.id })
      .from(studentMessages)
      .where(eq(studentMessages.userId, params.userId)),
    params.db
      .select({ id: studentCaseBriefs.id })
      .from(studentCaseBriefs)
      .where(eq(studentCaseBriefs.userId, params.userId)),
    params.db
      .select({ id: studentCaseComparisons.id })
      .from(studentCaseComparisons)
      .where(eq(studentCaseComparisons.userId, params.userId)),
    params.db
      .select({ id: guideConversations.id })
      .from(guideConversations)
      .where(eq(guideConversations.userId, params.userId)),
    params.db
      .select({ id: guideMessages.id })
      .from(guideMessages)
      .where(eq(guideMessages.userId, params.userId)),
    params.db
      .select({ id: guideConsultationPackets.id })
      .from(guideConsultationPackets)
      .where(eq(guideConsultationPackets.userId, params.userId)),
  ]);

  return {
    userId: params.userId,
    studentCases: caseRows,
    studentSavedItems: savedItemRows,
    guideDocuments: guideDocRows,
    guideSituations: guideSituationRows,
    counts: {
      studentCases: caseRows.length,
      studentConversations: studentConvoRows.length,
      studentMessages: studentMsgRows.length,
      studentCaseBriefs: briefRows.length,
      studentCaseComparisons: comparisonRows.length,
      studentSavedItems: savedItemRows.length,
      guideDocuments: guideDocRows.length,
      guideSituations: guideSituationRows.length,
      guideConversations: guideConvoRows.length,
      guideMessages: guideMsgRows.length,
      guideConsultationPackets: guidePacketRows.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function sanitizeAuditMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return sanitizeUsageMetadata(metadata as Record<string, unknown>);
}

export type MatterAuditExport = {
  organizationId: string;
  matterId: string;
  generatedAt: string;
  truncated: boolean;
  eventCount: number;
  events: Array<{
    id: string;
    createdAt: string;
    action: string;
    actorUserId: string | null;
    targetType: string | null;
    targetId: string | null;
    metadata: Record<string, unknown>;
  }>;
};

const MATTER_AUDIT_EXPORT_LIMIT = 5000;

/**
 * Attorney-exportable matter audit log. Scoped to one organization + matter. Metadata is passed
 * through the same content-key stripper as AI usage rows so prompts and document text cannot ride
 * along in JSON downloads.
 */
export async function exportMatterAuditLog(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}): Promise<MatterAuditExport> {
  const [matter] = await params.db
    .select({ id: matters.id })
    .from(matters)
    .where(and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)))
    .limit(1);
  if (!matter) throw new LifecycleNotFoundError("Matter not found in organization");

  const rows = await params.db
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      action: auditEvents.action,
      actorUserId: auditEvents.actorUserId,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, params.organizationId),
        eq(auditEvents.matterId, params.matterId),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(MATTER_AUDIT_EXPORT_LIMIT + 1);

  const truncated = rows.length > MATTER_AUDIT_EXPORT_LIMIT;
  const page = truncated ? rows.slice(0, MATTER_AUDIT_EXPORT_LIMIT) : rows;

  return {
    organizationId: params.organizationId,
    matterId: params.matterId,
    generatedAt: new Date().toISOString(),
    truncated,
    eventCount: page.length,
    events: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actorUserId: row.actorUserId,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: sanitizeAuditMetadata(row.metadata),
    })),
  };
}

export async function getActiveTrainingConsent(params: {
  db: Database;
  organizationId: string;
}): Promise<TrainingConsent | null> {
  const [row] = await params.db
    .select()
    .from(trainingConsents)
    .where(
      and(eq(trainingConsents.organizationId, params.organizationId), isNull(trainingConsents.withdrawnAt)),
    )
    .orderBy(desc(trainingConsents.recordedAt))
    .limit(1);
  return row ?? null;
}

export async function recordTrainingConsent(params: {
  db: Database;
  organizationId: string;
  userId: string;
  statement: string;
}): Promise<TrainingConsent> {
  const existing = await getActiveTrainingConsent(params);
  if (existing) {
    throw new LifecycleValidationError(
      "An active training-consent record already exists; withdraw it before recording another",
    );
  }

  const [row] = await params.db
    .insert(trainingConsents)
    .values({
      organizationId: params.organizationId,
      recordedByUserId: params.userId,
      statement: params.statement,
    })
    .returning();
  if (!row) throw new Error("Failed to record training consent");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: "training_consent.recorded",
    targetType: "training_consent",
    targetId: row.id,
  });
  return row;
}

export async function withdrawTrainingConsent(params: {
  db: Database;
  organizationId: string;
  userId: string;
}): Promise<TrainingConsent | null> {
  const existing = await getActiveTrainingConsent(params);
  if (!existing) return null;

  const [row] = await params.db
    .update(trainingConsents)
    .set({ withdrawnAt: new Date(), withdrawnByUserId: params.userId })
    .where(eq(trainingConsents.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to withdraw training consent");

  await writeLifecycleAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: "training_consent.withdrawn",
    targetType: "training_consent",
    targetId: row.id,
  });
  return row;
}
