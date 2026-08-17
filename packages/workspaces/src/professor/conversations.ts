import { and, asc, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { studentConversations, studentMessages } from "@nyayagrid/database";
import type {
  ExplanationLevel,
  StudentConversation,
  StudentMessage,
  StudentSourceRef,
} from "@nyayagrid/database";
import {
  PROFESSOR_ANSWER_PROMPT_VERSION,
  buildProfessorAnswerSystemPrompt,
  buildProfessorAnswerUserPrompt,
  createAIProviderFromEnv,
  createEmbeddingProviderFromEnv,
  professorAnswerSchema,
  type AIProvider,
  type EmbeddingProvider,
  type ProfessorAnswer,
  type ResearchAuthorityChunk,
} from "@nyayagrid/ai";
import {
  AuthorityHybridRetriever,
  loadAuthorizedAuthorityChunks,
  looksLikeLegalDoctrineQuestion,
  validateQuoteAgainstText,
} from "@nyayagrid/research";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { StudentAccessError, assertStudentConversationOwnership } from "./auth";
import { assertStudentCaseOwnership } from "./auth";
import { caseDisplayLabel } from "./cases";
import { searchStudentCaseChunks } from "./search";
import type { StudentChunkHit } from "./isolation";

export const PROFESSOR_STUDY_AID_NOTICE =
  "Nyaya Professor is a study aid. It explains the material you provided and does not replace your course instruction, your professor, or reading the opinion itself.";

export const NO_STUDENT_SOURCES_ANSWER =
  "I do not have passages that answer this. No uploaded case text and no legal authority passages were retrieved, so nothing is asserted here about the law. Upload the relevant case text or narrow the question, and read the source material directly.";

export const NO_AUTHORITY_LIMITATION =
  "No legal authority passages were retrieved, so no doctrinal rule is stated as law.";

export const CASE_ONLY_LIMITATION =
  "This answer is grounded in the case you uploaded only; it does not establish what the law is in any jurisdiction.";

export const RESTRICTED_ASSESSMENT_ANSWER =
  "Nyaya Professor will not complete a closed or restricted assessment. Use your own work and your course materials. This is a study aid, not a substitute for sitting the exam yourself.";

export const RESTRICTED_ASSESSMENT_LIMITATION =
  "Refused: the question described a closed or restricted assessment. Nyaya Professor does not complete exams.";

export const PROFESSOR_STARTER_PROMPTS = [
  { id: "explain-simply", label: "Explain simply", text: "Explain this in simple terms." },
  {
    id: "why-ruled",
    label: "Why the court ruled",
    text: "Why did the court rule this way?",
  },
  {
    id: "important-fact",
    label: "Most important fact",
    text: "What is the most important fact in this case?",
  },
  {
    id: "hypothetical",
    label: "Hypothetical",
    text: "What if a key fact in this case were different?",
  },
  {
    id: "compare",
    label: "Compare with another case",
    text: "How does this compare with another case in my library?",
  },
] as const;

const DEFAULT_CASE_HIT_LIMIT = 8;
const DEFAULT_AUTHORITY_HIT_LIMIT = 6;

const RESTRICTED_ASSESSMENT_PATTERN =
  /\b(closed[ -]?book|restricted (exam|assessment|test)|this is (my |an? )?(exam|midterm|final exam)|take[ -]?home exam|proctored exam|complete (this |my )?(exam|midterm|final))\b/i;

/** Deterministic keyword check. A student saying this is an exam is enough — do not send it to the model. */
export function looksLikeRestrictedAssessment(question: string): boolean {
  return RESTRICTED_ASSESSMENT_PATTERN.test(question);
}

export async function createConversation(params: {
  db: Database;
  userId: string;
  title: string;
  explanationLevel?: ExplanationLevel;
  caseId?: string | null;
}): Promise<StudentConversation> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const title = params.title.trim();
  if (!title) throw new Error("Conversation title is required");
  if (params.caseId) {
    await assertStudentCaseOwnership(params.db, params.userId, params.caseId);
  }
  const [row] = await params.db
    .insert(studentConversations)
    .values({
      userId: params.userId,
      title: title.slice(0, 200),
      explanationLevel: params.explanationLevel ?? "standard",
      caseId: params.caseId ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create student conversation");
  return row;
}

/** Reuses the single persistent thread for this case, or starts it. */
export async function getOrCreateCaseConversation(params: {
  db: Database;
  userId: string;
  caseId: string;
  explanationLevel?: ExplanationLevel;
}): Promise<StudentConversation> {
  const studentCase = await assertStudentCaseOwnership(params.db, params.userId, params.caseId);
  const [existing] = await params.db
    .select()
    .from(studentConversations)
    .where(
      and(
        eq(studentConversations.userId, params.userId),
        eq(studentConversations.caseId, studentCase.id),
      ),
    )
    .limit(1);
  if (existing) return existing;
  return createConversation({
    db: params.db,
    userId: params.userId,
    title: `About ${studentCase.title}`.slice(0, 200),
    explanationLevel: params.explanationLevel,
    caseId: studentCase.id,
  });
}

export async function listConversations(
  db: Database,
  userId: string,
): Promise<StudentConversation[]> {
  if (!userId) throw new StudentAccessError("userId is required");
  return db
    .select()
    .from(studentConversations)
    .where(eq(studentConversations.userId, userId))
    .orderBy(desc(studentConversations.updatedAt));
}

export async function getConversation(
  db: Database,
  userId: string,
  conversationId: string,
): Promise<{ conversation: StudentConversation; messages: StudentMessage[] }> {
  const conversation = await assertStudentConversationOwnership(db, userId, conversationId);
  const messages = await db
    .select()
    .from(studentMessages)
    .where(
      and(eq(studentMessages.conversationId, conversation.id), eq(studentMessages.userId, userId)),
    )
    .orderBy(asc(studentMessages.createdAt));
  return { conversation, messages };
}

/** Everything a Professor answer is allowed to cite, built from what retrieval actually returned. */
export type ProfessorRetrievalIndex = {
  caseChunkIds: Set<string>;
  caseTextByChunkId: Map<string, string>;
  caseIdByChunkId: Map<string, string>;
  caseVersionIdByChunkId: Map<string, string>;
  pageByChunkId: Map<string, number | null>;
  opinionPartByChunkId: Map<string, "majority" | "concurrence" | "dissent" | null>;
  authorityIds: Set<string>;
  authorityChunkIds: Set<string>;
  authorityIdByChunkId: Map<string, string>;
  authorityTextByChunkId: Map<string, string>;
};

export function buildProfessorRetrievalIndex(input: {
  caseHits: StudentChunkHit[];
  authorityChunks: ResearchAuthorityChunk[];
}): ProfessorRetrievalIndex {
  const index: ProfessorRetrievalIndex = {
    caseChunkIds: new Set(),
    caseTextByChunkId: new Map(),
    caseIdByChunkId: new Map(),
    caseVersionIdByChunkId: new Map(),
    pageByChunkId: new Map(),
    opinionPartByChunkId: new Map(),
    authorityIds: new Set(),
    authorityChunkIds: new Set(),
    authorityIdByChunkId: new Map(),
    authorityTextByChunkId: new Map(),
  };
  for (const hit of input.caseHits) {
    index.caseChunkIds.add(hit.chunkId);
    index.caseTextByChunkId.set(hit.chunkId, hit.content);
    index.caseIdByChunkId.set(hit.chunkId, hit.caseId);
    index.caseVersionIdByChunkId.set(hit.chunkId, hit.caseVersionId);
    index.pageByChunkId.set(hit.chunkId, hit.pageStart ?? null);
    index.opinionPartByChunkId.set(hit.chunkId, hit.opinionPart ?? null);
  }
  for (const chunk of input.authorityChunks) {
    index.authorityIds.add(chunk.authorityId);
    index.authorityChunkIds.add(chunk.chunkId);
    index.authorityIdByChunkId.set(chunk.chunkId, chunk.authorityId);
    index.authorityTextByChunkId.set(chunk.chunkId, chunk.content);
  }
  return index;
}

export type ProfessorAnswerValidation = {
  answer: ProfessorAnswer;
  sources: StudentSourceRef[];
  grounded: boolean;
  droppedCaseChunkIds: string[];
  droppedAuthorityChunkIds: string[];
  rejectedQuotes: Array<{ chunkId: string | null; reason: string }>;
  schemaValid: boolean;
};

function emptyAnswer(level: ExplanationLevel, limitations: string[]): ProfessorAnswer {
  return {
    answer: NO_STUDENT_SOURCES_ANSWER,
    explanationLevel: level,
    uploadedCaseSources: [],
    legalAuthoritySources: [],
    explanationNotes: [PROFESSOR_STUDY_AID_NOTICE],
    socraticFollowUp: null,
    supportState: "insufficient",
    limitations,
  };
}

/**
 * Validate a generated Professor answer against retrieval.
 *
 * Citations the model invented are removed, quotes that are not verbatim in the cited passage lose
 * the quote, and the three provenance classes are kept in separate source entries. If nothing
 * survives, the answer is replaced with an explicit "not supported" statement rather than being
 * presented as an ungrounded explanation.
 */
export function validateProfessorAnswer(
  raw: unknown,
  index: ProfessorRetrievalIndex,
  level: ExplanationLevel,
): ProfessorAnswerValidation {
  const parsed = professorAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      answer: emptyAnswer(level, [
        "The generated answer did not match the required structure and was discarded.",
      ]),
      sources: [],
      grounded: false,
      droppedCaseChunkIds: [],
      droppedAuthorityChunkIds: [],
      rejectedQuotes: [],
      schemaValid: false,
    };
  }

  const answer = parsed.data;
  const droppedCaseChunkIds: string[] = [];
  const droppedAuthorityChunkIds: string[] = [];
  const rejectedQuotes: Array<{ chunkId: string | null; reason: string }> = [];
  const sources: StudentSourceRef[] = [];

  const checkQuote = (quote: string | null | undefined, sourceText: string | undefined) => {
    const text = quote?.trim();
    if (!text) return null;
    if (!sourceText) return null;
    const result = validateQuoteAgainstText(text, sourceText);
    return result.valid ? (result.normalizedQuote ?? text) : null;
  };

  const uploadedCaseSources: ProfessorAnswer["uploadedCaseSources"] = [];
  for (const source of answer.uploadedCaseSources) {
    if (!index.caseChunkIds.has(source.chunkId)) {
      droppedCaseChunkIds.push(source.chunkId);
      continue;
    }
    if (index.caseIdByChunkId.get(source.chunkId) !== source.caseId) {
      droppedCaseChunkIds.push(source.chunkId);
      continue;
    }
    const verified = checkQuote(source.quote, index.caseTextByChunkId.get(source.chunkId));
    if (source.quote?.trim() && !verified) {
      rejectedQuotes.push({
        chunkId: source.chunkId,
        reason: "Quote does not appear verbatim in the uploaded case passage.",
      });
    }
    uploadedCaseSources.push({ ...source, quote: verified });
    sources.push({
      provenance: "UPLOADED_CASE",
      caseId: source.caseId,
      caseVersionId: index.caseVersionIdByChunkId.get(source.chunkId),
      chunkId: source.chunkId,
      page: index.pageByChunkId.get(source.chunkId) ?? null,
      opinionPart: index.opinionPartByChunkId.get(source.chunkId) ?? null,
      quote: verified,
    });
  }

  const legalAuthoritySources: ProfessorAnswer["legalAuthoritySources"] = [];
  for (const source of answer.legalAuthoritySources) {
    if (!index.authorityIds.has(source.authorityId)) {
      if (source.chunkId) droppedAuthorityChunkIds.push(source.chunkId);
      continue;
    }
    if (source.chunkId && !index.authorityChunkIds.has(source.chunkId)) {
      droppedAuthorityChunkIds.push(source.chunkId);
      continue;
    }
    if (source.chunkId && index.authorityIdByChunkId.get(source.chunkId) !== source.authorityId) {
      droppedAuthorityChunkIds.push(source.chunkId);
      continue;
    }
    const sourceText = source.chunkId
      ? index.authorityTextByChunkId.get(source.chunkId)
      : undefined;
    const verified = checkQuote(source.quote, sourceText);
    if (source.quote?.trim() && !verified) {
      rejectedQuotes.push({
        chunkId: source.chunkId ?? null,
        reason: "Quote does not appear verbatim in the cited authority passage.",
      });
    }
    legalAuthoritySources.push({ ...source, quote: verified });
    sources.push({
      provenance: "LEGAL_AUTHORITY",
      authorityId: source.authorityId,
      authorityChunkId: source.chunkId ?? undefined,
      quote: verified,
    });
  }

  for (const note of answer.explanationNotes) {
    if (note.trim()) {
      sources.push({ provenance: "PROFESSOR_EXPLANATION", note: note.trim() });
    }
  }

  const grounded = uploadedCaseSources.length > 0 || legalAuthoritySources.length > 0;
  const limitations = [...answer.limitations];
  if (droppedCaseChunkIds.length > 0 || droppedAuthorityChunkIds.length > 0) {
    limitations.push(
      `${droppedCaseChunkIds.length + droppedAuthorityChunkIds.length} citation(s) were removed because they did not match the retrieved passages.`,
    );
  }
  if (rejectedQuotes.length > 0) {
    limitations.push(
      `${rejectedQuotes.length} quotation(s) were removed because they could not be verified verbatim against the cited passage.`,
    );
  }
  if (legalAuthoritySources.length === 0) {
    limitations.push(NO_AUTHORITY_LIMITATION);
  } else if (uploadedCaseSources.length === 0) {
    limitations.push(CASE_ONLY_LIMITATION);
  }

  if (!grounded) {
    return {
      answer: emptyAnswer(level, [...new Set(limitations)]),
      sources: sources.filter((source) => source.provenance === "PROFESSOR_EXPLANATION"),
      grounded: false,
      droppedCaseChunkIds,
      droppedAuthorityChunkIds,
      rejectedQuotes,
      schemaValid: true,
    };
  }

  return {
    answer: {
      ...answer,
      uploadedCaseSources,
      legalAuthoritySources,
      explanationNotes: [...new Set([...answer.explanationNotes, PROFESSOR_STUDY_AID_NOTICE])],
      supportState: answer.supportState === "insufficient" ? "partial" : answer.supportState,
      limitations: [...new Set(limitations)],
    },
    sources,
    grounded: true,
    droppedCaseChunkIds,
    droppedAuthorityChunkIds,
    rejectedQuotes,
    schemaValid: true,
  };
}

export type AskProfessorParams = {
  db: Database;
  userId: string;
  /** Continues an existing conversation, or starts a new one when omitted. */
  conversationId?: string | null;
  question: string;
  explanationLevel?: ExplanationLevel;
  /** Limits uploaded-case retrieval to one case the user owns. */
  caseId?: string | null;
  embeddings?: EmbeddingProvider;
  ai?: AIProvider;
  /** Defaults to searching the shared corpus only for doctrinal questions. */
  includeAuthority?: boolean;
  limit?: number;
};

export type AskProfessorResult = {
  conversation: StudentConversation;
  message: StudentMessage;
  answer: ProfessorAnswer;
  sources: StudentSourceRef[];
  socraticFollowUp: string | null;
  grounded: boolean;
  caseHitCount: number;
  authorityChunkCount: number;
  validation: Omit<ProfessorAnswerValidation, "answer" | "sources">;
  provider: string;
  model: string;
};

/**
 * Answer one student question.
 *
 * Retrieval reads the student's own case chunks (never another user's, never a matter document) and
 * optionally the shared legal authority corpus. Uploaded-case support and legal-authority support
 * stay in separate provenance classes all the way to the persisted message.
 */
export async function askProfessor(params: AskProfessorParams): Promise<AskProfessorResult> {
  if (!params.userId) throw new StudentAccessError("userId is required");
  const question = params.question.trim();
  if (!question) throw new Error("A question is required");

  const ai = params.ai ?? createAIProviderFromEnv();
  const embeddings = params.embeddings ?? createEmbeddingProviderFromEnv();

  const conversation = params.conversationId
    ? await assertStudentConversationOwnership(params.db, params.userId, params.conversationId)
    : params.caseId
      ? await getOrCreateCaseConversation({
          db: params.db,
          userId: params.userId,
          caseId: params.caseId,
          explanationLevel: params.explanationLevel,
        })
      : await createConversation({
          db: params.db,
          userId: params.userId,
          title: question.slice(0, 200),
          explanationLevel: params.explanationLevel,
        });
  const level = params.explanationLevel ?? conversation.explanationLevel;
  const scopedCaseId = params.caseId ?? conversation.caseId ?? null;

  await params.db.insert(studentMessages).values({
    conversationId: conversation.id,
    userId: params.userId,
    role: "user",
    content: question,
    explanationLevel: level,
  });

  if (looksLikeRestrictedAssessment(question)) {
    const [message] = await params.db
      .insert(studentMessages)
      .values({
        conversationId: conversation.id,
        userId: params.userId,
        role: "assistant",
        content: RESTRICTED_ASSESSMENT_ANSWER,
        explanationLevel: level,
        sources: [{ provenance: "PROFESSOR_EXPLANATION", note: RESTRICTED_ASSESSMENT_LIMITATION }],
        socraticFollowUp: null,
        provider: "deterministic",
        model: "restricted-assessment-guard",
        promptVersion: PROFESSOR_ANSWER_PROMPT_VERSION,
      })
      .returning();
    if (!message) throw new Error("Failed to persist the restricted-assessment refusal");

    await writeAuditEvent(params.db, {
      organizationId: null,
      actorUserId: params.userId,
      action: "student_professor.restricted_assessment_refused",
      targetType: "student_conversation",
      targetId: conversation.id,
      metadata: {
        messageId: message.id,
        caseId: scopedCaseId,
        explanationLevel: level,
      },
    });

    return {
      conversation,
      message,
      answer: {
        answer: RESTRICTED_ASSESSMENT_ANSWER,
        explanationLevel: level,
        uploadedCaseSources: [],
        legalAuthoritySources: [],
        explanationNotes: [RESTRICTED_ASSESSMENT_LIMITATION],
        limitations: [RESTRICTED_ASSESSMENT_LIMITATION, PROFESSOR_STUDY_AID_NOTICE],
        socraticFollowUp: null,
        supportState: "insufficient",
      },
      sources: [{ provenance: "PROFESSOR_EXPLANATION", note: RESTRICTED_ASSESSMENT_LIMITATION }],
      socraticFollowUp: null,
      grounded: false,
      caseHitCount: 0,
      authorityChunkCount: 0,
      validation: {
        droppedCaseChunkIds: [],
        droppedAuthorityChunkIds: [],
        rejectedQuotes: [],
        grounded: false,
        schemaValid: true,
      },
      provider: "deterministic",
      model: "restricted-assessment-guard",
    };
  }

  let caseLabel: string | null = null;
  let caseHits: StudentChunkHit[] = [];
  if (scopedCaseId) {
    const studentCase = await assertStudentCaseOwnership(params.db, params.userId, scopedCaseId);
    caseLabel = caseDisplayLabel(studentCase);
    caseHits = await searchStudentCaseChunks({
      db: params.db,
      userId: params.userId,
      caseId: studentCase.id,
      query: question,
      embeddings,
      limit: params.limit ?? DEFAULT_CASE_HIT_LIMIT,
    });
  }

  const wantsAuthority = params.includeAuthority ?? looksLikeLegalDoctrineQuestion(question);
  let authorityChunks: ResearchAuthorityChunk[] = [];
  if (wantsAuthority) {
    const retriever = new AuthorityHybridRetriever(params.db, embeddings);
    const hits = await retriever.search(question, {}, { limit: DEFAULT_AUTHORITY_HIT_LIMIT });
    const texts = await loadAuthorizedAuthorityChunks({
      db: params.db,
      chunkIds: hits.map((hit) => hit.chunkId),
    });
    authorityChunks = hits.map((hit) => ({
      authorityId: hit.authorityId,
      chunkId: hit.chunkId,
      citation: hit.citation,
      court: hit.court,
      date: hit.decisionDate,
      content: texts.get(hit.chunkId)?.content ?? hit.snippet,
    }));
  }

  const index = buildProfessorRetrievalIndex({ caseHits, authorityChunks });

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "professor_answer",
    messages: [
      { role: "system", content: buildProfessorAnswerSystemPrompt(level) },
      {
        role: "user",
        content: buildProfessorAnswerUserPrompt({
          question,
          explanationLevel: level,
          caseLabel,
          caseChunks: caseHits.map((hit) => ({
            caseId: hit.caseId,
            chunkId: hit.chunkId,
            opinionPart: hit.opinionPart ?? null,
            page: hit.pageStart ?? null,
            content: hit.content,
          })),
          authorityChunks,
        }),
      },
    ],
  });

  const validated = validateProfessorAnswer(parseJson(generation.text), index, level);

  const [message] = await params.db
    .insert(studentMessages)
    .values({
      conversationId: conversation.id,
      userId: params.userId,
      role: "assistant",
      content: validated.answer.answer,
      explanationLevel: level,
      sources: validated.sources,
      socraticFollowUp: validated.answer.socraticFollowUp ?? null,
      provider: generation.provider,
      model: generation.model,
      promptVersion: PROFESSOR_ANSWER_PROMPT_VERSION,
    })
    .returning();
  if (!message) throw new Error("Failed to persist the Professor answer");

  const [updatedConversation] = await params.db
    .update(studentConversations)
    .set({ explanationLevel: level, updatedAt: new Date() })
    .where(
      and(
        eq(studentConversations.id, conversation.id),
        eq(studentConversations.userId, params.userId),
      ),
    )
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: null,
    actorUserId: params.userId,
    action: "student_professor.question_answered",
    targetType: "student_conversation",
    targetId: conversation.id,
    metadata: {
      messageId: message.id,
      caseId: scopedCaseId,
      explanationLevel: level,
      caseHitCount: caseHits.length,
      authorityChunkCount: authorityChunks.length,
      grounded: validated.grounded,
      droppedCitationCount:
        validated.droppedCaseChunkIds.length + validated.droppedAuthorityChunkIds.length,
      rejectedQuoteCount: validated.rejectedQuotes.length,
      provider: generation.provider,
      model: generation.model,
      promptVersion: PROFESSOR_ANSWER_PROMPT_VERSION,
    },
  });

  const { answer, sources, ...validationRest } = validated;
  return {
    conversation: updatedConversation ?? conversation,
    message,
    answer,
    sources,
    socraticFollowUp: answer.socraticFollowUp ?? null,
    grounded: validated.grounded,
    caseHitCount: caseHits.length,
    authorityChunkCount: authorityChunks.length,
    validation: validationRest,
    provider: generation.provider,
    model: generation.model,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
