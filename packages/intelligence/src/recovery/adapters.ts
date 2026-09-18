import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  analysisFindings,
  deadlineCandidates,
  documentAnalysisItems,
  documentReviewStates,
  documentTagAssignments,
  drafts,
  draftVersions,
  graphEdges,
  graphNodes,
  legalWorkHeads,
  matterEntities,
  matterFacts,
  matterMemories,
  matterSummaries,
  notes,
  redlineSuggestions,
  tasks,
  timelineEvents,
} from "@nyayagrid/database";
import {
  LegalWorkIrreversibleError,
  LegalWorkNotFoundError,
} from "./errors";
import { isProtectedObjectType, protectedReason } from "./policy";
import type { LegalWorkObjectType, LegalWorkPayload } from "./types";
import type { ObjectRef } from "./store";

function omitHeavy(payload: LegalWorkPayload): LegalWorkPayload {
  const next = { ...payload };
  delete next.embedding;
  return next;
}

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export async function loadLivePayload(
  db: Database,
  ref: ObjectRef,
): Promise<LegalWorkPayload | null> {
  if (isProtectedObjectType(ref.objectType)) {
    return { protected: true, objectType: ref.objectType };
  }
  const scope = {
    organizationId: ref.organizationId,
    matterId: ref.matterId,
    id: ref.objectId,
  };
  switch (ref.objectType) {
    case "draft": {
      const [draft] = await db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.id, ref.objectId),
            eq(drafts.organizationId, ref.organizationId),
            eq(drafts.matterId, ref.matterId),
          ),
        )
        .limit(1);
      if (!draft) return null;
      const [version] = await db
        .select()
        .from(draftVersions)
        .where(
          and(
            eq(draftVersions.draftId, draft.id),
            eq(draftVersions.versionNumber, draft.currentVersionNumber),
          ),
        )
        .limit(1);
      return {
        title: draft.title,
        status: draft.status,
        draftType: draft.draftType,
        content: version?.content ?? "",
        changeSummary: version?.changeSummary ?? null,
        origin: version?.origin ?? "manual",
        sourceAssertions: version?.sourceAssertions ?? [],
        nativeVersionId: version?.id ?? null,
      };
    }
    case "note": {
      const [row] = await db
        .select()
        .from(notes)
        .where(
          and(eq(notes.id, scope.id), eq(notes.organizationId, scope.organizationId), eq(notes.matterId, scope.matterId)),
        )
        .limit(1);
      return row
        ? { title: row.title, content: row.content, origin: row.origin, citations: row.citations ?? [] }
        : null;
    }
    case "timeline_event": {
      const [row] = await db
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.id, scope.id),
            eq(timelineEvents.organizationId, scope.organizationId),
            eq(timelineEvents.matterId, scope.matterId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        title: row.title,
        description: row.description,
        eventType: row.eventType,
        eventDate: asIso(row.eventDate),
        eventDateEnd: asIso(row.eventDateEnd),
        datePrecision: row.datePrecision,
        status: row.status,
        actors: row.actors ?? [],
        uncertaintyNotes: row.uncertaintyNotes,
        retiredAt: asIso(row.retiredAt),
        approvedByUserId: row.approvedByUserId,
        approvedAt: asIso(row.approvedAt),
        rejectedByUserId: row.rejectedByUserId,
        rejectedAt: asIso(row.rejectedAt),
        rejectionReason: row.rejectionReason,
      };
    }
    case "evidence_review": {
      const [row] = await db
        .select()
        .from(documentReviewStates)
        .where(
          and(
            eq(documentReviewStates.documentId, ref.objectId),
            eq(documentReviewStates.organizationId, ref.organizationId),
            eq(documentReviewStates.matterId, ref.matterId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        documentId: row.documentId,
        relevance: row.relevance,
        privilege: row.privilege,
        responsiveness: row.responsiveness,
        confidentiality: row.confidentiality,
        important: row.important,
        reviewNotes: row.reviewNotes,
        humanPrivilegeFinal: row.humanPrivilegeFinal,
        reviewedByUserId: row.reviewedByUserId,
        reviewedAt: asIso(row.reviewedAt),
      };
    }
    case "evidence_tag": {
      const rows = await db
        .select({ tagId: documentTagAssignments.tagId })
        .from(documentTagAssignments)
        .where(
          and(
            eq(documentTagAssignments.documentId, ref.objectId),
            eq(documentTagAssignments.organizationId, ref.organizationId),
            eq(documentTagAssignments.matterId, ref.matterId),
          ),
        );
      return { documentId: ref.objectId, tagIds: rows.map((r) => r.tagId).sort() };
    }
    case "memory": {
      const [row] = await db
        .select()
        .from(matterMemories)
        .where(
          and(
            eq(matterMemories.id, scope.id),
            eq(matterMemories.organizationId, scope.organizationId),
            eq(matterMemories.matterId, scope.matterId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return omitHeavy({
        memoryType: row.memoryType,
        title: row.title,
        content: row.content,
        status: row.status,
        importance: row.importance,
        origin: row.origin,
        sourceType: row.sourceType,
        sourceReference: row.sourceReference ?? {},
        approvedByUserId: row.approvedByUserId,
        approvedAt: asIso(row.approvedAt),
        rejectedByUserId: row.rejectedByUserId,
        rejectedAt: asIso(row.rejectedAt),
        rejectionReason: row.rejectionReason,
        supersededBy: row.supersededBy,
      });
    }
    case "graph_node": {
      const [row] = await db
        .select()
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.id, scope.id),
            eq(graphNodes.organizationId, scope.organizationId),
            eq(graphNodes.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            displayName: row.displayName,
            metadata: row.metadata ?? {},
            status: row.status,
            nodeType: row.nodeType,
          }
        : null;
    }
    case "graph_edge": {
      const [row] = await db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.id, scope.id),
            eq(graphEdges.organizationId, scope.organizationId),
            eq(graphEdges.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            label: row.label,
            relationshipType: row.relationshipType,
            metadata: row.metadata ?? {},
            status: row.status,
            approvedByUserId: row.approvedByUserId,
            approvedAt: asIso(row.approvedAt),
            rejectedByUserId: row.rejectedByUserId,
            rejectedAt: asIso(row.rejectedAt),
            rejectionReason: row.rejectionReason,
          }
        : null;
    }
    case "fact": {
      const [row] = await db
        .select()
        .from(matterFacts)
        .where(
          and(
            eq(matterFacts.id, scope.id),
            eq(matterFacts.organizationId, scope.organizationId),
            eq(matterFacts.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            factKey: row.factKey,
            label: row.label,
            value: row.value,
            normalizedValue: row.normalizedValue,
            status: row.status,
            approvedByUserId: row.approvedByUserId,
            approvedAt: asIso(row.approvedAt),
            rejectedByUserId: row.rejectedByUserId,
            rejectedAt: asIso(row.rejectedAt),
            rejectionReason: row.rejectionReason,
          }
        : null;
    }
    case "entity": {
      const [row] = await db
        .select()
        .from(matterEntities)
        .where(
          and(
            eq(matterEntities.id, scope.id),
            eq(matterEntities.organizationId, scope.organizationId),
            eq(matterEntities.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            displayName: row.displayName,
            description: row.description,
            status: row.status,
            approvedByUserId: row.approvedByUserId,
            approvedAt: asIso(row.approvedAt),
            rejectedByUserId: row.rejectedByUserId,
            rejectedAt: asIso(row.rejectedAt),
            rejectionReason: row.rejectionReason,
          }
        : null;
    }
    case "deadline": {
      const [row] = await db
        .select()
        .from(deadlineCandidates)
        .where(
          and(
            eq(deadlineCandidates.id, scope.id),
            eq(deadlineCandidates.organizationId, scope.organizationId),
            eq(deadlineCandidates.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            title: row.title,
            description: row.description,
            dueAt: asIso(row.dueAt),
            status: row.status,
            approvedByUserId: row.approvedByUserId,
            approvedAt: asIso(row.approvedAt),
            rejectedByUserId: row.rejectedByUserId,
            rejectedAt: asIso(row.rejectedAt),
            rejectionReason: row.rejectionReason,
          }
        : null;
    }
    case "summary": {
      const [byId] = await db
        .select()
        .from(matterSummaries)
        .where(
          and(
            eq(matterSummaries.id, scope.id),
            eq(matterSummaries.organizationId, scope.organizationId),
            eq(matterSummaries.matterId, scope.matterId),
          ),
        )
        .limit(1);
      if (byId) {
        return {
          summary: byId.summary,
          provenance: byId.provenance ?? {},
          nativeSummaryId: byId.id,
        };
      }
      const [current] = await db
        .select()
        .from(matterSummaries)
        .where(
          and(
            eq(matterSummaries.organizationId, scope.organizationId),
            eq(matterSummaries.matterId, scope.matterId),
          ),
        )
        .orderBy(desc(matterSummaries.createdAt))
        .limit(1);
      return current
        ? {
            summary: current.summary,
            provenance: current.provenance ?? {},
            nativeSummaryId: current.id,
          }
        : null;
    }
    case "analysis": {
      const [row] = await db
        .select()
        .from(analysisFindings)
        .where(
          and(
            eq(analysisFindings.id, scope.id),
            eq(analysisFindings.organizationId, scope.organizationId),
            eq(analysisFindings.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            title: row.title,
            explanation: row.explanation,
            status: row.status,
            reviewNote: row.reviewNote,
            reviewedByUserId: row.reviewedByUserId,
            reviewedAt: asIso(row.reviewedAt),
          }
        : null;
    }
    case "analysis_item": {
      const [row] = await db
        .select()
        .from(documentAnalysisItems)
        .where(
          and(
            eq(documentAnalysisItems.id, scope.id),
            eq(documentAnalysisItems.organizationId, scope.organizationId),
            eq(documentAnalysisItems.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            title: row.title,
            summary: row.summary,
            explanation: row.explanation,
            attention: row.attention,
            status: row.status,
            confidence: row.confidence,
            originalText: row.originalText,
            analysisId: row.analysisId,
            reviewedByUserId: row.reviewedByUserId,
            reviewedAt: asIso(row.reviewedAt),
          }
        : null;
    }
    case "redline": {
      const [row] = await db
        .select()
        .from(redlineSuggestions)
        .where(
          and(
            eq(redlineSuggestions.id, scope.id),
            eq(redlineSuggestions.organizationId, scope.organizationId),
            eq(redlineSuggestions.matterId, scope.matterId),
          ),
        )
        .limit(1);
      return row
        ? {
            status: row.status,
            currentClause: row.currentClause,
            proposedClause: row.proposedClause,
            reason: row.reason,
            reviewedByUserId: row.reviewedByUserId,
            reviewedAt: asIso(row.reviewedAt),
          }
        : null;
    }
    case "task": {
      const [row] = await db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.id, scope.id), eq(tasks.organizationId, scope.organizationId), eq(tasks.matterId, scope.matterId)),
        )
        .limit(1);
      return row
        ? {
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueAt: asIso(row.dueAt),
          }
        : null;
    }
    default:
      return null;
  }
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function applyLivePayload(
  db: Database,
  ref: ObjectRef,
  payload: LegalWorkPayload,
): Promise<void> {
  if (isProtectedObjectType(ref.objectType)) {
    throw new LegalWorkIrreversibleError(protectedReason(ref.objectType));
  }
  switch (ref.objectType) {
    case "draft": {
      const [draft] = await db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.id, ref.objectId),
            eq(drafts.organizationId, ref.organizationId),
            eq(drafts.matterId, ref.matterId),
          ),
        )
        .limit(1);
      if (!draft) throw new LegalWorkNotFoundError("Draft not found in this case.");
      const nextNumber = draft.currentVersionNumber + 1;
      const origin =
        payload.origin === "ai" || payload.origin === "ai_edited" || payload.origin === "manual"
          ? payload.origin
          : "manual";
      const [native] = await db
        .insert(draftVersions)
        .values({
          organizationId: ref.organizationId,
          matterId: ref.matterId,
          draftId: draft.id,
          versionNumber: nextNumber,
          content: String(payload.content ?? ""),
          changeSummary:
            typeof payload.changeSummary === "string"
              ? payload.changeSummary
              : "Restored as a new version",
          origin,
          sourceAssertions: Array.isArray(payload.sourceAssertions)
            ? (payload.sourceAssertions as Array<{
                text: string;
                chunkIds: string[];
                provenanceClass?: "FACT_SOURCE" | "LEGAL_AUTHORITY";
                authorityIds?: string[];
              }>)
            : [],
        })
        .returning();
      await db
        .update(drafts)
        .set({
          currentVersionNumber: nextNumber,
          title: typeof payload.title === "string" ? payload.title : draft.title,
          status:
            payload.status === "draft" ||
            payload.status === "in_review" ||
            payload.status === "final" ||
            payload.status === "archived"
              ? payload.status
              : draft.status,
          updatedAt: new Date(),
        })
        .where(eq(drafts.id, draft.id));
      payload.nativeVersionId = native?.id ?? null;
      return;
    }
    case "note": {
      const [updated] = await db
        .update(notes)
        .set({
          title: String(payload.title ?? ""),
          content: String(payload.content ?? ""),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(notes.id, ref.objectId),
            eq(notes.organizationId, ref.organizationId),
            eq(notes.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Note not found in this case.");
      return;
    }
    case "timeline_event": {
      const [updated] = await db
        .update(timelineEvents)
        .set({
          title: String(payload.title ?? ""),
          description: typeof payload.description === "string" ? payload.description : null,
          eventType: String(payload.eventType ?? "manual_note"),
          eventDate: parseDate(payload.eventDate),
          eventDateEnd: parseDate(payload.eventDateEnd),
          datePrecision:
            payload.datePrecision === "exact" ||
            payload.datePrecision === "approximate" ||
            payload.datePrecision === "month" ||
            payload.datePrecision === "year" ||
            payload.datePrecision === "range" ||
            payload.datePrecision === "unknown"
              ? payload.datePrecision
              : "unknown",
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "proposed",
          actors: Array.isArray(payload.actors) ? (payload.actors as string[]) : [],
          uncertaintyNotes: typeof payload.uncertaintyNotes === "string" ? payload.uncertaintyNotes : null,
          retiredAt: parseDate(payload.retiredAt),
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(timelineEvents.id, ref.objectId),
            eq(timelineEvents.organizationId, ref.organizationId),
            eq(timelineEvents.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Timeline item not found in this case.");
      return;
    }
    case "evidence_review": {
      const [updated] = await db
        .update(documentReviewStates)
        .set({
          relevance:
            payload.relevance === "relevant" || payload.relevance === "not_relevant" || payload.relevance === "unknown"
              ? payload.relevance
              : "unknown",
          privilege:
            payload.privilege === "privileged" ||
            payload.privilege === "not_privileged" ||
            payload.privilege === "potentially_privileged" ||
            payload.privilege === "unknown"
              ? payload.privilege
              : "unknown",
          responsiveness:
            payload.responsiveness === "responsive" ||
            payload.responsiveness === "not_responsive" ||
            payload.responsiveness === "unknown"
              ? payload.responsiveness
              : "unknown",
          confidentiality:
            payload.confidentiality === "confidential" ||
            payload.confidentiality === "not_confidential" ||
            payload.confidentiality === "unknown"
              ? payload.confidentiality
              : "unknown",
          important: Boolean(payload.important),
          reviewNotes: typeof payload.reviewNotes === "string" ? payload.reviewNotes : null,
          humanPrivilegeFinal: Boolean(payload.humanPrivilegeFinal),
          reviewedByUserId: typeof payload.reviewedByUserId === "string" ? payload.reviewedByUserId : null,
          reviewedAt: parseDate(payload.reviewedAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentReviewStates.documentId, ref.objectId),
            eq(documentReviewStates.organizationId, ref.organizationId),
            eq(documentReviewStates.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Evidence review not found in this case.");
      return;
    }
    case "evidence_tag": {
      const desired = new Set(
        Array.isArray(payload.tagIds) ? payload.tagIds.filter((id): id is string => typeof id === "string") : [],
      );
      const existing = await db
        .select()
        .from(documentTagAssignments)
        .where(
          and(
            eq(documentTagAssignments.documentId, ref.objectId),
            eq(documentTagAssignments.organizationId, ref.organizationId),
            eq(documentTagAssignments.matterId, ref.matterId),
          ),
        );
      for (const row of existing) {
        if (!desired.has(row.tagId)) {
          await db.delete(documentTagAssignments).where(eq(documentTagAssignments.id, row.id));
        }
      }
      const have = new Set(existing.map((r) => r.tagId));
      for (const tagId of desired) {
        if (have.has(tagId)) continue;
        await db.insert(documentTagAssignments).values({
          organizationId: ref.organizationId,
          matterId: ref.matterId,
          documentId: ref.objectId,
          tagId,
        });
      }
      return;
    }
    case "memory": {
      const [updated] = await db
        .update(matterMemories)
        .set({
          title: String(payload.title ?? ""),
          content: String(payload.content ?? ""),
          normalizedContent: String(payload.content ?? "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim(),
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected" ||
            payload.status === "archived" ||
            payload.status === "superseded"
              ? payload.status
              : "proposed",
          importance:
            payload.importance === "low" ||
            payload.importance === "normal" ||
            payload.importance === "high" ||
            payload.importance === "critical"
              ? payload.importance
              : "normal",
          sourceType: typeof payload.sourceType === "string" ? payload.sourceType : null,
          sourceReference:
            payload.sourceReference && typeof payload.sourceReference === "object"
              ? (payload.sourceReference as Record<string, unknown>)
              : {},
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(matterMemories.id, ref.objectId),
            eq(matterMemories.organizationId, ref.organizationId),
            eq(matterMemories.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Memory item not found in this case.");
      return;
    }
    case "graph_node": {
      const [updated] = await db
        .update(graphNodes)
        .set({
          displayName: String(payload.displayName ?? ""),
          metadata: {
            ...(payload.metadata && typeof payload.metadata === "object"
              ? (payload.metadata as Record<string, unknown>)
              : {}),
            semanticOverride: true,
          },
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "approved",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(graphNodes.id, ref.objectId),
            eq(graphNodes.organizationId, ref.organizationId),
            eq(graphNodes.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Graph item not found in this case.");
      return;
    }
    case "graph_edge": {
      const [updated] = await db
        .update(graphEdges)
        .set({
          label: typeof payload.label === "string" ? payload.label : null,
          relationshipType: String(payload.relationshipType ?? "related_to"),
          metadata: {
            ...(payload.metadata && typeof payload.metadata === "object"
              ? (payload.metadata as Record<string, unknown>)
              : {}),
            semanticOverride: true,
          },
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "proposed",
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(graphEdges.id, ref.objectId),
            eq(graphEdges.organizationId, ref.organizationId),
            eq(graphEdges.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Graph relationship not found in this case.");
      return;
    }
    case "fact": {
      const [updated] = await db
        .update(matterFacts)
        .set({
          label: String(payload.label ?? ""),
          value: String(payload.value ?? ""),
          normalizedValue: typeof payload.normalizedValue === "string" ? payload.normalizedValue : null,
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "proposed",
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(matterFacts.id, ref.objectId),
            eq(matterFacts.organizationId, ref.organizationId),
            eq(matterFacts.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Fact not found in this case.");
      return;
    }
    case "entity": {
      const [updated] = await db
        .update(matterEntities)
        .set({
          displayName: String(payload.displayName ?? ""),
          description: typeof payload.description === "string" ? payload.description : null,
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "proposed",
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(matterEntities.id, ref.objectId),
            eq(matterEntities.organizationId, ref.organizationId),
            eq(matterEntities.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Person or organization not found in this case.");
      return;
    }
    case "deadline": {
      const [updated] = await db
        .update(deadlineCandidates)
        .set({
          title: String(payload.title ?? ""),
          description: typeof payload.description === "string" ? payload.description : null,
          dueAt: parseDate(payload.dueAt),
          status:
            payload.status === "proposed" ||
            payload.status === "approved" ||
            payload.status === "edited_and_approved" ||
            payload.status === "rejected"
              ? payload.status
              : "proposed",
          approvedByUserId: typeof payload.approvedByUserId === "string" ? payload.approvedByUserId : null,
          approvedAt: parseDate(payload.approvedAt),
          rejectedByUserId: typeof payload.rejectedByUserId === "string" ? payload.rejectedByUserId : null,
          rejectedAt: parseDate(payload.rejectedAt),
          rejectionReason: typeof payload.rejectionReason === "string" ? payload.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(deadlineCandidates.id, ref.objectId),
            eq(deadlineCandidates.organizationId, ref.organizationId),
            eq(deadlineCandidates.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Deadline not found in this case.");
      return;
    }
    case "summary": {
      const [inserted] = await db
        .insert(matterSummaries)
        .values({
          organizationId: ref.organizationId,
          matterId: ref.matterId,
          summary: String(payload.summary ?? ""),
          provider: typeof payload.provider === "string" ? payload.provider : "restore",
          model: typeof payload.model === "string" ? payload.model : "restore",
          promptVersion: typeof payload.promptVersion === "string" ? payload.promptVersion : "restore",
          provenance:
            payload.provenance && typeof payload.provenance === "object"
              ? (payload.provenance as Record<string, unknown>)
              : { restored: true },
        })
        .returning();
      if (!inserted) throw new LegalWorkNotFoundError("Summary could not be restored.");
      payload.nativeSummaryId = inserted.id;
      return;
    }
    case "analysis": {
      const [updated] = await db
        .update(analysisFindings)
        .set({
          title: String(payload.title ?? ""),
          explanation: typeof payload.explanation === "string" ? payload.explanation : null,
          status:
            payload.status === "proposed" || payload.status === "reviewed" || payload.status === "dismissed"
              ? payload.status
              : "proposed",
          reviewNote: typeof payload.reviewNote === "string" ? payload.reviewNote : null,
          reviewedByUserId: typeof payload.reviewedByUserId === "string" ? payload.reviewedByUserId : null,
          reviewedAt: parseDate(payload.reviewedAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(analysisFindings.id, ref.objectId),
            eq(analysisFindings.organizationId, ref.organizationId),
            eq(analysisFindings.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Analysis item not found in this case.");
      return;
    }
    case "analysis_item": {
      const [updated] = await db
        .update(documentAnalysisItems)
        .set({
          title: String(payload.title ?? ""),
          summary: typeof payload.summary === "string" ? payload.summary : null,
          explanation: typeof payload.explanation === "string" ? payload.explanation : null,
          attention:
            payload.attention === "informational" ||
            payload.attention === "review" ||
            payload.attention === "high_attention"
              ? payload.attention
              : "informational",
          status:
            payload.status === "proposed" ||
            payload.status === "reviewed" ||
            payload.status === "dismissed"
              ? payload.status
              : "proposed",
          reviewedByUserId: typeof payload.reviewedByUserId === "string" ? payload.reviewedByUserId : null,
          reviewedAt: parseDate(payload.reviewedAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentAnalysisItems.id, ref.objectId),
            eq(documentAnalysisItems.organizationId, ref.organizationId),
            eq(documentAnalysisItems.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Analysis item not found in this case.");
      return;
    }
    case "redline": {
      const [updated] = await db
        .update(redlineSuggestions)
        .set({
          status:
            payload.status === "proposed" || payload.status === "accepted" || payload.status === "rejected"
              ? payload.status
              : "proposed",
          reviewedByUserId: typeof payload.reviewedByUserId === "string" ? payload.reviewedByUserId : null,
          reviewedAt: parseDate(payload.reviewedAt),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(redlineSuggestions.id, ref.objectId),
            eq(redlineSuggestions.organizationId, ref.organizationId),
            eq(redlineSuggestions.matterId, ref.matterId),
          ),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Suggested edit not found in this case.");
      return;
    }
    case "task": {
      const [updated] = await db
        .update(tasks)
        .set({
          title: String(payload.title ?? ""),
          description: typeof payload.description === "string" ? payload.description : null,
          status:
            payload.status === "open" ||
            payload.status === "in_progress" ||
            payload.status === "completed" ||
            payload.status === "cancelled"
              ? payload.status
              : "open",
          priority:
            payload.priority === "low" ||
            payload.priority === "medium" ||
            payload.priority === "high" ||
            payload.priority === "urgent"
              ? payload.priority
              : "medium",
          dueAt: parseDate(payload.dueAt),
          updatedAt: new Date(),
        })
        .where(
          and(eq(tasks.id, ref.objectId), eq(tasks.organizationId, ref.organizationId), eq(tasks.matterId, ref.matterId)),
        )
        .returning();
      if (!updated) throw new LegalWorkNotFoundError("Task not found in this case.");
      return;
    }
    default:
      throw new LegalWorkNotFoundError("This work type cannot be restored.");
  }
}

export async function listDownstreamRefs(
  db: Database,
  ref: ObjectRef,
  types: LegalWorkObjectType[],
): Promise<Array<{ objectType: LegalWorkObjectType; objectId: string }>> {
  if (types.length === 0) return [];
  const rows = await db
    .select({
      objectType: legalWorkHeads.objectType,
      objectId: legalWorkHeads.objectId,
    })
    .from(legalWorkHeads)
    .where(
      and(
        eq(legalWorkHeads.organizationId, ref.organizationId),
        eq(legalWorkHeads.matterId, ref.matterId),
        inArray(legalWorkHeads.objectType, types),
      ),
    );
  return rows
    .filter((row) => !(row.objectType === ref.objectType && row.objectId === ref.objectId))
    .map((row) => ({
      objectType: row.objectType as LegalWorkObjectType,
      objectId: row.objectId,
    }));
}
