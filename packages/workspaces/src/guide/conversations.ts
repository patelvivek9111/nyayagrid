import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { guideConversations, guideMessages, guideSituationEvents } from "@nyayagrid/database";
import type { GuideConversation, GuideMessage, GuideSourceRef } from "@nyayagrid/database";
import type { AIProvider, EmbeddingProvider } from "@nyayagrid/ai";
import {
  buildGuideAnswerSystemPrompt,
  buildGuideAnswerUserPrompt,
  detectHighStakes,
  guideAnswerSchema,
  buildContextualDisclaimer,
  GUIDE_ANSWER_PROMPT_VERSION,
  type GuideChunk,
  type GuideSourceInput,
} from "@nyayagrid/ai";
import { assertGuideDocumentOwnership, assertGuideSituationOwnership } from "./auth";
import { GuideDocumentHybridRetriever } from "./search";
import { validateQuoteAgainstText } from "./quotes";
import { enforceIllegalityGuardrail } from "./guardrails";

export const createGuideConversationInputSchema = z.object({
  title: z.string().trim().max(300).optional().nullable(),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
});

export type CreateGuideConversationInput = z.infer<typeof createGuideConversationInputSchema>;

export async function createGuideConversation(
  db: Database,
  userId: string,
  input: CreateGuideConversationInput = {},
): Promise<GuideConversation> {
  const parsed = createGuideConversationInputSchema.parse(input);
  const [conversation] = await db
    .insert(guideConversations)
    .values({
      userId,
      title: parsed.title?.trim() || "Guide conversation",
      jurisdiction: parsed.jurisdiction ?? null,
    })
    .returning();
  if (!conversation) throw new Error("Failed to create guide conversation");
  return conversation;
}

type AuthorityChunkRow = {
  chunk_id: string;
  authority_id: string;
  content: string;
  citation: string | null;
};

/**
 * Minimal read-only hybrid search over the shared legal_authorities corpus. Deliberately
 * standalone (not imported from @nyayagrid/research) to avoid coupling Guide to the professional
 * research package graph; it only ever reads legal_authority_chunks/legal_authorities/versions.
 */
async function searchLegalAuthorityChunks(
  db: Database,
  embeddings: EmbeddingProvider,
  query: string,
  limit = 5,
): Promise<GuideChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const execute = (statement: unknown) =>
    (db as unknown as { execute: (q: unknown) => Promise<AuthorityChunkRow[]> }).execute(
      statement,
    ) as Promise<AuthorityChunkRow[]>;

  const [embedding] = await embeddings.embed([trimmed]);
  const rows = embedding
    ? await execute(sql`
        SELECT c.id AS chunk_id, c.authority_id, c.content, a.citation
        FROM legal_authority_chunks c
        JOIN legal_authorities a ON a.id = c.authority_id
        JOIN legal_authority_versions v ON v.id = c.authority_version_id
        WHERE c.embedding IS NOT NULL AND a.ingestion_status = 'ready' AND v.valid_to IS NULL
        ORDER BY c.embedding <=> ${`[${embedding.join(",")}]`}::vector
        LIMIT ${limit}
      `)
    : [];
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.authority_id,
    content: row.content,
  }));
}

export const askGuideInputSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  situationId: z.string().uuid().optional().nullable(),
});

export type AskGuideInput = z.infer<typeof askGuideInputSchema> & {
  db: Database;
  userId: string;
  ai: AIProvider;
  embeddings: EmbeddingProvider;
};

export type AskGuideResult = {
  answer: string;
  conversationId: string;
  jurisdictionKnown: boolean;
  jurisdictionCaveat: string | null;
  highStakes: boolean;
  highStakesFlags: string[];
  disclaimer: string;
  sources: GuideSourceInput[];
  limitations: string[];
  userMessage: GuideMessage;
  assistantMessage: GuideMessage;
};

/** Maps the AI-facing source "class" onto the persisted GuideSourceRef provenance vocabulary. */
function toSourceRef(source: GuideSourceInput): GuideSourceRef {
  const provenance =
    source.class === "LEGAL_AUTHORITY"
      ? "legal_authority"
      : source.class === "GUIDE_DOCUMENT"
        ? "document_extracted"
        : source.class === "USER_PROVIDED"
          ? "user_provided"
          : "guide_explanation";
  return {
    provenance,
    authorityId: source.authorityId ?? undefined,
    authorityChunkId: source.authorityChunkId ?? undefined,
    documentId: source.documentId ?? undefined,
    chunkId: source.chunkId ?? undefined,
    quote: source.quote ?? null,
    note: source.citation ?? undefined,
  };
}

async function buildSituationContext(db: Database, situationId: string): Promise<string> {
  const events = await db
    .select()
    .from(guideSituationEvents)
    .where(eq(guideSituationEvents.situationId, situationId))
    .orderBy(desc(guideSituationEvents.eventDate))
    .limit(10);
  return events.map((e) => `- ${e.eventDate ?? "date unknown"}: ${e.title}`).join("\n");
}

export async function askGuide(params: AskGuideInput): Promise<AskGuideResult> {
  const input = askGuideInputSchema.parse(params);
  const { db, ai, embeddings, userId } = params;

  let conversation: GuideConversation | null = null;
  if (input.conversationId) {
    const [row] = await db
      .select()
      .from(guideConversations)
      .where(
        and(eq(guideConversations.id, input.conversationId), eq(guideConversations.userId, userId)),
      )
      .limit(1);
    if (!row) throw new Error("Guide conversation not found for this user");
    conversation = row;
  }

  const documentId = input.documentId ?? null;
  const situationId = input.situationId ?? null;
  if (documentId) await assertGuideDocumentOwnership(db, { documentId, userId });
  if (situationId) await assertGuideSituationOwnership(db, { situationId, userId });

  const jurisdiction = input.jurisdiction ?? conversation?.jurisdiction ?? null;
  const jurisdictionKnown = Boolean(jurisdiction);

  const situationContext = situationId ? await buildSituationContext(db, situationId) : null;
  const { highStakes, flags: highStakesFlags } = detectHighStakes(input.question, situationContext);

  const [legalAuthorityChunks, guideDocumentChunks] = await Promise.all([
    searchLegalAuthorityChunks(db, embeddings, input.question),
    documentId
      ? new GuideDocumentHybridRetriever(db, embeddings)
          .search(userId, input.question, { documentId })
          .then((hits) =>
            hits.map<GuideChunk>((hit) => ({
              chunkId: hit.chunkId,
              documentId: hit.documentId,
              content: hit.snippet,
              page: hit.pageStart,
              segmentRef: hit.segmentRef,
            })),
          )
      : Promise.resolve([]),
  ]);

  const generateResult = await ai.generate({
    messages: [
      { role: "system", content: buildGuideAnswerSystemPrompt() },
      {
        role: "user",
        content: buildGuideAnswerUserPrompt({
          question: input.question,
          jurisdictionCountry: jurisdiction,
          jurisdictionRegion: null,
          highStakesFlags,
          legalAuthorityChunks,
          guideDocumentChunks,
          situationContext,
        }),
      },
    ],
    schemaName: "guideAnswer",
  });

  const parsed = guideAnswerSchema.parse(JSON.parse(generateResult.text));

  const authorityContentByChunk = new Map(legalAuthorityChunks.map((c) => [c.chunkId, c.content]));
  const guideContentByChunk = new Map(guideDocumentChunks.map((c) => [c.chunkId, c.content]));

  const verifiedSources = parsed.sources.filter((source) => {
    if (source.class === "LEGAL_AUTHORITY") {
      if (!source.authorityChunkId || !source.quote) return false;
      const text = authorityContentByChunk.get(source.authorityChunkId);
      return text ? validateQuoteAgainstText(source.quote, text).valid : false;
    }
    if (source.class === "GUIDE_DOCUMENT") {
      if (!source.chunkId || !source.quote) return false;
      const text = guideContentByChunk.get(source.chunkId);
      return text ? validateQuoteAgainstText(source.quote, text).valid : false;
    }
    return true; // USER_PROVIDED / GENERAL_INFORMATION carry no verbatim-quote requirement
  });

  const hasAuthoritySource = verifiedSources.some((s) => s.class === "LEGAL_AUTHORITY");
  const guardrail = enforceIllegalityGuardrail(parsed.answer, hasAuthoritySource);

  // Deterministic override: never trust the model's self-reported jurisdictionKnown.
  const jurisdictionCaveat = jurisdictionKnown
    ? null
    : (parsed.jurisdictionCaveat ??
      "Jurisdiction was not provided; this answer does not assume any specific jurisdiction.");

  const limitations = [
    ...parsed.limitations,
    ...(guardrail.wasBlocked
      ? ["A statement about legality was removed because it lacked supporting legal authority."]
      : []),
  ];

  const disclaimer = buildContextualDisclaimer({ highStakes, jurisdictionKnown });

  let activeConversation = conversation;
  if (!activeConversation) {
    activeConversation = await createGuideConversation(db, userId, { jurisdiction });
  }
  const conversationId = activeConversation.id;

  const [userMessage] = await db
    .insert(guideMessages)
    .values({ conversationId, userId, role: "user", content: input.question })
    .returning();
  if (!userMessage) throw new Error("Failed to persist guide user message");

  const [assistantMessage] = await db
    .insert(guideMessages)
    .values({
      conversationId,
      userId,
      role: "assistant",
      content: guardrail.answer,
      sources: verifiedSources.map(toSourceRef),
      cautionLevel: highStakes ? "elevated" : "standard",
      provider: generateResult.provider,
      model: generateResult.model,
      promptVersion: GUIDE_ANSWER_PROMPT_VERSION,
    })
    .returning();
  if (!assistantMessage) throw new Error("Failed to persist guide assistant message");

  return {
    answer: guardrail.answer,
    conversationId,
    jurisdictionKnown,
    jurisdictionCaveat,
    highStakes,
    highStakesFlags,
    disclaimer,
    sources: verifiedSources,
    limitations,
    userMessage,
    assistantMessage,
  };
}
