import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AIProvider } from "@nyayagrid/ai";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import {
  createMatterMemory,
  extractMatterIntelligenceForReadyDocuments,
  listProposedIntelligence,
  listTimelineEvents,
  reviewMatterFact,
  reviewTimelineEvent,
} from "@nyayagrid/intelligence";
import {
  FORBIDDEN_MATTER_FIELDS,
  generateResearchMemo,
  importAuthority,
  runResearchQuery,
  syntheticAuthorityFixtures,
  type ImportAuthorityInput,
} from "@nyayagrid/research";
import type { BenchScenario, BenchTask, ResearchBenchAction } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { datasetRoot } from "./paths";

type SnapshotHit = {
  authorityId: string;
  chunkId: string;
  citation: string | null;
  title: string;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  score: number;
  snippet: string;
};

let corpusReady = false;

async function ensureResearchCorpus(params: {
  db: Database;
  organizationId: string;
  userId: string;
}) {
  if (corpusReady) return;
  const embeddings = createEmbeddingProviderFromEnv();
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
    const overlay = JSON.parse(readFileSync(overlayPath, "utf8")) as {
      authorities: ImportAuthorityInput[];
    };
    for (const input of overlay.authorities) {
      await importAuthority({
        db: params.db,
        embeddings,
        input,
        actor: { organizationId: params.organizationId, userId: params.userId },
      });
    }
  }
  corpusReady = true;
}

function hitsLeakMatterFields(hits: Array<Record<string, unknown>>): boolean {
  return hits.some((hit) =>
    FORBIDDEN_MATTER_FIELDS.some((field) => hit[field] !== undefined && hit[field] !== null),
  );
}

export async function executeResearchTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, ai } = params;
  const action: ResearchBenchAction = task.researchAction ?? { kind: "query" };
  const org = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  let modelCalls = 0;

  await ensureResearchCorpus({
    db,
    organizationId: matter.organizationId,
    userId: matter.userId,
  });

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

  const filters = {
    ...(action.jurisdiction ? { jurisdiction: action.jurisdiction } : {}),
    ...(action.citation ? { citation: action.citation } : {}),
    ...(action.authorityType ? { authorityType: action.authorityType } : {}),
    ...(action.court ? { court: action.court } : {}),
  };

  const started = Date.now();
  if (action.kind === "memo") {
    const result = await generateResearchMemo({
      ...org,
      ai,
      question: task.prompt,
      filters,
      includeMatterFacts: false,
    });
    modelCalls += 1 + (action.includeMatterContext === false ? 0 : 0);
    const hits: SnapshotHit[] = result.hits.map((hit) => ({
      authorityId: hit.authorityId,
      chunkId: hit.chunkId,
      citation: hit.citation,
      title: hit.title,
      authorityType: hit.authorityType,
      jurisdiction: hit.jurisdiction,
      court: hit.court,
      score: hit.score,
      snippet: hit.snippet,
    }));
    const snapshot = {
      kind: "memo",
      grounded: result.grounded,
      hitCount: hits.length,
      hits,
      citations: hits.map((hit) => hit.citation).filter(Boolean),
      titles: hits.map((hit) => hit.title),
      jurisdictions: hits.map((hit) => hit.jurisdiction),
      authorityTypes: hits.map((hit) => hit.authorityType),
      conciseAnswer: result.memo.shortAnswer,
      analysis: result.memo.analysis,
      coverageWarnings: result.coverageWarnings,
      fabricatedAuthorityIds: result.validation.fabricatedAuthorityIds,
      rejectedQuoteCount: 0,
      droppedPropositionCount: result.validation.droppedPropositions.length,
      usedMatterContext: Boolean(result.matterChunkIds.length),
      matterFieldLeak: hitsLeakMatterFields(result.hits as unknown as Array<Record<string, unknown>>),
      memoText: result.memoText,
      latencyMs: Date.now() - started,
    };
    return {
      answer: result.memoText,
      extras: {
        executionTarget: "research",
        structuredKind: "research",
        structuredOutput: { snapshot, memo: result.memo, hits },
        modelCalls: modelCalls + 1,
        promptVersion: "research-memo-v1",
      },
    };
  }

  const result = await runResearchQuery({
    ...org,
    ai,
    question: task.prompt,
    filters,
    includeMatterContext: action.includeMatterContext,
    includeContrary: action.includeContrary,
  });
  const hits: SnapshotHit[] = result.hits.map((hit) => ({
    authorityId: hit.authorityId,
    chunkId: hit.chunkId,
    citation: hit.citation,
    title: hit.title,
    authorityType: hit.authorityType,
    jurisdiction: hit.jurisdiction,
    court: hit.court,
    score: hit.score,
    snippet: hit.snippet,
  }));
  const snapshot = {
    kind: "query",
    grounded: result.grounded,
    hitCount: hits.length,
    hits,
    citations: hits.map((hit) => hit.citation).filter(Boolean),
    titles: hits.map((hit) => hit.title),
    jurisdictions: hits.map((hit) => hit.jurisdiction),
    authorityTypes: hits.map((hit) => hit.authorityType),
    conciseAnswer: result.synthesis.conciseAnswer,
    propositions: result.synthesis.legalPropositions,
    sources: result.synthesis.sources,
    coverageWarnings: result.coverageWarnings,
    fabricatedAuthorityIds: result.validation.fabricatedAuthorityIds,
    rejectedQuoteCount: result.validation.rejectedQuotes.length,
    droppedPropositionCount: result.validation.droppedPropositions.length,
    usedMatterContext: result.usedMatterContext,
    matterFieldLeak: hitsLeakMatterFields(result.hits as unknown as Array<Record<string, unknown>>),
    latencyMs: Date.now() - started,
  };

  return {
    answer: result.synthesis.conciseAnswer,
    extras: {
      executionTarget: "research",
      structuredKind: "research",
      structuredOutput: { snapshot, synthesis: result.synthesis, hits },
      modelCalls: modelCalls + (result.usedMatterContext ? 2 : 1),
      promptVersion: "research-synthesis-v2",
    },
  };
}
