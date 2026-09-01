import type { AIProvider } from "@nyayagrid/ai";
import { documentChunks } from "@nyayagrid/database";
import { and, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  analyzeContract,
  createMatterMemory,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForReadyDocuments,
  formatActiveMemoryForPrompt,
  formatVerifiedIntelligenceForPrompt,
  generateDraft,
  getDraftWithVersions,
  listContractAnalyses,
  listGraph,
  listProposedIntelligence,
  listTimelineEvents,
  loadVerifiedGraphContext,
  loadVerifiedMatterIntelligence,
  retrieveActiveMatterMemories,
  reviewMatterFact,
  reviewTimelineEvent,
  saveDraftVersion,
  transformDraftSection,
} from "@nyayagrid/intelligence";
import type { BenchScenario, BenchTask, DraftBenchAction } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { documentIndexFor } from "./adapt-structured";

function findDoc(matter: IngestedMatter, pattern: string) {
  const re = new RegExp(pattern, "i");
  return matter.documents.find((doc) => re.test(doc.filename) || re.test(doc.title));
}

function extractQuotes(content: string): string[] {
  return [...content.matchAll(/[“"]([^”"]{8,400})[”"]/g)].map((match) => match[1] ?? "");
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]{1,12}/g)].map((match) => match[0]!.replace(/,/g, ""));
}

export async function executeDraftTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, ai } = params;
  const action: DraftBenchAction = task.draftAction ?? { kind: "generate", draftType: "memo" };
  const org = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  let modelCalls = 0;

  if (action.extractIntelligence) {
    await extractMatterIntelligenceForReadyDocuments({ ...org, ai });
    modelCalls += 1;
  }
  if (action.approveFacts) {
    const proposed = await listProposedIntelligence({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    for (const fact of proposed.facts) {
      try {
        await reviewMatterFact({ ...org, factId: fact.id, action: "approve" });
      } catch {
        /* unsourced facts cannot be approved */
      }
    }
  }
  if (action.approveTimeline) {
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      status: "proposed",
    });
    for (const event of events) {
      try {
        await reviewTimelineEvent({ ...org, eventId: event.id, action: "approve" });
      } catch {
        /* unsourced events cannot be approved */
      }
    }
  }
  if (action.analyzeContract) {
    const doc = findDoc(matter, "01_Main_Agreement");
    if (doc) {
      const result = await analyzeContract({
        ...org,
        documentId: doc.nyayaDocumentId,
        documentVersionId: doc.nyayaVersionId,
        ai,
        force: true,
      });
      if (!result.skipped) modelCalls += 1;
    }
  }
  if (action.extractGraph) {
    await extractGraphRelationshipCandidates({ ...org, ai });
    modelCalls += 1;
  }
  if (action.createProposedMemory) {
    await createMatterMemory({
      ...org,
      memoryType: "user_instruction",
      title: action.createProposedMemory.title,
      content: action.createProposedMemory.content,
      origin: "manual",
      status: "proposed",
    });
  }
  if (action.createApprovedUserMemory) {
    await createMatterMemory({
      ...org,
      memoryType: "user_instruction",
      title: action.createApprovedUserMemory.title,
      content: action.createApprovedUserMemory.content,
      origin: "manual",
      status: "approved",
    });
  }

  const generated = await generateDraft({
    ...org,
    ai,
    title: `Bench ${task.taskId}`,
    draftType: action.draftType ?? "memo",
    instructions: task.prompt,
    includeLegalAuthority: false,
  });
  modelCalls += 1;

  let latestContent = generated.version.content;
  const v1Numbers = numbersIn(latestContent);
  if (action.saveManualEdit) {
    await saveDraftVersion({
      ...org,
      draftId: generated.draft.id,
      content: action.saveManualEdit,
      changeSummary: "Bench overlay manual edit",
    });
  }
  if (action.transformAction) {
    const transformed = await transformDraftSection({
      ...org,
      draftId: generated.draft.id,
      action: action.transformAction,
      ai,
      includeLegalAuthority: false,
    });
    latestContent = transformed.content;
    modelCalls += 1;
  }

  const withVersions = await getDraftWithVersions({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    draftId: generated.draft.id,
  });
  const current = withVersions?.versions.find(
    (row) => row.versionNumber === withVersions.draft.currentVersionNumber,
  );
  latestContent = current?.content ?? latestContent;
  const assertions = (current?.sourceAssertions ?? generated.version.sourceAssertions ?? []) as Array<{
    text: string;
    chunkIds: string[];
  }>;

  const verified = await loadVerifiedMatterIntelligence(org);
  const verifiedText = formatVerifiedIntelligenceForPrompt(verified);
  const graph = await loadVerifiedGraphContext({
    ...org,
    question: task.prompt,
    limit: 12,
  });
  const listedGraph = await listGraph({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    edgeStatus: "proposed,approved,edited_and_approved",
  });
  const memories = await retrieveActiveMatterMemories({ ...org, limit: 25 });
  const memoryPrompt = formatActiveMemoryForPrompt(memories);
  const proposedEvents = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: "proposed",
  });
  const analyses = await listContractAnalyses({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });

  const chunkIds = [...new Set(assertions.flatMap((row) => row.chunkIds))];
  const chunkRows =
    chunkIds.length === 0
      ? []
      : await db
          .select()
          .from(documentChunks)
          .where(
            and(
              eq(documentChunks.organizationId, matter.organizationId),
              eq(documentChunks.matterId, matter.matterId),
              inArray(documentChunks.id, chunkIds),
            ),
          );
  const chunkById = new Map(chunkRows.map((row) => [row.id, row]));
  const corpusRows = await db
    .select({ content: documentChunks.content })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, matter.organizationId),
        eq(documentChunks.matterId, matter.matterId),
      ),
    )
    .limit(48);
  const allChunkText = [
    ...chunkRows.map((row) => row.content),
    ...corpusRows.map((row) => row.content),
  ].join("\n");
  const quotes = extractQuotes(latestContent);
  const quotesUnsupported = quotes.filter((quote) => !allChunkText.includes(quote.trim())).length;
  const assertionDocs = assertions.map((row) => ({
    text: row.text,
    chunkIds: row.chunkIds,
    documentIds: row.chunkIds
      .map((id) => chunkById.get(id)?.documentId ?? null)
      .filter((id): id is string => Boolean(id)),
  }));
  const foldedBody = latestContent.toLowerCase();
  const assertionBodyAgreement =
    assertions.length === 0
      ? 1
      : assertions.filter((row) =>
          row.text
            .toLowerCase()
            .split(/\s+/)
            .filter((tok) => tok.length >= 5)
            .some((tok) => foldedBody.includes(tok)),
        ).length / assertions.length;

  const knownDocs = new Set(matter.documents.map((doc) => doc.nyayaDocumentId));
  const wrongDocument = assertionDocs.some((row) =>
    row.documentIds.some((id) => knownDocs.size > 0 && !knownDocs.has(id)),
  );

  const structured = {
    taskId: task.taskId,
    engine: "draft",
    draftType: action.draftType ?? "memo",
    draftId: generated.draft.id,
    content: latestContent,
    assumptions: generated.assumptions,
    unresolvedPlaceholders: generated.unresolvedPlaceholders,
    assertions: assertionDocs,
    versions: (withVersions?.versions ?? []).map((row) => ({
      versionNumber: row.versionNumber,
      origin: row.origin,
      assertionCount: Array.isArray(row.sourceAssertions) ? row.sourceAssertions.length : 0,
    })),
    snapshot: {
      proposedTimelineCount: proposedEvents.length,
      approvedTimelineCount: verified.events.length,
      verifiedContextLength: verifiedText.length,
      verifiedHasProposedMarker: /proposed/i.test(verifiedText),
      proposedMemoryTitleInPrompt: Boolean(
        action.createProposedMemory &&
          memoryPrompt.toLowerCase().includes(action.createProposedMemory.title.toLowerCase()),
      ),
      approvedUserMemoryLabeled: /reviewed user-provided information/i.test(memoryPrompt),
      analysisConsumed: false,
      proposedAnalysisRuns: analyses.length,
      proposedGraphEdgeCount: listedGraph.edges.filter((edge) => edge.status === "proposed").length,
      verifiedGraphEdgeCount: graph.edges.length,
      graphContextText: graph.text,
      quotesUnsupported,
      quoteCount: quotes.length,
      assertionBodyAgreement,
      citationsMissingDocumentId: assertionDocs.filter((row) => row.documentIds.length === 0).length,
      wrongDocument,
      priorVersionRetained: (withVersions?.versions.length ?? 0) >= 2,
      versionCount: withVersions?.versions.length ?? 1,
      v1Numbers,
      v2Numbers: numbersIn(latestContent),
      revisionDroppedV1Number: v1Numbers.some(
        (num) => num.length >= 2 && !numbersIn(latestContent).includes(num),
      ),
      autoReviewedProposed: false,
      modelCalls,
    },
  };

  return {
    answer: JSON.stringify(structured, null, 2),
    extras: {
      executionTarget: "draft",
      structuredKind: "draft",
      structuredOutput: structured,
      documentIndex: documentIndexFor(matter),
      promptVersion: generated.draft.promptVersion,
      modelCalls,
    },
  };
}
