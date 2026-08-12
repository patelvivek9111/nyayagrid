import { z } from "zod";
import { and, eq, matters } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { PostgresHybridRetriever } from "@nyayagrid/search";
import { AuthorityHybridRetriever, runResearchQuery } from "@nyayagrid/research";
import {
  analyzeContract,
  analyzeDeposition,
  compareDocuments,
  createDraft,
  createMatterMemory,
  detectContradictionCandidates,
  generateDraft,
  getEvidenceIntelligence,
  getGraphNeighborhood,
  listDiscoveryQueue,
  loadVerifiedMatterIntelligence,
  proposeDiscoveryClassification,
  proposeMatterMemories,
  retrieveActiveMatterMemories,
  saveDraftVersion,
  transformDraftSection,
} from "@nyayagrid/intelligence";
import type { AgentTool, ToolContext, ToolRegistry } from "./registry";
import { createToolRegistry, requireMatterId, toolOk } from "./registry";
import { DEFAULT_BUDGETS } from "../types";

const uuid = z.string().uuid();

function resolveEmbeddings(ctx: ToolContext): EmbeddingProvider {
  return ctx.embeddings ?? createEmbeddingProviderFromEnv();
}

async function loadMatterTitle(
  db: Database,
  organizationId: string,
  matterId: string,
): Promise<string> {
  const [row] = await db
    .select({ title: matters.title })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.organizationId, organizationId)))
    .limit(1);
  return row?.title ?? "(untitled matter)";
}

function clampLimit(limit: number | undefined): number {
  return Math.min(limit ?? 8, DEFAULT_BUDGETS.maxRetrievedContext);
}

/** Zod-typed helper so each tool declaration keeps its input type without repeating generics. */
function defineTool<TInput, TData>(tool: AgentTool<TInput, TData>): AgentTool<never, unknown> {
  return tool as unknown as AgentTool<never, unknown>;
}

const matterRetrievalInput = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(50).optional(),
});

/** Hybrid retrieval over confidential matter document chunks. */
export const searchMatterDocumentsTool = defineTool({
  name: "searchMatterDocuments",
  description:
    "Hybrid vector and full-text retrieval over this matter's document chunks. Returns cited passages only.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: matterRetrievalInput,
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "searchMatterDocuments");
    const retriever = new PostgresHybridRetriever(ctx.db, resolveEmbeddings(ctx));
    const hits = await retriever.search({
      text: input.query,
      scope: {
        organizationId: ctx.organizationId,
        matterId,
        workspace: "professional",
      },
      limit: clampLimit(input.limit),
    });
    return toolOk({
      summary: `Retrieved ${hits.length} matter passage(s) for the query.`,
      data: { hits },
      resourceIds: hits.map((hit) => hit.chunkId),
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

/** Same retrieval path as searchMatterDocuments, shaped for chunk-level context assembly. */
export const retrieveMatterChunksTool = defineTool({
  name: "retrieveMatterChunks",
  description:
    "Retrieve matter document chunks with document and version identifiers for grounding an answer or draft.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: matterRetrievalInput.extend({
    documentIds: z.array(uuid).max(50).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "retrieveMatterChunks");
    const retriever = new PostgresHybridRetriever(ctx.db, resolveEmbeddings(ctx));
    const hits = await retriever.search({
      text: input.query,
      scope: {
        organizationId: ctx.organizationId,
        matterId,
        workspace: "professional",
        ...(input.documentIds ? { allowedDocumentIds: input.documentIds } : {}),
      },
      limit: clampLimit(input.limit),
    });
    const scoped = input.documentIds
      ? hits.filter((hit) => input.documentIds!.includes(hit.documentId))
      : hits;
    return toolOk({
      summary: `Retrieved ${scoped.length} chunk(s) from ${new Set(scoped.map((h) => h.documentId)).size} document(s).`,
      data: { chunks: scoped },
      resourceIds: scoped.map((hit) => hit.chunkId),
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

/**
 * Retrieval over the shared legal authority corpus. This never reads matter documents: a matter
 * document is evidence, not legal authority, and the two provenance classes stay separate.
 */
export const searchLegalAuthoritiesTool = defineTool({
  name: "searchLegalAuthorities",
  description:
    "Search the shared legal authority corpus (cases, statutes, rules). Returns authority citations and snippets.",
  risk: "low",
  capability: "research.run",
  minAccess: "read",
  requiresMatter: false,
  provenanceClass: "LEGAL_AUTHORITY",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(2000),
    jurisdiction: z.string().max(200).optional(),
    authorityType: z.string().max(80).optional(),
    limit: z.number().int().positive().max(25).optional(),
  }),
  async execute(ctx, input) {
    const retriever = new AuthorityHybridRetriever(ctx.db, resolveEmbeddings(ctx));
    const hits = await retriever.search(
      input.query,
      {
        ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
        ...(input.authorityType ? { authorityType: input.authorityType } : {}),
      },
      { limit: clampLimit(input.limit) },
    );
    return toolOk({
      summary: `Found ${hits.length} authority passage(s) in the corpus.`,
      data: { hits },
      resourceIds: hits.map((hit) => hit.authorityId),
      provenanceClass: "LEGAL_AUTHORITY",
    });
  },
});

/** Approved timeline, facts, entities and deadlines only — nothing still awaiting review. */
export const getVerifiedTimelineTool = defineTool({
  name: "getVerifiedTimeline",
  description:
    "Load approved timeline events, facts, entities and deadlines for the matter. Excludes unreviewed proposals.",
  risk: "low",
  capability: "matters.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "VERIFIED_MATTER_INTELLIGENCE",
  inputSchema: z.object({}).default({}),
  async execute(ctx) {
    const matterId = requireMatterId(ctx, "getVerifiedTimeline");
    const verified = await loadVerifiedMatterIntelligence({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
    });
    return toolOk({
      summary: `Verified intelligence: ${verified.events.length} event(s), ${verified.facts.length} fact(s), ${verified.entities.length} entity(ies), ${verified.deadlines.length} deadline(s).`,
      data: verified,
      resourceIds: verified.events.map((event) => event.id),
      provenanceClass: "VERIFIED_MATTER_INTELLIGENCE",
    });
  },
});

export const getMatterGraphNeighborhoodTool = defineTool({
  name: "getMatterGraphNeighborhood",
  description:
    "Load approved graph relationships around one entity node in the matter, with their supporting sources.",
  risk: "low",
  capability: "matters.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "GRAPH_RELATIONSHIP",
  inputSchema: z.object({
    nodeId: uuid,
    relationshipTypes: z.array(z.string().max(80)).max(20).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "getMatterGraphNeighborhood");
    const neighborhood = await getGraphNeighborhood({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      nodeId: input.nodeId,
      ...(input.relationshipTypes ? { relationshipTypes: input.relationshipTypes } : {}),
    });
    if (!neighborhood) {
      return toolOk({
        summary: "No graph node found for that id in this matter.",
        data: null,
        resourceIds: [],
      });
    }
    return toolOk({
      summary: `Graph neighborhood: ${neighborhood.edges.length} approved relationship(s), ${neighborhood.neighbors.length} neighbor node(s).`,
      data: neighborhood,
      resourceIds: neighborhood.edges.map((edge) => edge.id),
      provenanceClass: "GRAPH_RELATIONSHIP",
    });
  },
});

export const retrieveMatterMemoryTool = defineTool({
  name: "retrieveMatterMemory",
  description:
    "Retrieve approved matter memory entries relevant to a question. Memory is attorney-approved context, not evidence.",
  risk: "low",
  capability: "matters.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_MEMORY",
  inputSchema: z.object({
    question: z.string().trim().max(2000).optional(),
    limit: z.number().int().positive().max(25).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "retrieveMatterMemory");
    const memories = await retrieveActiveMatterMemories({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      ...(input.question ? { question: input.question } : {}),
      limit: clampLimit(input.limit),
      embeddings: resolveEmbeddings(ctx),
    });
    return toolOk({
      summary: `Retrieved ${memories.length} approved memory entry(ies).`,
      data: { memories },
      resourceIds: memories.map((memory) => memory.id),
      provenanceClass: "MATTER_MEMORY",
    });
  },
});

export const analyzeContractTool = defineTool({
  name: "analyzeContract",
  description:
    "Run clause-level contract analysis on a document version. Findings are proposals for attorney review.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: z.object({
    documentId: uuid,
    documentVersionId: uuid,
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "analyzeContract");
    const result = await analyzeContract({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      userId: ctx.userId,
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    // The domain call returns the bare analysis row when it reuses a prior run, and the
    // analysis-with-items shape when it computes a new one.
    const analysisPayload: { id?: string; analysis?: { id: string } } = result.analysis;
    const analysisId = analysisPayload.id ?? analysisPayload.analysis?.id;
    return toolOk({
      summary: result.skipped
        ? "Reused the existing contract analysis for this document version."
        : "Completed contract analysis for this document version.",
      data: result,
      resourceIds: analysisId ? [analysisId] : [],
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

export const analyzeDepositionTool = defineTool({
  name: "analyzeDeposition",
  description:
    "Analyze a deposition transcript version for preparation findings, each tied to transcript sources.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: z.object({
    documentId: uuid,
    documentVersionId: uuid,
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "analyzeDeposition");
    const result = await analyzeDeposition({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      userId: ctx.userId,
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: result.skipped
        ? `Reused existing deposition analysis with ${result.findings.length} finding(s).`
        : `Deposition analysis produced ${result.findings.length} sourced finding(s).`,
      data: result,
      resourceIds: result.findings.map((finding) => finding.id),
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

export const compareDocumentsTool = defineTool({
  name: "compareDocuments",
  description: "Compare two document versions in the matter and return the detected changes.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: z.object({
    documentAId: uuid,
    versionAId: uuid,
    documentBId: uuid,
    versionBId: uuid,
    includeAiSummary: z.boolean().optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "compareDocuments");
    const result = await compareDocuments({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      documentAId: input.documentAId,
      versionAId: input.versionAId,
      documentBId: input.documentBId,
      versionBId: input.versionBId,
      userId: ctx.userId,
      ...(input.includeAiSummary === undefined ? {} : { includeAiSummary: input.includeAiSummary }),
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: `Comparison found ${result.changes.length} change(s) between the two versions.`,
      data: result,
      resourceIds: [result.comparison.id],
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

export const getEvidenceMatrixTool = defineTool({
  name: "getEvidenceMatrix",
  description:
    "Load the evidence matrix mapping verified facts to the documents that support them, plus per-document review state.",
  risk: "low",
  capability: "matters.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: z.object({}).default({}),
  async execute(ctx) {
    const matterId = requireMatterId(ctx, "getEvidenceMatrix");
    const intelligence = await getEvidenceIntelligence({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
    });
    return toolOk({
      summary: `Evidence intelligence covers ${intelligence.documents.length} document(s).`,
      data: intelligence,
      resourceIds: intelligence.documents.map((entry) => entry.document.id),
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

export const getDiscoveryReviewTool = defineTool({
  name: "getDiscoveryReview",
  description:
    "List the discovery review queue for the matter with each document's current classification state.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  inputSchema: z.object({
    pendingOnly: z.boolean().optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "getDiscoveryReview");
    const items = await listDiscoveryQueue({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      ...(input.pendingOnly === undefined ? {} : { pendingOnly: input.pendingOnly }),
    });
    return toolOk({
      summary: `Discovery queue contains ${items.length} document(s)${input.pendingOnly ? " awaiting classification" : ""}.`,
      data: { items },
      resourceIds: items.map((item) => item.document.id),
    });
  },
});

export const detectContradictionsTool = defineTool({
  name: "detectContradictions",
  description:
    "Detect potential contradictions across matter documents. Every candidate requires attorney review.",
  risk: "low",
  capability: "documents.view",
  minAccess: "read",
  requiresMatter: true,
  provenanceClass: "MATTER_EVIDENCE",
  inputSchema: z.object({
    documentId: uuid.optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "detectContradictions");
    const result = await detectContradictionCandidates({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      userId: ctx.userId,
      ...(input.documentId ? { documentId: input.documentId } : {}),
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: `Contradiction detection produced ${result.findings.length} candidate(s) for review.`,
      data: result,
      resourceIds: result.findings.map((finding) => finding.id),
      provenanceClass: "MATTER_EVIDENCE",
    });
  },
});

/**
 * Creates a draft record. Medium risk: a draft is an internal, versioned, revisable work product
 * that is never sent anywhere, so it may be produced as a proposal without a blocking approval.
 */
export const createDraftTool = defineTool({
  name: "createDraft",
  description:
    "Create a matter draft, optionally AI-generated from matter sources. Drafts are internal work product requiring attorney review before any external use.",
  risk: "medium",
  capability: "drafts.create",
  minAccess: "edit",
  requiresMatter: true,
  inputSchema: z.object({
    title: z.string().trim().min(1).max(300),
    draftType: z.string().trim().min(1).max(120),
    instructions: z.string().max(8000).optional(),
    documentIds: z.array(uuid).max(50).optional(),
    generate: z.boolean().optional(),
    content: z.string().max(200000).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "createDraft");
    if (input.generate === false) {
      const created = await createDraft({
        db: ctx.db,
        organizationId: ctx.organizationId,
        matterId,
        userId: ctx.userId,
        title: input.title,
        draftType: input.draftType,
        ...(input.content === undefined ? {} : { content: input.content }),
        aiGenerated: false,
      });
      return toolOk({
        summary: `Created draft "${created.draft.title}" at version ${created.version.versionNumber}.`,
        data: created,
        resourceIds: [created.draft.id],
      });
    }

    const generated = await generateDraft({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      userId: ctx.userId,
      title: input.title,
      draftType: input.draftType,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
      ...(input.documentIds === undefined ? {} : { documentIds: input.documentIds }),
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: `Generated draft "${generated.draft.title}" with ${generated.assertionCounts.FACT_SOURCE} sourced fact assertion(s) and ${generated.assertionCounts.LEGAL_AUTHORITY} authority assertion(s).`,
      data: generated,
      resourceIds: [generated.draft.id],
    });
  },
});

export const reviseDraftTool = defineTool({
  name: "reviseDraft",
  description:
    "Revise an existing draft by AI transformation or by saving supplied content as a new version. Prior versions are preserved.",
  risk: "medium",
  capability: "drafts.create",
  minAccess: "edit",
  requiresMatter: true,
  inputSchema: z
    .object({
      draftId: uuid,
      action: z.enum(["shorten", "expand", "change_tone", "regenerate", "save_content"]),
      sectionHint: z.string().max(2000).optional(),
      content: z.string().max(200000).optional(),
      changeSummary: z.string().max(2000).optional(),
    })
    .refine((value) => value.action !== "save_content" || Boolean(value.content), {
      message: "content is required when action is save_content",
      path: ["content"],
    }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "reviseDraft");
    if (input.action === "save_content") {
      const version = await saveDraftVersion({
        db: ctx.db,
        organizationId: ctx.organizationId,
        matterId,
        draftId: input.draftId,
        userId: ctx.userId,
        content: input.content ?? "",
        ...(input.changeSummary === undefined ? {} : { changeSummary: input.changeSummary }),
      });
      return toolOk({
        summary: `Saved draft version ${version.versionNumber}.`,
        data: { version },
        resourceIds: [input.draftId],
      });
    }

    const version = await transformDraftSection({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      draftId: input.draftId,
      userId: ctx.userId,
      action: input.action,
      ...(input.sectionHint === undefined ? {} : { sectionHint: input.sectionHint }),
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: `Applied "${input.action}" and saved draft version ${version.versionNumber}.`,
      data: { version },
      resourceIds: [input.draftId],
    });
  },
});

/**
 * Builds a task proposal and nothing else.
 *
 * This tool deliberately performs no insert. Creating work assignments on a matter is a decision
 * an attorney makes, so the task is only written when an approval row for it is approved.
 */
export const createTaskProposalTool = defineTool({
  name: "createTaskProposal",
  description:
    "Propose a matter task for attorney approval. Does not create the task; approval is required before anything is written.",
  risk: "high",
  capability: "matters.edit",
  minAccess: "edit",
  requiresMatter: true,
  inputSchema: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(8000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    dueAt: z.string().datetime().optional(),
    assignedToUserId: uuid.optional(),
    rationale: z.string().max(4000).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "createTaskProposal");
    const proposal = {
      actionType: "CREATE_TASK" as const,
      riskLevel: "high" as const,
      rationale: input.rationale ?? "Proposed follow-up work identified during the agent run.",
      proposedData: {
        matterId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        dueAt: input.dueAt ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
      },
    };
    return toolOk({
      summary: `Prepared a task proposal "${input.title}" for approval. No task was created.`,
      data: { proposal, created: false },
      resourceIds: [],
    });
  },
});

/** Writes memory rows with status `proposed`; they stay inert until reviewed. */
export const proposeMemoryTool = defineTool({
  name: "proposeMemory",
  description:
    "Propose matter memory entries. Entries are stored with status proposed and never influence answers until approved.",
  risk: "medium",
  capability: "matters.edit",
  minAccess: "edit",
  requiresMatter: true,
  provenanceClass: "MATTER_MEMORY",
  inputSchema: z.object({
    question: z.string().max(2000).optional(),
    hint: z.string().max(2000).optional(),
    explicit: z
      .object({
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
        importance: z.enum(["low", "normal", "high"]).optional(),
      })
      .optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "proposeMemory");

    if (input.explicit) {
      const memory = await createMatterMemory({
        db: ctx.db,
        organizationId: ctx.organizationId,
        matterId,
        userId: ctx.userId,
        memoryType: input.explicit.memoryType,
        title: input.explicit.title,
        content: input.explicit.content,
        ...(input.explicit.importance ? { importance: input.explicit.importance } : {}),
        origin: "ai",
        status: "proposed",
        sourceType: "agent_proposal",
        embeddings: resolveEmbeddings(ctx),
      });
      return toolOk({
        summary: `Proposed 1 memory entry with status proposed, pending review.`,
        data: { proposals: [memory] },
        resourceIds: [memory.id],
        provenanceClass: "MATTER_MEMORY",
      });
    }

    const matterTitle = await loadMatterTitle(ctx.db, ctx.organizationId, matterId);
    const result = await proposeMatterMemories({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      matterTitle,
      userId: ctx.userId,
      question: input.question ?? null,
      hint: input.hint ?? null,
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary: `Proposed ${result.proposals.length} memory entry(ies) with status proposed, pending review.`,
      data: result,
      resourceIds: result.proposals.map((memory) => memory.id),
      provenanceClass: "MATTER_MEMORY",
    });
  },
});

/** Runs one grounded research question and persists the resulting research artifact. */
export const saveResearchArtifactTool = defineTool({
  name: "saveResearchArtifact",
  description:
    "Run a legal research question against the authority corpus and persist the grounded synthesis as a research artifact.",
  risk: "medium",
  capability: "research.run",
  minAccess: "read",
  requiresMatter: false,
  provenanceClass: "LEGAL_AUTHORITY",
  inputSchema: z.object({
    question: z.string().trim().min(1).max(4000),
    jurisdiction: z.string().max(200).optional(),
    authorityType: z.string().max(80).optional(),
    sessionId: uuid.optional(),
    includeContrary: z.boolean().optional(),
    limit: z.number().int().positive().max(25).optional(),
  }),
  async execute(ctx, input) {
    const filters = {
      ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
      ...(input.authorityType ? { authorityType: input.authorityType } : {}),
    };
    const result = await runResearchQuery({
      db: ctx.db,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      matterId: ctx.matterId ?? null,
      question: input.question,
      filters,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.includeContrary === undefined ? {} : { includeContrary: input.includeContrary }),
      limit: clampLimit(input.limit),
      ...(ctx.ai ? { ai: ctx.ai } : {}),
      embeddings: resolveEmbeddings(ctx),
    });
    return toolOk({
      summary: result.grounded
        ? `Research synthesis grounded in ${result.hits.length} authority passage(s).`
        : `Research produced no grounded answer; ${result.coverageWarnings.length} coverage warning(s) recorded.`,
      data: result,
      resourceIds: [result.artifactId, ...result.hits.map((hit) => hit.authorityId)].filter(
        (value): value is string => Boolean(value),
      ),
      provenanceClass: "LEGAL_AUTHORITY",
    });
  },
});

/**
 * AI classification suggestion only. Privilege determinations remain a human call: the domain
 * layer refuses to set a final privilege value without an explicit human confirmation.
 */
export const proposeDiscoveryClassificationTool = defineTool({
  name: "proposeDiscoveryClassification",
  description:
    "Propose relevance, responsiveness and confidentiality classifications for one discovery document. Privilege is never finalized by AI.",
  risk: "medium",
  capability: "documents.view",
  minAccess: "edit",
  requiresMatter: true,
  inputSchema: z.object({
    documentId: uuid,
    requestSummary: z.string().max(4000).optional(),
  }),
  async execute(ctx, input) {
    const matterId = requireMatterId(ctx, "proposeDiscoveryClassification");
    const result = await proposeDiscoveryClassification({
      db: ctx.db,
      organizationId: ctx.organizationId,
      matterId,
      documentId: input.documentId,
      userId: ctx.userId,
      requestSummary: input.requestSummary ?? null,
      ...(ctx.ai ? { ai: ctx.ai } : {}),
    });
    return toolOk({
      summary:
        "Recorded an AI discovery classification proposal. Privilege remains unset pending human determination.",
      data: result,
      resourceIds: [input.documentId],
    });
  },
});

export const DEFAULT_TOOLS: AgentTool<never, unknown>[] = [
  searchMatterDocumentsTool,
  retrieveMatterChunksTool,
  searchLegalAuthoritiesTool,
  getVerifiedTimelineTool,
  getMatterGraphNeighborhoodTool,
  retrieveMatterMemoryTool,
  analyzeContractTool,
  analyzeDepositionTool,
  compareDocumentsTool,
  getEvidenceMatrixTool,
  getDiscoveryReviewTool,
  detectContradictionsTool,
  createDraftTool,
  reviseDraftTool,
  createTaskProposalTool,
  proposeMemoryTool,
  saveResearchArtifactTool,
  proposeDiscoveryClassificationTool,
];

export function createDefaultToolRegistry(
  extraTools: AgentTool<never, unknown>[] = [],
): ToolRegistry {
  return createToolRegistry([...DEFAULT_TOOLS, ...extraTools]);
}

export * from "./registry";
