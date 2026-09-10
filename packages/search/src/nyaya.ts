import type { Database } from "@nyayagrid/database";
import { conversations, messages, aiArtifacts, documents, documentVersions, and, eq, or, sql } from "@nyayagrid/database";
import {
  assessNeedMoreDocuments,
  assessRetrievedEvidence,
  buildFollowUpRetrievalQuery,
  buildNyayaSystemPromptWithIntelligence,
  buildNyayaSystemPromptWithResearch,
  buildNyayaUserPrompt,
  buildNyayaUserPromptWithResearch,
  constrainCitedAnswer,
  constrainUnsupportedFraudPremise,
  constrainUnsupportedStatusClaims,
  constrainUnverifiedContradiction,
  createAIProviderFromEnv,
  ensureMissingInstrumentDisclosure,
  formatEvidenceAssessmentForPrompt,
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
  type RiskSignal,
  type RoutingMode,
  namedInstrumentFromQuestion,
  instrumentMentionedInText,
  instrumentMentionIsDenial,
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
import {
  ensureLimitedCoverageDisclosure,
  ensureUnvalidatedCoverageDisclosure,
  formatJurisdictionDisclosure,
  preferredSearchHints,
  resolveMatterJurisdictionContext,
  shouldAbstainForUnknownJurisdiction,
  UNKNOWN_JURISDICTION_ABSTENTION,
} from "@nyayagrid/jurisdiction";
import type { Retriever, RetrievalHit } from "./hybrid";

/** Retrieval surface for the legal authority corpus; matter documents are never searched here. */
export type NyayaAuthorityRetriever = {
  search(
    query: string,
    filters?: AuthoritySearchFilters,
    options?: {
      limit?: number;
      preferredStateCodes?: string[];
      preferredCircuitIds?: string[];
    },
  ): Promise<AuthoritySearchHit[]>;
};

const AUTHORITY_HIT_LIMIT = 6;

async function loadAmendmentHits(params: {
  db: Database;
  retriever: Retriever;
  organizationId: string;
  matterId: string;
}): Promise<RetrievalHit[]> {
  const amendmentDocs = await params.db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
        or(
          sql`${documents.title} ILIKE ${"%amend%"}`,
          sql`${documentVersions.originalFilename} ILIKE ${"%amend%"}`,
        ),
      ),
    );
  const allowedDocumentIds = [...new Set(amendmentDocs.map((row) => row.id))];
  if (allowedDocumentIds.length === 0) return [];
  const morePromise = params.retriever.search({
    text: "amendment convenience notice becomes effective deleted and replaced",
    scope: {
      organizationId: params.organizationId,
      matterId: params.matterId,
      workspace: "professional",
      allowedDocumentIds,
    },
    limit: 6,
  });
  const loadedPromise = params.retriever.loadChunksByDocumentIds
    ? params.retriever.loadChunksByDocumentIds({
        organizationId: params.organizationId,
        matterId: params.matterId,
        documentIds: allowedDocumentIds,
        limit: 8,
      })
    : Promise.resolve([] as RetrievalHit[]);
  const [more, loaded] = await Promise.all([morePromise, loadedPromise]);
  return [...more, ...loaded];
}

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
  searchOptions?: {
    preferredStateCodes?: string[];
    preferredCircuitIds?: string[];
  };
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
      ...(params.searchOptions ?? {}),
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
        hierarchyRelationship: undefined,
        jurisdiction: hit.jurisdiction,
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
  executionStrategy?: RoutingMode;
  modelId?: string;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const startedAsk = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string, started: number) => {
    timings[name] = Date.now() - started;
  };
  const professionalScope = {
    organizationId: params.organizationId,
    matterId: params.matterId,
    workspace: "professional" as const,
  };
  const followUpQuery = buildFollowUpRetrievalQuery(params.question);
  const followUpDiffers = Boolean(followUpQuery && followUpQuery !== params.question.trim());
  const noticeExpand =
    /\bnotice\b/i.test(params.question) && /\b(on 20\d{2}-|will apply)\b/i.test(params.question);
  const amendmentExpand =
    /\b(on 20\d{2}-|will apply|supersed|modified provision)\b/i.test(params.question) &&
    /\b(notice|terminat|amend|obligation|cap|provision)\b/i.test(params.question);
  const conflictExpand = /\b(conflict|contradict|inconsistent)\b/i.test(params.question);

  const retrievalStarted = Date.now();
  const primaryPromise = params.retriever.search({
    text: params.question,
    scope: professionalScope,
    limit: 8,
  });
  const followParallelPromise = followUpDiffers
    ? params.retriever.search({
        text: followUpQuery!,
        scope: professionalScope,
        limit: 8,
      })
    : Promise.resolve([] as RetrievalHit[]);
  const noticePromise = noticeExpand
    ? params.retriever.search({
        text: "amendment convenience notice becomes effective",
        scope: professionalScope,
        limit: 6,
      })
    : Promise.resolve([] as RetrievalHit[]);
  const amendmentPromise = amendmentExpand
    ? loadAmendmentHits(params)
    : Promise.resolve([] as RetrievalHit[]);
  const conflictPromise = conflictExpand
    ? Promise.all([
        params.retriever.search({
          text: "deposition testimony meeting calendar date",
          scope: professionalScope,
          limit: 6,
        }),
        params.retriever.search({
          text: "meeting minutes attendees dated",
          scope: professionalScope,
          limit: 6,
        }),
      ])
    : Promise.resolve([[], []] as [RetrievalHit[], RetrievalHit[]]);

  const [primaryHits, followParallelHits, noticeHits, amendmentHits, conflictPair] = await Promise.all([
    primaryPromise,
    followParallelPromise,
    noticePromise,
    amendmentPromise,
    conflictPromise,
  ]);

  let usedFollowUpRetrieval = false;
  let hits = primaryHits;
  const merge = (extra: typeof primaryHits, cap: number) => {
    if (extra.length === 0) return;
    usedFollowUpRetrieval = true;
    const seen = new Set(hits.map((h) => h.chunkId));
    for (const hit of extra) {
      if (seen.has(hit.chunkId)) continue;
      seen.add(hit.chunkId);
      hits.push(hit);
      if (hits.length >= cap) break;
    }
  };

  if (followUpDiffers) merge(followParallelHits, 12);
  else if (followUpQuery && primaryHits.length < 3) {
    const secondaryHits = await params.retriever.search({
      text: followUpQuery,
      scope: professionalScope,
      limit: 8,
    });
    merge(secondaryHits, 12);
  }
  if (noticeExpand) merge(noticeHits, 14);
  if (amendmentExpand) merge(amendmentHits, 16);
  if (conflictExpand) {
    merge(conflictPair[0], 14);
    if (hits.length < 14) merge(conflictPair[1], 14);
  }
  mark("retrievalMs", retrievalStarted);

  const rankedHits = rankByQuestionOverlap(params.question, hits);
  const passages: GroundingPassage[] = rankedHits.map((hit) => ({
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    documentVersionId: hit.documentVersionId,
    page: hit.page,
    segmentRef: hit.segmentRef,
    quote: hit.quote,
  }));

  const assessmentAbort = new AbortController();
  const assessmentTimer = setTimeout(() => assessmentAbort.abort(), 8_000);
  const assessmentPromise = assessRetrievedEvidence({
    question: params.question,
    passages,
    signal: assessmentAbort.signal,
  }).finally(() => clearTimeout(assessmentTimer));

  const contextStarted = Date.now();
  const [verifiedText, graphText, memoryText, analysisText, jurisdictionContext] = await Promise.all([
    params.includeVerifiedIntelligence === false
      ? Promise.resolve(null)
      : loadVerifiedMatterIntelligence({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
        }).then((verified) => formatVerifiedIntelligenceForPrompt(verified) || null),
    params.includeGraph === false
      ? Promise.resolve(null)
      : loadVerifiedGraphContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          question: params.question,
          limit: 10,
        }).then((graph) => graph.text || null),
    params.includeMemory === false
      ? Promise.resolve(null)
      : retrieveActiveMatterMemories({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          question: params.question,
          limit: 6,
        }).then((memories) => formatActiveMemoryForPrompt(memories) || null),
    params.includeProfessionalAnalysis === false
      ? Promise.resolve(null)
      : loadProfessionalAnalysisContext({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          question: params.question,
          limit: 12,
        }).then((analysis) => formatProfessionalAnalysisForPrompt(analysis) || null),
    resolveMatterJurisdictionContext({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
    }),
  ]);
  mark("contextMs", contextStarted);
  const jurisdictionHints = preferredSearchHints(jurisdictionContext);
  const jurisdictionBlock = jurisdictionContext?.promptBlock?.trim()
    ? `${jurisdictionContext.promptBlock.trim()}\n\n`
    : "";

  const doctrineQuestion = looksLikeLegalDoctrineQuestion(params.question);
  const authorityStarted = Date.now();
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
          searchOptions: jurisdictionHints,
        });
  mark("authorityMs", authorityStarted);
  const authorityText = authority?.text ?? null;
  const useResearchPrompt = Boolean(authorityText) || doctrineQuestion;

  const assessmentResult = await assessmentPromise;
  const assessmentText = assessmentResult.assessment
    ? formatEvidenceAssessmentForPrompt(assessmentResult.assessment)
    : null;

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

  const generateStarted = Date.now();
  const generation = await ai.generate({
    temperature: 0,
    routing: {
      subsystem: useResearchPrompt ? "research" : "ask",
      strategy: params.executionStrategy ?? "auto",
      modelId: params.modelId,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      promptVersion: NYAYA_PROMPT_VERSION,
      retrievalIds: passages.map((p) => p.chunkId),
      evidenceChunkIds: passages.map((p) => p.chunkId),
      authorityIds: [...(authority?.authorityIds ?? [])],
      jurisdictionSummary: jurisdictionContext?.summary,
      contextTokensEstimate: Math.ceil(
        (jurisdictionBlock.length + (authorityText?.length ?? 0) + passages.reduce((n, p) => n + p.quote.length, 0)) /
          4,
      ),
      riskSignals: askRiskSignals({
        coverage: jurisdictionContext?.coverage,
        relatedCount: jurisdictionContext?.relatedJurisdictions.length ?? 0,
        governingLawState: jurisdictionContext?.governingLawState,
        choiceOfLawDistinct: jurisdictionContext?.choiceOfLawDistinctFromForum,
        retrievedCount: passages.length,
        question: params.question,
        passageText: passages.map((p) => `${p.documentId} ${p.quote}`).join("\n"),
      }),
    },
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
          ? `${jurisdictionBlock}${buildNyayaUserPromptWithResearch(
              params.question,
              passages,
              authorityText ?? "",
              verifiedText,
              graphText,
              memoryText,
              analysisText,
              assessmentText,
            )}`
          : `${jurisdictionBlock}${buildNyayaUserPrompt(
              params.question,
              passages,
              verifiedText,
              graphText,
              memoryText,
              analysisText,
              assessmentText,
            )}`,
      },
    ],
  });
  mark("generateMs", generateStarted);
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
  if (assessmentResult.assessment) {
    validated.answer = constrainCitedAnswer(
      validated.answer,
      assessmentResult.assessment,
      passages,
    );
  }
  validated.answer = constrainUnsupportedStatusClaims(
    validated.answer,
    passages.map((p) => p.quote).join("\n"),
  );
  validated.answer = constrainUnsupportedFraudPremise(
    validated.answer,
    params.question,
    passages.map((p) => p.quote).join("\n"),
  );
  validated.answer = constrainUnverifiedContradiction(
    validated.answer,
    params.question,
    passages.map((p) => p.quote).join("\n"),
  );
  if (
    /\b(on 20\d{2}-|will apply)\b/i.test(params.question) &&
    /\bnotice\b/i.test(params.question)
  ) {
    const extra = passages.filter(
      (passage) =>
        /\bamendment\b/i.test(passage.quote) &&
        /\bnotice\b/i.test(passage.quote) &&
        !validated.answer.sources.some((source) => source.documentId === passage.documentId),
    );
    if (extra.length > 0) {
      validated.answer = {
        ...validated.answer,
        sources: [
          ...validated.answer.sources,
          ...extra.slice(0, 2).map((passage) => ({
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            page: passage.page ?? undefined,
            quote: passage.quote,
          })),
        ],
      };
    }
  }
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

  if (shouldAbstainForUnknownJurisdiction(params.question, jurisdictionContext)) {
    if (validated.answer.evidenceState !== "grounded") {
      validated.answer.answer = UNKNOWN_JURISDICTION_ABSTENTION;
      validated.answer.evidenceState = "insufficient";
    }
    const missing = "Which forum and governing law should be recorded for this Case?";
    if (!validated.answer.unresolvedQuestions.includes(missing)) {
      validated.answer.unresolvedQuestions = [...validated.answer.unresolvedQuestions, missing];
    }
  } else if (doctrineQuestion && jurisdictionContext) {
    const disclosure = formatJurisdictionDisclosure(jurisdictionContext);
    if (disclosure && !validated.answer.answer.toLowerCase().includes("based on") && !validated.answer.answer.toLowerCase().includes("forum:")) {
      validated.answer.answer = `${disclosure} ${validated.answer.answer}`;
    }
    validated.answer.answer = ensureUnvalidatedCoverageDisclosure(
      validated.answer.answer,
      jurisdictionContext.coverage,
    );
    validated.answer.answer = ensureLimitedCoverageDisclosure(
      validated.answer.answer,
      jurisdictionContext.coverage,
    );
  }
  validated.answer.answer = ensureMissingInstrumentDisclosure(
    params.question,
    validated.answer.answer,
    [...passages.map((passage) => passage.quote), ...(authority?.sourceTexts ?? [])].join("\n"),
  );
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
        evidenceAssessmentStatus: assessmentResult.assessment?.status ?? "skipped",
        premiseStatus: assessmentResult.assessment?.premiseStatus ?? null,
        dateSensitive: assessmentResult.assessment?.dateSensitive ?? false,
        assessmentModel: assessmentResult.model,
        assessmentLatency: assessmentResult.latencyMs,
        assessmentFailure: assessmentResult.failure,
        assessmentSource: assessmentResult.source,
        assessmentTriggered: assessmentResult.triggered,
        assessmentCategories: assessmentResult.categories,
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
    timings: {
      ...timings,
      assessmentMs: assessmentResult.latencyMs,
      totalMs: Date.now() - startedAsk,
    },
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

function askRiskSignals(params: {
  coverage?: string | null;
  relatedCount: number;
  governingLawState?: string | null;
  choiceOfLawDistinct?: boolean;
  retrievedCount: number;
  question?: string;
  passageText?: string;
}): RiskSignal[] {
  const signals: RiskSignal[] = [];
  if (params.coverage === "limited") signals.push("limited_coverage");
  if (params.coverage === "unvalidated") signals.push("unvalidated_coverage");
  if (params.relatedCount > 0 || params.choiceOfLawDistinct) signals.push("multiple_jurisdictions");
  if (!params.governingLawState) signals.push("missing_governing_law");
  if (params.retrievedCount < 2) signals.push("weak_retrieval");
  const named = namedInstrumentFromQuestion(params.question ?? "");
  if (
    named &&
    (!instrumentMentionedInText(named, params.passageText ?? "") ||
      instrumentMentionIsDenial(named, params.passageText ?? ""))
  ) {
    signals.push("missing_exhibit");
  }
  return signals;
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
