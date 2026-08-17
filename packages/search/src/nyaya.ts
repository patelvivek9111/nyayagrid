import type { Database } from "@nyayagrid/database";
import { conversations, messages, aiArtifacts } from "@nyayagrid/database";
import {
  assessNeedMoreDocuments,
  buildFollowUpRetrievalQuery,
  buildNyayaSystemPromptWithIntelligence,
  buildNyayaSystemPromptWithResearch,
  buildNyayaUserPrompt,
  buildNyayaUserPromptWithResearch,
  createAIProviderFromEnv,
  formatResearchAuthorityChunks,
  NYAYA_PROMPT_VERSION,
  validateCitedAnswerAgainstPassages,
  applyQa06VerifiedIntelCap,
  citedAnswerTextFromRaw,
  rankByQuestionOverlap,
  type AIProvider,
  type EmbeddingProvider,
  type GroundingPassage,
  type ResearchAuthorityChunk,
} from "@nyayagrid/ai";
import {
  formatVerifiedIntelligenceForPrompt,
  loadVerifiedMatterIntelligence,
  loadVerifiedGraphContext,
  retrieveActiveMatterMemories,
  formatActiveMemoryForPrompt,
  loadProfessionalAnalysisContext,
  formatProfessionalAnalysisForPrompt,
} from "@nyayagrid/intelligence";
import {
  AuthorityHybridRetriever,
  LEGAL_AUTHORITY_CONTEXT_HEADER,
  NO_AUTHORITY_CORPUS_NOTICE,
  formatLegalAuthorityContextForPrompt,
  loadAuthorizedAuthorityChunks,
  loadMatterLegalAuthorityContext,
  looksLikeLegalDoctrineQuestion,
  validateAuthorityMentionsInText,
  type AuthoritySearchFilters,
  type AuthoritySearchHit,
} from "@nyayagrid/research";
import type { Retriever } from "./hybrid";

/** Retrieval surface for the legal authority corpus; matter documents are never searched here. */
export type NyayaAuthorityRetriever = {
  search(
    query: string,
    filters?: AuthoritySearchFilters,
    options?: { limit?: number },
  ): Promise<AuthoritySearchHit[]>;
};

const AUTHORITY_HIT_LIMIT = 6;

type NyayaLegalAuthorityContext = {
  /** Prompt text for the LegalAuthority block, or null when there is nothing to show. */
  text: string | null;
  authorityIds: Set<string>;
  chunkIds: Set<string>;
  sourceTexts: string[];
  savedAuthorityCount: number;
  corpusHitCount: number;
  corpusSearchPerformed: boolean;
  warnings: string[];
};

/**
 * Assemble legal authority context for a matter question.
 *
 * Two sources feed it: authorities the team saved to the matter, and (when a corpus retriever or
 * embedding provider is available) a live search of the authority corpus. Matter document chunks
 * are deliberately absent — they are evidence, not law.
 */
async function loadNyayaLegalAuthorityContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  question: string;
  doctrineQuestion: boolean;
  embeddings?: EmbeddingProvider;
  authorityRetriever?: NyayaAuthorityRetriever;
  authorityFilters?: AuthoritySearchFilters;
  authorityLimit?: number;
}): Promise<NyayaLegalAuthorityContext> {
  const saved = await loadMatterLegalAuthorityContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });

  const authorityIds = new Set(saved.items.map((item) => item.authorityId));
  const chunkIds = new Set(
    saved.items.flatMap((item) => item.passages.map((passage) => passage.chunkId)),
  );
  const sourceTexts = saved.items.flatMap((item) =>
    item.passages.map((passage) => passage.content),
  );
  const warnings = [...saved.warnings];

  const shouldSearchCorpus =
    (params.doctrineQuestion || saved.items.length > 0) &&
    Boolean(params.authorityRetriever ?? params.embeddings);

  let corpusHits: AuthoritySearchHit[] = [];
  let corpusChunks: ResearchAuthorityChunk[] = [];
  if (shouldSearchCorpus) {
    const retriever: NyayaAuthorityRetriever =
      params.authorityRetriever ?? new AuthorityHybridRetriever(params.db, params.embeddings!);
    corpusHits = await retriever.search(params.question, params.authorityFilters ?? {}, {
      limit: params.authorityLimit ?? AUTHORITY_HIT_LIMIT,
    });
    const fullText = await loadAuthorizedAuthorityChunks({
      db: params.db,
      chunkIds: corpusHits.map((hit) => hit.chunkId),
    });
    corpusChunks = corpusHits
      .filter((hit) => !chunkIds.has(hit.chunkId))
      .map((hit) => ({
        authorityId: hit.authorityId,
        chunkId: hit.chunkId,
        citation: hit.citation,
        court: hit.court,
        date: hit.decisionDate,
        content: fullText.get(hit.chunkId)?.content ?? hit.snippet,
      }));
    for (const chunk of corpusChunks) {
      authorityIds.add(chunk.authorityId);
      chunkIds.add(chunk.chunkId);
      sourceTexts.push(chunk.content);
    }
  } else if (params.doctrineQuestion) {
    warnings.push(
      "No legal authority corpus search was performed for this question; only authorities saved to the matter were considered.",
    );
  }

  const savedBlock = formatLegalAuthorityContextForPrompt(saved);
  const corpusBlock = corpusChunks.length
    ? [
        `${LEGAL_AUTHORITY_CONTEXT_HEADER} The passages below came from a corpus search for this question.`,
        formatResearchAuthorityChunks(corpusChunks),
      ].join("\n")
    : "";
  const text = [savedBlock, corpusBlock].filter(Boolean).join("\n\n") || null;

  return {
    text,
    authorityIds,
    chunkIds,
    sourceTexts,
    savedAuthorityCount: saved.items.length,
    corpusHitCount: corpusHits.length,
    corpusSearchPerformed: shouldSearchCorpus,
    warnings,
  };
}

export async function askNyayaAboutMatter(params: {
  db: Database;
  retriever: Retriever;
  organizationId: string;
  matterId: string;
  userId: string;
  question: string;
  conversationId?: string | null;
  ai?: AIProvider;
  includeVerifiedIntelligence?: boolean;
  includeGraph?: boolean;
  includeMemory?: boolean;
  includeProfessionalAnalysis?: boolean;
  /** Include LEGAL_AUTHORITY context from saved matter authorities / corpus search. Default true. */
  includeLegalAuthority?: boolean;
  /** Enables corpus search for doctrine questions when no authorityRetriever is supplied. */
  embeddings?: EmbeddingProvider;
  authorityRetriever?: NyayaAuthorityRetriever;
  authorityFilters?: AuthoritySearchFilters;
  authorityLimit?: number;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const primaryHits = await params.retriever.search({
    text: params.question,
    scope: {
      organizationId: params.organizationId,
      matterId: params.matterId,
      workspace: "professional",
    },
    limit: 8,
  });

  // Multi-hop: if retrieval is thin or the question names a doc type, expand once and merge.
  let usedFollowUpRetrieval = false;
  let hits = primaryHits;
  const followUpQuery = buildFollowUpRetrievalQuery(params.question);
  if (followUpQuery && (primaryHits.length < 3 || followUpQuery !== params.question.trim())) {
    const secondaryHits = await params.retriever.search({
      text: followUpQuery,
      scope: {
        organizationId: params.organizationId,
        matterId: params.matterId,
        workspace: "professional",
      },
      limit: 8,
    });
    if (secondaryHits.length > 0) {
      usedFollowUpRetrieval = true;
      const seen = new Set(primaryHits.map((h) => h.chunkId));
      hits = [...primaryHits];
      for (const hit of secondaryHits) {
        if (seen.has(hit.chunkId)) continue;
        seen.add(hit.chunkId);
        hits.push(hit);
        if (hits.length >= 12) break;
      }
    }
  }

  const rankedHits = rankByQuestionOverlap(params.question, hits);
  const passages: GroundingPassage[] = rankedHits.map((hit) => ({
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    documentVersionId: hit.documentVersionId,
    page: hit.page,
    segmentRef: hit.segmentRef,
    quote: hit.quote,
  }));

  let verifiedText: string | null = null;
  let graphText: string | null = null;
  let memoryText: string | null = null;
  let analysisText: string | null = null;

  if (params.includeVerifiedIntelligence !== false) {
    const verified = await loadVerifiedMatterIntelligence({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
    });
    verifiedText = formatVerifiedIntelligenceForPrompt(verified) || null;
  }

  if (params.includeGraph !== false) {
    const graph = await loadVerifiedGraphContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      question: params.question,
      limit: 10,
    });
    graphText = graph.text || null;
  }

  if (params.includeMemory !== false) {
    const memories = await retrieveActiveMatterMemories({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      question: params.question,
      limit: 6,
    });
    memoryText = formatActiveMemoryForPrompt(memories) || null;
  }

  if (params.includeProfessionalAnalysis !== false) {
    const analysis = await loadProfessionalAnalysisContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      question: params.question,
      limit: 12,
    });
    analysisText = formatProfessionalAnalysisForPrompt(analysis) || null;
  }

  const doctrineQuestion = looksLikeLegalDoctrineQuestion(params.question);
  const authority =
    params.includeLegalAuthority === false
      ? null
      : await loadNyayaLegalAuthorityContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          question: params.question,
          doctrineQuestion,
          embeddings: params.embeddings,
          authorityRetriever: params.authorityRetriever,
          authorityFilters: params.authorityFilters,
          authorityLimit: params.authorityLimit,
        });
  const authorityText = authority?.text ?? null;
  const useResearchPrompt = Boolean(authorityText) || doctrineQuestion;

  let conversationId = params.conversationId ?? null;
  if (!conversationId) {
    const [created] = await params.db
      .insert(conversations)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        createdByUserId: params.userId,
        title: params.question.slice(0, 120),
      })
      .returning();
    conversationId = created!.id;
  } else {
    const existing = await params.db.query.conversations.findFirst({
      where: (table, ops) =>
        ops.and(
          ops.eq(table.id, conversationId!),
          ops.eq(table.organizationId, params.organizationId),
          ops.eq(table.matterId, params.matterId),
        ),
    });
    if (!existing) throw new Error("Conversation not found in matter scope");
  }

  await params.db.insert(messages).values({
    organizationId: params.organizationId,
    matterId: params.matterId,
    conversationId,
    role: "user",
    content: params.question,
    createdByUserId: params.userId,
  });

  const generation = await ai.generate({
    temperature: 0,
    messages: [
      {
        role: "system",
        content: useResearchPrompt
          ? buildNyayaSystemPromptWithResearch()
          : buildNyayaSystemPromptWithIntelligence(),
      },
      {
        role: "user",
        content: useResearchPrompt
          ? buildNyayaUserPromptWithResearch(
              params.question,
              passages,
              authorityText ?? "",
              verifiedText,
              graphText,
              memoryText,
              analysisText,
            )
          : buildNyayaUserPrompt(
              params.question,
              passages,
              verifiedText,
              graphText,
              memoryText,
              analysisText,
            ),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = {
      answer:
        "The available matter documents do not provide sufficient evidence to answer this question.",
      sources: [],
      assumptions: [],
      unresolvedQuestions: ["Model returned non-JSON output"],
      evidenceState: "insufficient",
    };
  }

  const validated = validateCitedAnswerAgainstPassages(raw, passages);
  const rawAnswer = citedAnswerTextFromRaw(raw);
  validated.answer = applyQa06VerifiedIntelCap({
    answer: validated.answer,
    rawAnswer,
    retrievedCount: passages.length,
    verifiedIntelligence: verifiedText,
    verifiedGraph: graphText,
    verifiedMemory: memoryText,
    professionalAnalysis: analysisText,
  });

  if (
    validated.answer.evidenceState !== "grounded" &&
    passages.length === 0 &&
    !validated.answer.unresolvedQuestions.some((q) => /document|upload|source/i.test(q))
  ) {
    validated.answer.unresolvedQuestions = [
      ...validated.answer.unresolvedQuestions,
      "Which Case document should be uploaded or selected to answer this?",
    ];
  }

  const needMore = assessNeedMoreDocuments({
    evidenceState: validated.answer.evidenceState,
    retrievedCount: passages.length,
    unresolvedQuestions: validated.answer.unresolvedQuestions,
    question: params.question,
  });
  if (needMore.needsMoreDocuments) {
    for (const reason of needMore.reasons) {
      if (!validated.answer.assumptions.includes(reason)) {
        validated.answer.assumptions.push(reason);
      }
    }
  }

  // Authority references in prose cannot be schema-validated, so check what can be checked: every
  // corpus identifier must have been supplied as context, and every quoted span must be verbatim.
  const authorityValidation = authority
    ? validateAuthorityMentionsInText(validated.answer.answer, {
        authorityIds: authority.authorityIds,
        chunkIds: authority.chunkIds,
        sourceTexts: [...authority.sourceTexts, ...passages.map((passage) => passage.quote)],
      })
    : null;

  if (authorityValidation && authorityValidation.unknownIdentifiers.length > 0) {
    validated.answer.assumptions.push(
      `The answer referenced ${authorityValidation.unknownIdentifiers.length} authority identifier(s) that were not part of the provided legal authority context; treat them as unverified.`,
    );
  }
  if (authorityValidation && authorityValidation.unverifiedQuotes.length > 0) {
    validated.answer.assumptions.push(
      `${authorityValidation.unverifiedQuotes.length} quoted passage(s) could not be matched verbatim to a provided source and must be verified before use.`,
    );
  }

  const authorityMissingForDoctrine = doctrineQuestion && !authorityText;
  if (authorityMissingForDoctrine) {
    validated.answer.answer = `${validated.answer.answer.trim()}\n\n${NO_AUTHORITY_CORPUS_NOTICE}`;
    validated.answer.assumptions.push(NO_AUTHORITY_CORPUS_NOTICE);
    validated.answer.unresolvedQuestions.push(
      "Legal authority research for this question has not been performed against the corpus.",
    );
  } else if (doctrineQuestion && authority) {
    validated.answer.assumptions.push(
      "Legal statements are limited to the provided LEGAL_AUTHORITY passages; matter documents were used for facts only.",
    );
    validated.answer.assumptions.push(...authority.warnings);
  }

  const [assistantMessage] = await params.db
    .insert(messages)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      conversationId,
      role: "assistant",
      content: validated.answer.answer,
      createdByUserId: params.userId,
    })
    .returning();

  const [artifact] = await params.db
    .insert(aiArtifacts)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      conversationId,
      messageId: assistantMessage!.id,
      artifactType: "matter_qa",
      question: params.question,
      answer: validated.answer.answer,
      evidenceState: validated.answer.evidenceState,
      provider: generation.provider,
      model: generation.model,
      promptVersion: NYAYA_PROMPT_VERSION,
      retrievedChunkIds: passages.map((p) => p.chunkId),
      citations: validated.answer.sources.map((s) => ({
        chunkId: s.chunkId ?? "",
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        page: s.page,
        segmentRef: s.paragraph,
        quote: s.quote,
      })),
      validation: {
        rejectedCitations: validated.rejectedCitations,
        retrievedCount: passages.length,
        usedVerifiedIntelligence: Boolean(verifiedText),
        usedGraph: Boolean(graphText),
        usedMemory: Boolean(memoryText),
        usedProfessionalAnalysis: Boolean(analysisText),
        usedLegalAuthority: Boolean(authorityText),
        doctrineQuestion,
        savedAuthorityCount: authority?.savedAuthorityCount ?? 0,
        authorityCorpusHitCount: authority?.corpusHitCount ?? 0,
        authorityCorpusSearchPerformed: authority?.corpusSearchPerformed ?? false,
        authorityResearchMissing: authorityMissingForDoctrine,
        unknownAuthorityIdentifierCount: authorityValidation?.unknownIdentifiers.length ?? 0,
        unverifiedQuoteCount: authorityValidation?.unverifiedQuotes.length ?? 0,
        assumptions: validated.answer.assumptions,
        unresolvedQuestions: validated.answer.unresolvedQuestions,
        needsMoreDocuments: needMore.needsMoreDocuments,
        needMoreDocumentReasons: needMore.reasons,
        usedFollowUpRetrieval,
      },
      createdByUserId: params.userId,
    })
    .returning();

  return {
    conversationId,
    artifact,
    answer: validated.answer,
    retrieved: passages,
    needsMoreDocuments: needMore.needsMoreDocuments,
    needMoreDocumentReasons: needMore.reasons,
    usedFollowUpRetrieval,
    usedVerifiedIntelligence: Boolean(verifiedText),
    usedGraph: Boolean(graphText),
    usedMemory: Boolean(memoryText),
    usedProfessionalAnalysis: Boolean(analysisText),
    usedLegalAuthority: Boolean(authorityText),
    doctrineQuestion,
    authorityResearchMissing: authorityMissingForDoctrine,
    authorityWarnings: authority?.warnings ?? [],
    authorityValidation,
  };
}

export async function getChunkCitation(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  chunkId: string;
}) {
  const chunk = await params.db.query.documentChunks.findFirst({
    where: (table, ops) =>
      ops.and(
        ops.eq(table.id, params.chunkId),
        ops.eq(table.organizationId, params.organizationId),
        ops.eq(table.matterId, params.matterId),
      ),
  });
  return chunk ?? null;
}

export async function listMatterArtifacts(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  limit?: number;
}) {
  const rows = await params.db.query.aiArtifacts.findMany({
    where: (table, ops) =>
      ops.and(
        ops.eq(table.organizationId, params.organizationId),
        ops.eq(table.matterId, params.matterId),
      ),
    orderBy: (table, ops) => [ops.desc(table.createdAt)],
    limit: params.limit ?? 20,
  });
  return rows;
}
