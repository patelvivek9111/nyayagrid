import { and, asc, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  documentChunks,
  documentDuplicateGroups,
  documentDuplicateMembers,
  documentReviewStates,
  documentTagAssignments,
  documentVersions,
  documents,
  matterDocumentTags,
  matters,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildDiscoveryClassificationSystemPrompt,
  buildDiscoveryClassificationUserPrompt,
  discoveryClassificationSchema,
  DISCOVERY_CLASSIFICATION_PROMPT_VERSION,
  type AIProvider,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";

export async function ensureReviewState(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
}) {
  const [existing] = await params.db
    .select()
    .from(documentReviewStates)
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
        eq(documentReviewStates.documentId, params.documentId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await params.db
    .insert(documentReviewStates)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentId: params.documentId,
    })
    .returning();
  return created!;
}

export async function listDiscoveryQueue(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  pendingOnly?: boolean;
}) {
  const docs = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .orderBy(desc(documents.createdAt));

  const reviewStates = await params.db
    .select()
    .from(documentReviewStates)
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
      ),
    );
  const reviewByDoc = new Map(reviewStates.map((r) => [r.documentId, r]));

  const items = docs.map((doc) => ({
    document: doc,
    reviewState: reviewByDoc.get(doc.id) ?? null,
  }));

  if (!params.pendingOnly) return items;

  return items.filter(({ reviewState }) => {
    if (!reviewState) return true;
    return (
      reviewState.relevance === "unknown" ||
      reviewState.privilege === "unknown" ||
      reviewState.responsiveness === "unknown" ||
      reviewState.confidentiality === "unknown"
    );
  });
}

export async function updateDiscoveryReview(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  userId: string;
  relevance?: "unknown" | "relevant" | "not_relevant";
  privilege?: "unknown" | "potentially_privileged" | "privileged" | "not_privileged";
  responsiveness?: "unknown" | "responsive" | "not_responsive";
  confidentiality?: "unknown" | "confidential" | "not_confidential";
  notes?: string | null;
  humanPrivilegeFinal?: boolean;
}) {
  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Document not found in matter scope");

  if (
    params.privilege &&
    (params.privilege === "privileged" || params.privilege === "not_privileged") &&
    !params.humanPrivilegeFinal
  ) {
    throw new Error(
      "Setting privilege to privileged or not_privileged requires humanPrivilegeFinal",
    );
  }

  await ensureReviewState({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
  });

  const now = new Date();
  const patch: Record<string, unknown> = {
    reviewedByUserId: params.userId,
    reviewedAt: now,
    updatedAt: now,
  };
  if (params.relevance !== undefined) patch.relevance = params.relevance;
  if (params.responsiveness !== undefined) patch.responsiveness = params.responsiveness;
  if (params.confidentiality !== undefined) patch.confidentiality = params.confidentiality;
  if (params.notes !== undefined) patch.reviewNotes = params.notes;
  if (params.privilege !== undefined) {
    patch.privilege = params.privilege;
    if (params.privilege === "privileged" || params.privilege === "not_privileged") {
      patch.humanPrivilegeFinal = true;
    }
  }
  if (params.humanPrivilegeFinal !== undefined) {
    patch.humanPrivilegeFinal = params.humanPrivilegeFinal;
  }

  const [updated] = await params.db
    .update(documentReviewStates)
    .set(patch)
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
        eq(documentReviewStates.documentId, params.documentId),
      ),
    )
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.review_updated",
    targetType: "document",
    targetId: params.documentId,
    metadata: {
      relevance: params.relevance ?? null,
      privilege: params.privilege ?? null,
      humanPrivilegeFinal: params.humanPrivilegeFinal ?? null,
    },
  });

  return updated!;
}

export async function proposeDiscoveryClassification(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  userId: string;
  ai?: AIProvider;
  requestSummary?: string | null;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();

  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Document not found in matter scope");

  const [matter] = await params.db
    .select()
    .from(matters)
    .where(and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)))
    .limit(1);
  if (!matter) throw new Error("Matter not found");

  const [firstChunk] = await params.db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        eq(documentChunks.documentId, params.documentId),
      ),
    )
    .orderBy(asc(documentChunks.chunkIndex))
    .limit(1);

  const excerpt = firstChunk?.content.slice(0, 2000) ?? doc.title;

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "discovery_classification",
    routing: {
      subsystem: "evidence",
      strategy: "standard",
      organizationId: params.organizationId,
      matterId: params.matterId,
    },
    messages: [
      { role: "system", content: buildDiscoveryClassificationSystemPrompt() },
      {
        role: "user",
        content: buildDiscoveryClassificationUserPrompt({
          matterTitle: matter.title,
          documentTitle: doc.title,
          requestSummary: params.requestSummary,
          excerpt,
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = {
      relevance: "unknown",
      privilege: "unknown",
      responsiveness: "unknown",
      confidentiality: "unknown",
    };
  }
  const parsed = discoveryClassificationSchema.parse(raw);

  await ensureReviewState({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
  });

  const now = new Date();
  const [updated] = await params.db
    .update(documentReviewStates)
    .set({
      aiRelevance: parsed.relevance,
      aiPrivilege: parsed.privilege,
      aiResponsiveness: parsed.responsiveness,
      aiProposalNote: parsed.proposalNote ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
        eq(documentReviewStates.documentId, params.documentId),
      ),
    )
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.classification_proposed",
    targetType: "document",
    targetId: params.documentId,
    metadata: {
      aiRelevance: parsed.relevance,
      aiPrivilege: parsed.privilege,
      provider: generation.provider,
      promptVersion: DISCOVERY_CLASSIFICATION_PROMPT_VERSION,
    },
  });

  return {
    reviewState: updated!,
    proposal: parsed,
    provider: generation.provider,
    model: generation.model,
  };
}

export async function createTag(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  key: string;
  label: string;
}) {
  const normalizedKey = params.key.trim().toLowerCase().replace(/\s+/g, "_");
  const [existing] = await params.db
    .select()
    .from(matterDocumentTags)
    .where(
      and(
        eq(matterDocumentTags.matterId, params.matterId),
        eq(matterDocumentTags.key, normalizedKey),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [tag] = await params.db
    .insert(matterDocumentTags)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      key: normalizedKey,
      label: params.label.trim(),
      createdByUserId: params.userId,
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.tag_created",
    targetType: "matter_document_tag",
    targetId: tag!.id,
    metadata: { key: normalizedKey },
  });

  return tag!;
}

export async function assignTag(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  tagId: string;
  userId: string;
}) {
  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Document not found in matter scope");

  const [tag] = await params.db
    .select()
    .from(matterDocumentTags)
    .where(
      and(
        eq(matterDocumentTags.id, params.tagId),
        eq(matterDocumentTags.organizationId, params.organizationId),
        eq(matterDocumentTags.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!tag) throw new Error("Tag not found in matter scope");

  const [existing] = await params.db
    .select()
    .from(documentTagAssignments)
    .where(
      and(
        eq(documentTagAssignments.documentId, params.documentId),
        eq(documentTagAssignments.tagId, params.tagId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [assignment] = await params.db
    .insert(documentTagAssignments)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentId: params.documentId,
      tagId: params.tagId,
      createdByUserId: params.userId,
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "discovery.tag_assigned",
    targetType: "document",
    targetId: params.documentId,
    metadata: { tagId: params.tagId },
  });

  return assignment!;
}

export async function listTags(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId?: string;
}) {
  const tags = await params.db
    .select()
    .from(matterDocumentTags)
    .where(
      and(
        eq(matterDocumentTags.organizationId, params.organizationId),
        eq(matterDocumentTags.matterId, params.matterId),
      ),
    )
    .orderBy(asc(matterDocumentTags.label));

  if (!params.documentId) return tags.map((t) => ({ ...t, assigned: false }));

  const assignments = await params.db
    .select()
    .from(documentTagAssignments)
    .where(
      and(
        eq(documentTagAssignments.organizationId, params.organizationId),
        eq(documentTagAssignments.matterId, params.matterId),
        eq(documentTagAssignments.documentId, params.documentId),
      ),
    );
  const assignedIds = new Set(assignments.map((a) => a.tagId));

  return tags.map((t) => ({ ...t, assigned: assignedIds.has(t.id) }));
}

export async function detectExactDuplicates(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
}) {
  const rows = await params.db
    .select({
      documentId: documents.id,
      documentVersionId: documentVersions.id,
      sha256: documentVersions.sha256,
      versionNumber: documentVersions.versionNumber,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    );

  const latestByDocument = new Map<
    string,
    { documentId: string; documentVersionId: string; sha256: string; versionNumber: number }
  >();
  for (const row of rows) {
    const current = latestByDocument.get(row.documentId);
    if (!current || row.versionNumber > current.versionNumber) {
      latestByDocument.set(row.documentId, row);
    }
  }

  const byHash = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of latestByDocument.values()) {
    const list = byHash.get(row.sha256) ?? [];
    list.push(row);
    byHash.set(row.sha256, list);
  }

  let groupsCreated = 0;
  let membersAdded = 0;

  for (const [fingerprint, members] of byHash.entries()) {
    if (members.length < 2) continue;

    const [group] = await params.db
      .insert(documentDuplicateGroups)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        groupType: "exact_hash",
        fingerprint,
      })
      .onConflictDoNothing()
      .returning();

    let groupId = group?.id;
    if (!groupId) {
      const [existing] = await params.db
        .select()
        .from(documentDuplicateGroups)
        .where(
          and(
            eq(documentDuplicateGroups.matterId, params.matterId),
            eq(documentDuplicateGroups.groupType, "exact_hash"),
            eq(documentDuplicateGroups.fingerprint, fingerprint),
          ),
        )
        .limit(1);
      groupId = existing?.id;
    }
    if (!groupId) continue;
    if (group) groupsCreated += 1;

    for (const member of members) {
      const [inserted] = await params.db
        .insert(documentDuplicateMembers)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          groupId,
          documentId: member.documentId,
          documentVersionId: member.documentVersionId,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) membersAdded += 1;
    }
  }

  if (params.userId) {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: params.matterId,
      action: "discovery.exact_duplicates_detected",
      targetType: "matter",
      targetId: params.matterId,
      metadata: { groupsCreated, membersAdded },
    });
  }

  return { groupsCreated, membersAdded };
}

export async function detectNearDuplicates(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
}) {
  const firstChunks = await params.db
    .select({
      documentId: documentChunks.documentId,
      documentVersionId: documentChunks.documentVersionId,
      content: documentChunks.content,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        eq(documentChunks.chunkIndex, 0),
      ),
    );

  const byFingerprint = new Map<string, Array<{ documentId: string; documentVersionId: string }>>();
  for (const row of firstChunks) {
    const fingerprint = normalizeExcerpt(row.content.slice(0, 500));
    if (!fingerprint) continue;
    const list = byFingerprint.get(fingerprint) ?? [];
    list.push({ documentId: row.documentId, documentVersionId: row.documentVersionId });
    byFingerprint.set(fingerprint, list);
  }

  let groupsCreated = 0;
  let membersAdded = 0;

  for (const [fingerprint, members] of byFingerprint.entries()) {
    if (members.length < 2) continue;

    const [group] = await params.db
      .insert(documentDuplicateGroups)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        groupType: "near_excerpt",
        fingerprint,
      })
      .onConflictDoNothing()
      .returning();

    let groupId = group?.id;
    if (!groupId) {
      const [existing] = await params.db
        .select()
        .from(documentDuplicateGroups)
        .where(
          and(
            eq(documentDuplicateGroups.matterId, params.matterId),
            eq(documentDuplicateGroups.groupType, "near_excerpt"),
            eq(documentDuplicateGroups.fingerprint, fingerprint),
          ),
        )
        .limit(1);
      groupId = existing?.id;
    }
    if (!groupId) continue;
    if (group) groupsCreated += 1;

    for (const member of members) {
      const [inserted] = await params.db
        .insert(documentDuplicateMembers)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          groupId,
          documentId: member.documentId,
          documentVersionId: member.documentVersionId,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) membersAdded += 1;
    }
  }

  if (params.userId) {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: params.matterId,
      action: "discovery.near_duplicates_detected",
      targetType: "matter",
      targetId: params.matterId,
      metadata: { groupsCreated, membersAdded },
    });
  }

  return { groupsCreated, membersAdded };
}

function normalizeExcerpt(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
