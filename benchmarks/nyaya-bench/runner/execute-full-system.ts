import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AIProvider } from "@nyayagrid/ai";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { ensureUserFromIdentity } from "@nyayagrid/auth";
import {
  NyayaOrchestrator,
  PROHIBITED_TOOL_NAMES,
} from "@nyayagrid/agents";
import {
  drafts,
  documents,
  matterMembers,
  memberships,
  roles,
  type Database,
  and,
  eq,
} from "@nyayagrid/database";
import {
  analyzeContract,
  analyzeDeposition,
  compareDocuments,
  createMatterMemory,
  detectContradictionCandidates,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForReadyDocuments,
  formatActiveMemoryForPrompt,
  formatProfessionalAnalysisForPrompt,
  formatVerifiedGraphForPrompt,
  formatVerifiedIntelligenceForPrompt,
  generateDraft,
  getContractAnalysis,
  getEvidenceIntelligence,
  listContractAnalyses,
  listFindings,
  listGraph,
  listMatterMemories,
  listProposedIntelligence,
  listTimelineEvents,
  loadProfessionalAnalysisContext,
  loadVerifiedGraphContext,
  loadVerifiedMatterIntelligence,
  retrieveActiveMatterMemories,
  reviewAnalysisItem,
  reviewGraphEdge,
  reviewMatterFact,
  reviewMatterMemory,
  reviewTimelineEvent,
  supersedeMatterMemory,
  upsertGraphNode,
  createManualGraphEdge,
} from "@nyayagrid/intelligence";
import { AuthorizationError, requireMatterAccess } from "@nyayagrid/permissions";
import {
  generateResearchMemo,
  importAuthority,
  runResearchQuery,
  syntheticAuthorityFixtures,
  type ImportAuthorityInput,
} from "@nyayagrid/research";
import { PostgresHybridRetriever, askNyayaAboutMatter } from "@nyayagrid/search";
import type { BenchScenario, BenchTask, FullSystemBenchAction } from "./catalog";
import { loadOverlayV2Scenario } from "./catalog";
import { ingestFilesIntoMatter, ingestScenario, type IngestedMatter } from "./ingest";
import { datasetRoot } from "./paths";
import { executeAgentTarget } from "./execute-agents";

const ALL_STATUSES = ["proposed", "approved", "edited_and_approved", "rejected"] as const;

function failingAi(): AIProvider {
  return {
    name: "bench-failing-ai",
    async generate() {
      throw new Error("OpenAI failure (injected for FS030)");
    },
  };
}

function extraDocument(scenario: BenchScenario, filename: string) {
  const absolutePath = join(scenario.scenarioDir, "documents", filename);
  return {
    documentId: filename.replace(/\.[a-z0-9]+$/i, ""),
    filename,
    title: filename.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "),
    absolutePath,
  };
}

async function seedMemory(
  db: Database,
  matter: IngestedMatter,
  input: { title: string; content: string },
  status: "proposed" | "approved" | "rejected",
) {
  const created = await createMatterMemory({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    memoryType: "factual_caveat",
    title: input.title,
    content: input.content,
    origin: status === "approved" ? "manual" : "ai",
    status: status === "rejected" ? "proposed" : status,
    sourceType: status === "approved" ? "user_entry" : "agent_proposal",
  });
  if (status === "rejected") {
    await reviewMatterMemory({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: matter.userId,
      memoryId: created.id,
      action: "reject",
      rejectionReason: "Full-system overlay rejection.",
    });
  }
  return created;
}

async function applyReview(
  db: Database,
  matter: IngestedMatter,
  review: NonNullable<FullSystemBenchAction["review"]>,
) {
  const org = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  if (review.timeline && review.timeline !== "leave_proposed") {
    const events = await listTimelineEvents({
      ...org,
      status: ["proposed"],
    });
    const selected =
      review.timeline === "approve_first" || review.timeline === "reject_all"
        ? review.timeline === "approve_first"
          ? events.slice(0, 1)
          : events
        : events;
    for (const event of selected) {
      try {
        await reviewTimelineEvent({
          ...org,
          eventId: event.id,
          action: review.timeline === "reject_all" ? "reject" : "approve",
          rejectionReason: review.timeline === "reject_all" ? "FS overlay reject" : undefined,
        });
      } catch {
        /* unsourced rows cannot be approved */
      }
    }
  }
  if (review.facts && review.facts !== "leave_proposed") {
    const proposed = await listProposedIntelligence(org);
    const facts =
      review.facts === "approve_first" ? proposed.facts.slice(0, 1) : proposed.facts;
    for (const fact of facts) {
      try {
        await reviewMatterFact({
          ...org,
          factId: fact.id,
          action: review.facts === "reject_all" ? "reject" : "approve",
          rejectionReason: review.facts === "reject_all" ? "FS overlay reject" : undefined,
        });
      } catch {
        /* unsourced */
      }
    }
  }
  if (review.graph && review.graph !== "leave_proposed") {
    const listed = await listGraph({
      ...org,
      edgeStatus: "proposed,approved,edited_and_approved,rejected",
    });
    const proposed = listed.edges.filter((edge) => edge.status === "proposed");
    const selected = review.graph === "approve_first" ? proposed.slice(0, 1) : proposed;
    for (const edge of selected) {
      try {
        await reviewGraphEdge({
          ...org,
          edgeId: edge.id,
          action: review.graph === "reject_all" ? "reject" : "approve",
          rejectionReason: review.graph === "reject_all" ? "FS overlay reject" : undefined,
        });
      } catch {
        /* unsourced AI edges */
      }
    }
  }
  if (review.analysis === "review_first") {
    const analyses = await listContractAnalyses({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    const first = analyses[0];
    if (first) {
      const detailed = await getContractAnalysis({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        analysisId: first.id,
      });
      const item = detailed?.items.find((row) => row.status === "proposed");
      if (item) {
        try {
          await reviewAnalysisItem({ ...org, itemId: item.id, action: "reviewed" });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function approveInferentialAttended(db: Database, matter: IngestedMatter) {
  const person = await upsertGraphNode(db, {
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    canonicalEntityType: "person",
    canonicalEntityId: `bench-calderon-${matter.matterId.slice(0, 8)}`,
    nodeType: "person",
    displayName: "Priya Calderon",
    origin: "manual",
  });
  const place = await upsertGraphNode(db, {
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    canonicalEntityType: "other",
    canonicalEntityId: `bench-vault-${matter.matterId.slice(0, 8)}`,
    nodeType: "other",
    displayName: "Harborwell Archive Vault",
    origin: "manual",
  });
  const edge = await createManualGraphEdge({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    fromNodeId: person.id,
    toNodeId: place.id,
    relationshipType: "attended",
    label: "inferential: badge assigned / ACCESS GRANTED (not independent proof of physical entry)",
  });
  await reviewGraphEdge({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    edgeId: edge.id,
    action: "approve",
  });
  return edge.id;
}

async function snapshotTrust(db: Database, matter: IngestedMatter, question: string) {
  const verified = await loadVerifiedMatterIntelligence({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  const verifiedText = formatVerifiedIntelligenceForPrompt(verified);
  const memories = await listMatterMemories({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: [...ALL_STATUSES, "archived", "superseded"],
  });
  const active = await retrieveActiveMatterMemories({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    limit: 25,
  });
  const memoryText = formatActiveMemoryForPrompt(active);
  const timeline = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: [...ALL_STATUSES],
  });
  const graph = await listGraph({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  const verifiedGraph = await loadVerifiedGraphContext({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    question,
    limit: 12,
  });
  const analysisCtx = await loadProfessionalAnalysisContext({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  const analysisText = formatProfessionalAnalysisForPrompt(analysisCtx);
  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      processingState: documents.processingState,
      malwareScanStatus: documents.malwareScanStatus,
    })
    .from(documents)
    .where(
      and(eq(documents.organizationId, matter.organizationId), eq(documents.matterId, matter.matterId)),
    );
  const draftRows = await db
    .select({ id: drafts.id, title: drafts.title, status: drafts.status })
    .from(drafts)
    .where(and(eq(drafts.organizationId, matter.organizationId), eq(drafts.matterId, matter.matterId)));

  return {
    verifiedText,
    memoryText,
    analysisText,
    graphText: verifiedGraph.text || formatVerifiedGraphForPrompt({ edges: [] }),
    verifiedGraphText: verifiedGraph.text,
    timeline: timeline.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      description: row.description,
    })),
    memories: memories.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      content: row.content,
    })),
    graphEdges: graph.edges.map((edge) => ({
      id: edge.id,
      status: edge.status,
      relationshipType: edge.relationshipType,
      label: edge.label,
    })),
    documents: docs,
    drafts: draftRows,
    activeMemoryIds: active.map((row) => row.id),
    proposedMemoryContents: memories.filter((row) => row.status === "proposed").map((row) => row.content),
    rejectedMemoryContents: memories.filter((row) => row.status === "rejected").map((row) => row.content),
    supersededMemoryContents: memories
      .filter((row) => row.status === "superseded")
      .map((row) => row.content),
  };
}

async function runAsk(params: {
  db: Database;
  matter: IngestedMatter;
  question: string;
  ai: AIProvider;
}) {
  const embeddings = createEmbeddingProviderFromEnv();
  const retriever = new PostgresHybridRetriever(params.db, embeddings);
  const result = await askNyayaAboutMatter({
    db: params.db,
    retriever,
    organizationId: params.matter.organizationId,
    matterId: params.matter.matterId,
    userId: params.matter.userId,
    question: params.question,
    ai: params.ai,
    embeddings,
    includeLegalAuthority: false,
  });
  return result.answer.answer;
}

async function ensureStaffViewer(db: Database, matter: IngestedMatter) {
  const user = await ensureUserFromIdentity(db, {
    subject: `nyaya_bench_staff_${matter.matterId.slice(0, 8)}`,
    email: `staff-${matter.matterId.slice(0, 8)}@example.nyayagrid.local`,
    name: "Nyaya Bench Staff Viewer",
  });
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, matter.organizationId), eq(roles.key, "staff")))
    .limit(1);
  if (!role) throw new Error("staff role missing");
  const existing = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, matter.organizationId), eq(memberships.userId, user.id)),
  });
  if (!existing) {
    await db.insert(memberships).values({
      organizationId: matter.organizationId,
      userId: user.id,
      roleId: role.id,
      status: "active",
    });
  }
  try {
    await db.insert(matterMembers).values({
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      userId: user.id,
      access: "read",
    });
  } catch {
    /* already a member */
  }
  return user.id;
}

async function runPermissions(db: Database, matter: IngestedMatter) {
  const viewOnlyUserId = await ensureStaffViewer(db, matter);
  const attempts: Record<string, { denied: boolean; error?: string }> = {};
  const checks: Array<{ key: string; minAccess: "edit"; capability: "timeline.manage" | "matters.edit" | "drafts.create" }> =
    [
      { key: "approveTimeline", minAccess: "edit", capability: "timeline.manage" },
      { key: "approveGraph", minAccess: "edit", capability: "timeline.manage" },
      { key: "approveMemory", minAccess: "edit", capability: "timeline.manage" },
      { key: "reviewAnalysis", minAccess: "edit", capability: "matters.edit" },
      { key: "createDraft", minAccess: "edit", capability: "drafts.create" },
      { key: "executeAgent", minAccess: "edit", capability: "matters.edit" },
    ];
  for (const check of checks) {
    try {
      await requireMatterAccess(db, {
        userId: viewOnlyUserId,
        matterId: matter.matterId,
        minAccess: check.minAccess,
        capability: check.capability,
      });
      attempts[check.key] = { denied: false };
    } catch (error) {
      const denied = error instanceof AuthorizationError || (error instanceof Error && /Missing capability|Matter access|Forbidden/i.test(error.message));
      attempts[check.key] = {
        denied,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const draftsBefore = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.organizationId, matter.organizationId), eq(drafts.matterId, matter.matterId)));
  let orchestratorMutated = false;
  try {
    const orchestrator = new NyayaOrchestrator();
    await orchestrator.runTask({
      db,
      userId: viewOnlyUserId,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      goal: "Prepare a draft memorandum and approve timeline events.",
      mode: "task",
      execute: true,
      rulesOnlyIntent: true,
    });
  } catch (error) {
    attempts.orchestrator = {
      denied: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const draftsAfter = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.organizationId, matter.organizationId), eq(drafts.matterId, matter.matterId)));
  orchestratorMutated = draftsAfter.length > draftsBefore.length;
  const httpDenied = Object.entries(attempts)
    .filter(([key]) => key !== "orchestrator")
    .every(([, value]) => value.denied);
  return { viewOnlyUserId, attempts, httpDenied, orchestratorMutated };
}

let researchCorpusReady = false;

async function importResearch(params: { db: Database; organizationId: string; userId: string; injection?: boolean }) {
  const embeddings = createEmbeddingProviderFromEnv();
  if (!researchCorpusReady) {
    for (const input of syntheticAuthorityFixtures) {
      await importAuthority({
        db: params.db,
        embeddings,
        input,
        actor: { organizationId: params.organizationId, userId: params.userId },
      });
    }
    const overlayPath = join(datasetRoot("v2"), "research", "corpus.json");
    if (existsSync(overlayPath)) {
      const overlay = JSON.parse(readFileSync(overlayPath, "utf8")) as { authorities: ImportAuthorityInput[] };
      for (const input of overlay.authorities) {
        await importAuthority({
          db: params.db,
          embeddings,
          input,
          actor: { organizationId: params.organizationId, userId: params.userId },
        });
      }
    }
    researchCorpusReady = true;
  }
  if (params.injection) {
    const injPath = join(datasetRoot("v2"), "full-system", "corpus.json");
    const overlay = JSON.parse(readFileSync(injPath, "utf8")) as { authorities: ImportAuthorityInput[] };
    for (const input of overlay.authorities) {
      await importAuthority({
        db: params.db,
        embeddings,
        input,
        actor: { organizationId: params.organizationId, userId: params.userId },
      });
    }
  }
}

export async function executeFullSystemTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const action: FullSystemBenchAction = params.task.fsAction ?? { downstream: ["ask"] };
  const runSuffix = `${params.task.taskId}-${randomUUID().slice(0, 8)}`;
  let matter = params.matter;
  if (action.freshMatter !== false) {
    matter = await ingestScenario({
      db: params.db,
      scenario: params.scenario,
      runId: runSuffix,
      extractIntelligence: false,
      excludeFilenames: action.excludeFromInitial,
    });
  }

  const errors: string[] = [];
  const org = {
    db: params.db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };

  if (action.unprocessedExtraDocument) {
    const extra = extraDocument(params.scenario, action.unprocessedExtraDocument);
    const added = await ingestFilesIntoMatter({
      db: params.db,
      matter,
      scenario: { ...params.scenario, documents: [...params.scenario.documents, extra] },
      filenames: [action.unprocessedExtraDocument],
      skipPipeline: true,
    });
    matter = { ...matter, documents: [...matter.documents, ...added] };
  }

  if (action.seedProposedMemory) {
    await seedMemory(params.db, matter, action.seedProposedMemory, "proposed");
  }
  if (action.seedApprovedMemory) {
    await seedMemory(params.db, matter, action.seedApprovedMemory, "approved");
  }
  if (action.seedRejectedMemory) {
    await seedMemory(params.db, matter, action.seedRejectedMemory, "rejected");
  }
  if (action.supersedeMemory) {
    const old = await createMatterMemory({
      ...org,
      memoryType: "verified_context",
      title: action.supersedeMemory.oldTitle,
      content: action.supersedeMemory.oldContent,
      origin: "manual",
      status: "approved",
    });
    await supersedeMatterMemory({
      ...org,
      oldMemoryId: old.id,
      title: action.supersedeMemory.newTitle,
      content: action.supersedeMemory.newContent,
      memoryType: "verified_context",
    });
  }

  const extractAi = action.injectAiFailureOn === "analysis" ? failingAi() : params.ai;

  try {
    if (action.extractIntelligence) {
      await extractMatterIntelligenceForReadyDocuments({ ...org, ai: params.ai });
      if (action.repeatExtract) {
        await extractMatterIntelligenceForReadyDocuments({ ...org, ai: params.ai });
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    if (action.extractGraph) {
      await extractGraphRelationshipCandidates({ ...org, ai: params.ai });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (action.review) {
    await applyReview(params.db, matter, action.review);
  }
  if (action.approveInferentialAttended) {
    try {
      await approveInferentialAttended(params.db, matter);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (action.lateDocuments?.length) {
    const extras = action.lateDocuments.map((filename) => extraDocument(params.scenario, filename));
    const added = await ingestFilesIntoMatter({
      db: params.db,
      matter,
      scenario: { ...params.scenario, documents: [...params.scenario.documents, ...extras] },
      filenames: action.lateDocuments,
    });
    matter = { ...matter, documents: [...matter.documents, ...added] };
  }

  let compareOut: unknown = null;
  let contradictionOut: unknown = null;
  let analysisOut: unknown = null;
  let researchOut: unknown = null;
  let draftOut: { id?: string; content?: string; assertions?: unknown } | null = null;
  let agentOut: { answer: string; extras: Record<string, unknown> } | null = null;
  let askAnswer = "";
  let permissions: unknown = null;
  let siblingMatterId: string | null = null;
  let foreignOrgId: string | null = null;

  const agreement =
    matter.documents.find((doc) => /01_|services_agreement/i.test(doc.filename)) ?? matter.documents[0];
  const amendment =
    matter.documents.find((doc) => /02_|amendment|notice_amendment/i.test(doc.filename)) ??
    matter.documents[1];

  try {
    if (action.compareDocuments && agreement && amendment) {
      compareOut = await compareDocuments({
        ...org,
        ai: params.ai,
        documentAId: agreement.nyayaDocumentId,
        versionAId: agreement.nyayaVersionId,
        documentBId: amendment.nyayaDocumentId,
        versionBId: amendment.nyayaVersionId,
        includeAiSummary: true,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (action.analyzeContract && agreement) {
      analysisOut = await analyzeContract({
        ...org,
        ai: extractAi,
        documentId: agreement.nyayaDocumentId,
        documentVersionId: agreement.nyayaVersionId,
        force: true,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (action.analyzeDeposition) {
      const interview = matter.documents.find((doc) => /interview|deposition|05_/i.test(doc.filename));
      if (interview) {
        analysisOut = await analyzeDeposition({
          ...org,
          ai: params.ai,
          documentId: interview.nyayaDocumentId,
          documentVersionId: interview.nyayaVersionId,
          force: true,
        });
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (action.detectContradictions) {
      contradictionOut = await detectContradictionCandidates({ ...org, ai: params.ai, force: true });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (action.evidenceMatrix) {
      await getEvidenceIntelligence({
        db: params.db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (action.importResearchCorpus || action.importInjectionAuthority) {
    await importResearch({
      db: params.db,
      organizationId: matter.organizationId,
      userId: matter.userId,
      injection: action.importInjectionAuthority,
    });
  }

  try {
    if (action.researchQuery) {
      researchOut = await runResearchQuery({
        db: params.db,
        organizationId: matter.organizationId,
        userId: matter.userId,
        matterId: matter.matterId,
        question: params.task.prompt,
        ai: params.ai,
      });
    }
    if (action.researchMemo) {
      await generateResearchMemo({
        db: params.db,
        organizationId: matter.organizationId,
        userId: matter.userId,
        matterId: matter.matterId,
        question: params.task.prompt,
        ai: params.ai,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (action.siblingScenario) {
    const sibling = loadOverlayV2Scenario(params.scenario.dataset, action.siblingScenario);
    const ingested = await ingestScenario({
      db: params.db,
      scenario: sibling,
      runId: `${runSuffix}-sib`,
      extractIntelligence: false,
    });
    siblingMatterId = ingested.matterId;
  }
  if (action.foreignOrgScenario) {
    const foreign = loadOverlayV2Scenario(params.scenario.dataset, action.foreignOrgScenario);
    const ingested = await ingestScenario({
      db: params.db,
      scenario: foreign,
      runId: `${runSuffix}-orgb`,
      extractIntelligence: false,
      organizationSlug: `nyaya-bench-b-${runSuffix.slice(0, 12).toLowerCase()}`,
      organizationName: "SYNTH Nyaya Bench Org B",
    });
    foreignOrgId = ingested.organizationId;
  }

  const downstream = action.downstream ?? ["ask"];

  if (downstream.includes("permissions") || action.actor === "view_only") {
    permissions = await runPermissions(params.db, matter);
  }

  if (downstream.includes("ask")) {
    try {
      askAnswer = await runAsk({ db: params.db, matter, question: params.task.prompt, ai: params.ai });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (downstream.includes("draft")) {
    try {
      const generated = await generateDraft({
        ...org,
        ai: params.ai,
        title: `FS draft ${params.task.taskId}`,
        draftType: "memo",
        instructions: params.task.prompt,
        includeLegalAuthority: Boolean(action.researchQuery),
      });
      draftOut = {
        id: generated.draft.id,
        content: generated.version.content,
        assertions: generated.version.sourceAssertions,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (downstream.includes("agent")) {
    try {
      agentOut = await executeAgentTarget({
        db: params.db,
        scenario: params.scenario,
        task: {
          ...params.task,
          agentAction: { kind: "execute", importResearchCorpus: action.importResearchCorpus },
        },
        matter,
        ai: params.ai,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const trust = await snapshotTrust(params.db, matter, params.task.prompt);
  const findings = action.detectContradictions
    ? await listFindings({
        db: params.db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        runType: "contradiction",
      })
    : [];

  const answerParts = [
    askAnswer,
    draftOut?.content ?? "",
    agentOut?.answer ?? "",
    trust.verifiedText,
    trust.memoryText,
    trust.analysisText,
    trust.verifiedGraphText,
    ...errors,
  ];

  return {
    answer: answerParts.filter(Boolean).join("\n"),
    extras: {
      executionTarget: "full_system",
      structuredKind: "full_system",
      snapshot: {
        askAnswer,
        draft: draftOut,
        agent: agentOut?.extras?.snapshot ?? agentOut?.extras ?? null,
        agentAnswer: agentOut?.answer ?? null,
        compare: compareOut ? { present: true } : null,
        research: researchOut,
        contradictionFindingCount: findings.length,
        analysisError: action.injectAiFailureOn === "analysis" ? errors.find((row) => /OpenAI failure/i.test(row)) ?? errors[0] ?? null : null,
        permissions,
        siblingMatterId,
        foreignOrgId,
        matterId: matter.matterId,
        organizationId: matter.organizationId,
        errors,
        trust,
        prohibitedToolNames: [...PROHIBITED_TOOL_NAMES],
      },
    },
  };
}
