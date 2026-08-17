import { z } from "zod";

export const organizationTypeSchema = z.enum(["firm", "solo"]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: organizationTypeSchema.default("firm"),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export const inviteMembershipSchema = z.object({
  email: z.string().email(),
  roleKey: z.string().min(1),
});

export const acceptOrganizationInviteSchema = z.object({
  token: z.string().trim().min(1).max(1000),
});

export const capabilitySchema = z.enum([
  "organization.manage",
  "members.invite",
  "members.remove",
  "clients.view",
  "clients.edit",
  "matters.create",
  "matters.view",
  "matters.edit",
  "matters.close",
  "documents.upload",
  "documents.view",
  "documents.edit",
  "documents.delete",
  "timeline.manage",
  "research.run",
  "drafts.create",
  "audit.view",
  "compliance.manage",
]);

export type Capability = z.infer<typeof capabilitySchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const documentProcessingStateSchema = z.enum([
  "uploaded",
  "quarantined",
  "awaiting_malware_scan",
  "malware_scan_failed",
  "unscanned_development",
  "scan_clean",
  "scan_blocked",
  "extracting_text",
  "requires_ocr",
  "extraction_failed",
  "chunking",
  "embedding",
  "indexed",
  "ready",
  "failed",
]);

export type DocumentProcessingState = z.infer<typeof documentProcessingStateSchema>;

export const createClientSchema = z.object({
  organizationId: z.string().uuid(),
  clientType: z.enum(["individual", "organization"]),
  displayName: z.string().trim().min(1).max(300),
  firstName: z.string().trim().max(120).optional().nullable(),
  lastName: z.string().trim().max(120).optional().nullable(),
  organizationName: z.string().trim().max(300).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().max(10000).optional().nullable(),
});

export const updateClientSchema = createClientSchema
  .omit({ organizationId: true })
  .partial()
  .extend({
    status: z.enum(["active", "archived"]).optional(),
  });

export const createMatterSchema = z.object({
  organizationId: z.string().uuid(),
  clientId: z.string().uuid(),
  matterNumber: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).optional().nullable(),
  practiceArea: z.string().trim().max(120).optional().nullable(),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  court: z.string().trim().max(200).optional().nullable(),
  status: z.enum(["intake", "open", "active", "on_hold", "closed", "archived"]).optional(),
});

export const updateMatterSchema = createMatterSchema
  .omit({ organizationId: true, clientId: true })
  .partial();

export const askNyayaSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  conversationId: z.string().uuid().optional().nullable(),
});

export const agentModeSchema = z.enum(["ask", "task", "auto"]);

/** Ask-or-task entry point: `mode` controls whether the request is routed as Q&A, a forced agent
 * run, or auto-classified. Defaults to "auto" so existing ask-only callers keep working. */
export const askOrTaskSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  conversationId: z.string().uuid().optional().nullable(),
  mode: agentModeSchema.optional(),
  execute: z.boolean().optional(),
});

export const runAgentTaskSchema = z.object({
  goal: z.string().trim().min(3).max(4000),
  execute: z.boolean().optional(),
  conversationId: z.string().uuid().optional().nullable(),
});

export const reviewAgentApprovalSchema = z.object({
  action: z.enum(["approve", "edit_and_approve", "reject"]),
  edits: z.record(z.unknown()).optional(),
  note: z.string().max(2000).optional().nullable(),
});

export const cancelAgentRunSchema = z.object({
  reason: z.string().max(2000).optional().nullable(),
});

export const saveNyayaNoteSchema = z.object({
  artifactId: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
});

export const createManualNoteSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20000),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  sourceArtifactId: z.string().uuid().optional().nullable(),
  sourceNoteId: z.string().uuid().optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(10000).optional().nullable(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

export const datePrecisionSchema = z.enum([
  "exact",
  "approximate",
  "month",
  "year",
  "range",
  "unknown",
]);

export const intelligenceReviewActionSchema = z.enum(["approve", "edit_and_approve", "reject"]);

export const reviewTimelineEventSchema = z.object({
  action: intelligenceReviewActionSchema,
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(5000).optional().nullable(),
      eventType: z.string().trim().min(1).max(120).optional(),
      eventDate: z.string().optional().nullable(),
      eventDateEnd: z.string().optional().nullable(),
      datePrecision: datePrecisionSchema.optional(),
      actors: z.array(z.string()).optional(),
    })
    .optional(),
});

export const createTimelineEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  eventType: z.string().trim().min(1).max(120),
  eventDate: z.string().optional().nullable(),
  eventDateEnd: z.string().optional().nullable(),
  datePrecision: datePrecisionSchema.optional(),
  actors: z.array(z.string()).optional(),
  sourceChunkIds: z.array(z.string().uuid()).optional(),
});

export const reviewMatterFactSchema = z.object({
  action: intelligenceReviewActionSchema,
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      factKey: z.string().trim().min(1).max(120).optional(),
      label: z.string().trim().min(1).max(300).optional(),
      value: z.string().trim().min(1).max(2000).optional(),
      normalizedValue: z.string().max(2000).optional().nullable(),
    })
    .optional(),
});

export const reviewMatterEntitySchema = z.object({
  action: intelligenceReviewActionSchema,
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      displayName: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(2000).optional().nullable(),
      entityType: z.enum(["person", "organization"]).optional(),
      roles: z.array(z.string().trim().min(1).max(120)).optional(),
      aliases: z.array(z.string().trim().min(1).max(300)).optional(),
    })
    .optional(),
});

export const createMatterEntitySchema = z.object({
  entityType: z.enum(["person", "organization"]),
  displayName: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  roles: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
});

export const mergeMatterEntitiesSchema = z.object({
  keepEntityId: z.string().uuid(),
  mergeEntityId: z.string().uuid(),
});

export const reviewDeadlineSchema = z.object({
  action: intelligenceReviewActionSchema,
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(5000).optional().nullable(),
      dueAt: z.string().optional().nullable(),
      dueAtEnd: z.string().optional().nullable(),
      datePrecision: datePrecisionSchema.optional(),
      dateKind: z.enum(["explicit", "inferred"]).optional(),
    })
    .optional(),
});

export const extractIntelligenceSchema = z.object({
  documentVersionId: z.string().uuid().optional().nullable(),
  force: z.boolean().optional(),
});

export const materializeGraphSchema = z.object({
  force: z.boolean().optional(),
});

export const createGraphEdgeSchema = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  relationshipType: z.string().trim().min(1).max(120),
  label: z.string().trim().max(300).optional().nullable(),
});

export const reviewGraphEdgeSchema = z.object({
  action: intelligenceReviewActionSchema,
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      label: z.string().max(300).optional().nullable(),
      relationshipType: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
});

export const createMatterMemorySchema = z.object({
  memoryType: z.enum([
    "verified_context",
    "strategic_note",
    "entity_resolution",
    "document_significance",
    "factual_caveat",
    "user_instruction",
    "matter_preference",
    "procedural_context",
    "other",
  ]),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(8000),
  importance: z.enum(["low", "normal", "high", "critical"]).optional(),
  supersedesId: z.string().uuid().optional().nullable(),
});

export const reviewMatterMemorySchema = z.object({
  action: z.enum(["approve", "edit_and_approve", "reject", "archive"]),
  rejectionReason: z.string().max(2000).optional().nullable(),
  edits: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      content: z.string().trim().min(1).max(8000).optional(),
      memoryType: z
        .enum([
          "verified_context",
          "strategic_note",
          "entity_resolution",
          "document_significance",
          "factual_caveat",
          "user_instruction",
          "matter_preference",
          "procedural_context",
          "other",
        ])
        .optional(),
      importance: z.enum(["low", "normal", "high", "critical"]).optional(),
    })
    .optional(),
});

export const proposeMatterMemorySchema = z.object({
  question: z.string().trim().max(4000).optional().nullable(),
  hint: z.string().trim().max(2000).optional().nullable(),
});

export const supersedeMatterMemorySchema = z.object({
  oldMemoryId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(8000),
  memoryType: z
    .enum([
      "verified_context",
      "strategic_note",
      "entity_resolution",
      "document_significance",
      "factual_caveat",
      "user_instruction",
      "matter_preference",
      "procedural_context",
      "other",
    ])
    .optional(),
  importance: z.enum(["low", "normal", "high", "critical"]).optional(),
});

export const citedAnswerSchema = z.object({
  answer: z.string(),
  sources: z.array(
    z.object({
      chunkId: z.string().optional(),
      documentId: z.string(),
      documentVersionId: z.string(),
      page: z.number().optional(),
      paragraph: z.string().optional(),
      quote: z.string(),
    }),
  ),
  assumptions: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  evidenceState: z.enum(["grounded", "insufficient", "partial"]).optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export const draftTypeSchema = z.enum([
  "demand_letter",
  "complaint",
  "motion",
  "brief",
  "contract",
  "settlement_agreement",
  "discovery_request",
  "correspondence",
  "memo",
  "other",
]);

export const createDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  draftType: draftTypeSchema,
  content: z.string().max(200000).optional(),
});

export const generateDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  draftType: draftTypeSchema,
  instructions: z.string().trim().max(4000).optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});

export const saveDraftVersionSchema = z.object({
  content: z.string().min(1).max(200000),
  changeSummary: z.string().max(2000).optional(),
});

export const transformDraftSchema = z.object({
  action: z.enum(["shorten", "expand", "change_tone", "regenerate"]),
  sectionHint: z.string().max(500).optional(),
  toneHint: z.string().max(500).optional(),
});

export const restoreDraftVersionSchema = z.object({
  versionId: z.string().uuid(),
});

export const updateDraftStatusSchema = z.object({
  status: z.enum(["draft", "in_review", "archived"]),
});

export const analyzeContractSchema = z.object({
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  force: z.boolean().optional(),
});

export const reviewAnalysisItemSchema = z.object({
  action: z.enum(["reviewed", "dismissed"]),
});

export const generateRedlinesSchema = z.object({
  focus: z.string().max(1000).optional(),
});

export const reviewRedlineSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

export const compareDocumentsSchema = z.object({
  documentAId: z.string().uuid(),
  versionAId: z.string().uuid(),
  documentBId: z.string().uuid(),
  versionBId: z.string().uuid(),
});

export const analyzeDepositionSchema = z.object({
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  force: z.boolean().optional(),
});

export const detectContradictionsSchema = z.object({
  documentId: z.string().uuid().optional(),
  force: z.boolean().optional(),
});

export const reviewFindingSchema = z.object({
  action: z.enum(["reviewed", "dismissed"]),
  note: z.string().max(2000).optional().nullable(),
});

export const markImportantSchema = z.object({
  important: z.boolean(),
});

export const updateDiscoveryReviewSchema = z.object({
  relevance: z.enum(["unknown", "relevant", "not_relevant"]).optional(),
  privilege: z
    .enum(["unknown", "potentially_privileged", "privileged", "not_privileged"])
    .optional(),
  responsiveness: z.enum(["unknown", "responsive", "not_responsive"]).optional(),
  confidentiality: z.enum(["unknown", "confidential", "not_confidential"]).optional(),
  notes: z.string().max(4000).optional().nullable(),
  humanPrivilegeFinal: z.boolean().optional(),
});

export const proposeDiscoveryClassificationSchema = z.object({
  requestSummary: z.string().max(2000).optional().nullable(),
});

export const createTagSchema = z.object({
  label: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(120).optional(),
});

export const assignTagSchema = z.object({
  documentId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export const detectDuplicatesSchema = z.object({
  near: z.boolean().optional(),
});

export const createResearchSessionSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  matterId: z.string().uuid().optional().nullable(),
  jurisdictionFilters: z.array(z.string().trim().min(1).max(120)).optional(),
  authorityTypeFilters: z.array(z.string().trim().min(1).max(60)).optional(),
  dateFrom: z.string().optional().nullable(),
  dateTo: z.string().optional().nullable(),
});

export const researchSearchFiltersSchema = z.object({
  jurisdiction: z.string().trim().max(120).optional(),
  court: z.string().trim().max(200).optional(),
  authorityType: z.string().trim().max(60).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  citation: z.string().trim().max(300).optional(),
  title: z.string().trim().max(300).optional(),
  sourceProvider: z.string().trim().max(120).optional(),
});

export const runResearchQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  queryText: z.string().trim().min(3).max(4000),
  filters: researchSearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  includeMatterContext: z.boolean().optional(),
});

export const summarizeAuthoritySchema = z.object({
  organizationId: z.string().uuid().optional(),
  researchQuestion: z.string().trim().max(2000).optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
});

export const generateResearchMemoSchema = z.object({
  organizationId: z.string().uuid().optional(),
  researchQuestion: z.string().trim().min(3).max(4000),
  authorityIds: z.array(z.string().uuid()).max(20).optional(),
  includeMatterContext: z.boolean().optional(),
});

export const saveMatterAuthoritySchema = z.object({
  authorityId: z.string().uuid(),
  status: z.enum(["saved", "key_authority", "rejected", "not_relevant"]).optional(),
  relevanceNote: z.string().trim().max(4000).optional().nullable(),
});

export const updateMatterAuthoritySchema = z.object({
  status: z.enum(["saved", "key_authority", "rejected", "not_relevant"]),
  relevanceNote: z.string().trim().max(4000).optional().nullable(),
});

export const createResearchNoteSchema = z.object({
  organizationId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(8000),
  authorityId: z.string().uuid().optional().nullable(),
  authorityChunkId: z.string().uuid().optional().nullable(),
});

const authorityHierarchyNodeInputSchema = z.object({
  level: z.string().min(1),
  ref: z.string().min(1),
  label: z.string().optional(),
});

export const importAuthorityMetadataSchema = z
  .object({
    title: z.string().trim().min(3).max(500),
    authorityType: z.enum([
      "case",
      "statute",
      "regulation",
      "constitution",
      "rule",
      "administrative_decision",
      "other",
    ]),
    content: z.string().min(20),
    sourceProvider: z.string().trim().min(1).max(120),
    sourceExternalId: z.string().trim().min(1).max(300),
    shortTitle: z.string().trim().max(300).optional().nullable(),
    citation: z.string().trim().max(300).optional().nullable(),
    normalizedCitation: z.string().trim().max(300).optional().nullable(),
    jurisdiction: z.string().trim().max(120).optional().nullable(),
    court: z.string().trim().max(200).optional().nullable(),
    docketNumber: z.string().trim().max(120).optional().nullable(),
    decisionDate: z.string().optional().nullable(),
    effectiveDate: z.string().optional().nullable(),
    effectiveFrom: z.string().optional().nullable(),
    effectiveTo: z.string().optional().nullable(),
    publicationStatus: z.string().trim().max(60).optional().nullable(),
    canonicalSourceUrl: z.string().trim().max(2000).optional().nullable(),
    hierarchyPath: z.array(authorityHierarchyNodeInputSchema).optional(),
    opinionParts: z
      .array(
        z.object({
          part: z.enum(["majority", "concurrence", "dissent"]),
          content: z.string().min(1),
        }),
      )
      .optional(),
    sections: z
      .array(
        z.object({
          sectionRef: z.string().min(1),
          subsectionRef: z.string().optional().nullable(),
          content: z.string().min(1),
        }),
      )
      .optional(),
    treatmentStatus: z.enum(["unknown", "source_reported"]).optional(),
    metadata: z.record(z.unknown()).optional(),
    sourceMetadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const importAuthorityRequestSchema = z.object({
  organizationId: z.string().uuid(),
  authorities: z.array(importAuthorityMetadataSchema).min(1).max(200),
});

/**
 * Nyaya Professor (Student Workspace) and Nyaya Guide (Public Workspace) request schemas.
 *
 * Every schema below is user-scoped by construction: none of them carry an organizationId or a
 * matterId field, because student study material and personal Guide documents must never be
 * routable into the professional/tenant boundary.
 */
export const explanationLevelRequestSchema = z.enum(["simple", "standard", "advanced"]);

export const askProfessorSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  explanationLevel: explanationLevelRequestSchema.optional(),
  conversationId: z.string().uuid().optional().nullable(),
  caseId: z.string().uuid().optional().nullable(),
});

export const generateCaseBriefSchema = z.object({
  explanationLevel: explanationLevelRequestSchema.optional(),
});

export const compareCasesSchema = z.object({
  caseAId: z.string().uuid(),
  caseBId: z.string().uuid(),
  explanationLevel: explanationLevelRequestSchema.optional(),
});

export const studentSavedItemTypeSchema = z.enum([
  "explanation",
  "case_brief",
  "authority",
  "case_comparison",
]);

export const saveStudentItemSchema = z.object({
  itemType: studentSavedItemTypeSchema,
  title: z.string().trim().min(1).max(300),
  content: z.string().max(20000).optional().nullable(),
  ref: z.record(z.unknown()).default({}),
  courseLabel: z.string().trim().max(80).optional().nullable(),
});

export const ingestStudentCaseSchema = z.object({
  title: z.string().trim().min(3).max(300),
  content: z.string().trim().min(20).optional(),
  citation: z.string().trim().min(1).max(300).optional().nullable(),
  court: z.string().trim().min(1).max(200).optional().nullable(),
  courseLabel: z.string().trim().max(80).optional().nullable(),
});

export const updateStudentCaseSchema = z.object({
  courseLabel: z.string().trim().max(80).optional().nullable(),
});

export const createStudentConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  explanationLevel: explanationLevelRequestSchema.optional(),
  caseId: z.string().uuid().optional().nullable(),
});

export const createStudentNoteSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20000),
  caseId: z.string().uuid().optional().nullable(),
  briefId: z.string().uuid().optional().nullable(),
  kind: z.enum(["note", "brief_challenge"]).optional(),
  sectionKey: z.string().trim().min(1).max(80).optional().nullable(),
  courseLabel: z.string().trim().max(80).optional().nullable(),
});

export const updateStudentNoteSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  courseLabel: z.string().trim().max(80).optional().nullable(),
});

export const challengeBriefSectionSchema = z.object({
  sectionKey: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(4000),
});

export const askGuideSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  situationId: z.string().uuid().optional().nullable(),
});

export const createGuideConversationRequestSchema = z.object({
  title: z.string().trim().max(300).optional().nullable(),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
});

export const guideDocumentKindSchema = z.enum([
  "lease",
  "employment",
  "court_notice",
  "demand",
  "settlement",
  "other",
]);

export const ingestGuideDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  documentKind: guideDocumentKindSchema.optional(),
  content: z.string().trim().min(1),
});

export const explainGuideDocumentSchema = z.object({}).strict().optional();

export const createGuideSituationSchema = z.object({
  title: z.string().trim().min(1).max(300),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  issueCategory: z.string().trim().max(120).optional().nullable(),
  desiredOutcome: z.string().max(2000).optional().nullable(),
});

export const updateGuideSituationSchema = createGuideSituationSchema.partial();

export const addGuideEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  eventDate: z.string().optional().nullable(),
  eventDateEnd: z.string().optional().nullable(),
  guideDocumentId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export const updateGuideEventSchema = addGuideEventSchema.partial();

export const linkGuideSituationDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const consultationPacketSchema = z.object({}).strict().optional();

/**
 * Phase 9 — data lifecycle (legal holds, deletion requests) and generic cursor pagination.
 */
/** Omitting both matterId and documentId places an organization-wide hold. */
export const placeLegalHoldSchema = z.object({
  matterId: z.string().uuid().optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().min(1).max(2000),
});

export const releaseLegalHoldSchema = z.object({
  releaseReason: z.string().trim().min(1).max(2000).optional().nullable(),
});

export const dataDeletionScopeRequestSchema = z.enum([
  "organization",
  "matter",
  "user_personal_data",
]);

export const requestDataDeletionSchema = z.object({
  scopeType: dataDeletionScopeRequestSchema,
  organizationId: z.string().uuid().optional().nullable(),
  matterId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export const cancelDataDeletionSchema = z.object({
  reason: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Generic cursor-pagination request shape. `cursor` is an opaque, base64url-encoded token minted
 * by `packages/platform`'s `encodeCursor`/`decodeCursor` helpers — callers should never construct
 * or parse it themselves. `limit` is intentionally capped to keep list endpoints cheap.
 */
export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(2000).optional().nullable(),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;

export const createTimeEntrySchema = z.object({
  organizationId: z.string().uuid(),
  matterId: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  minutes: z.number().int().min(1).max(24 * 60),
  source: z.enum(["manual", "chat", "draft"]).optional(),
  conversationId: z.string().uuid().optional().nullable(),
  draftId: z.string().uuid().optional().nullable(),
});

export const suggestTimeFromChatSchema = z.object({
  organizationId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid(),
  minutes: z.number().int().min(1).max(24 * 60).optional(),
});

export const reviewTimeEntrySchema = z.object({
  action: z.enum(["post", "reject"]),
});

export const createInvoiceFromTimeSchema = z.object({
  organizationId: z.string().uuid(),
  matterId: z.string().uuid(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const reviewInvoiceSchema = z.object({
  action: z.enum(["issue", "void"]),
});

export const createInboundEmailSchema = z.object({
  organizationId: z.string().uuid(),
  fromAddress: z.string().trim().min(1).max(320),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(100_000),
});

export const fileInboundEmailSchema = z.object({
  matterId: z.string().uuid(),
});

export const assignMatterMemberSchema = z.object({
  userId: z.string().uuid(),
  access: z.enum(["read", "comment", "edit", "manage"]).default("read"),
});

export const recordTrainingConsentSchema = z.object({
  statement: z.string().trim().min(20).max(4000),
});

export { z };
