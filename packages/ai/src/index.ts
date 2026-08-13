import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  DeadlineProposal,
  EntityProposal,
  MatterFactProposal,
  MatterIntelligenceExtraction,
  TimelineProposal,
} from "./intelligence";
import type {
  GraphRelationshipExtraction,
  GraphRelationshipProposal,
  MemoryProposal,
} from "./graph-memory";
import {
  mockContradictionCandidates,
  mockContractAnalysis,
  mockDepositionAnalysis,
  mockDiscoveryClassification,
  mockDraftGeneration,
  mockRedlineSuggestions,
} from "./professional";
import {
  mockAuthorityRelevanceExplanation,
  mockAuthoritySummary,
  mockContraryAuthoritySearch,
  mockLegalIssueExtraction,
  mockQueryDecomposition,
  mockQuoteCandidates,
  mockResearchMemo,
  mockResearchSynthesis,
} from "./research";
import { mockAgentPlan, mockIntentClassification } from "./agents";
import { mockCaseBrief, mockCaseComparison, mockProfessorAnswer } from "./professor";
import { mockConsultationPacket, mockGuideAnswer, mockGuideDocumentExplanation } from "./guide";
import { validateQuoteAgainstText } from "./quotes";

export const EMBEDDING_DIMENSIONS = 384;
export const NYAYA_PROMPT_VERSION = "nyaya-matter-qa-v2";

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
  evidenceState: z.enum(["grounded", "insufficient", "partial"]).default("insufficient"),
});

export type CitedAnswer = z.infer<typeof citedAnswerSchema>;

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiGenerateRequest = {
  messages: AiMessage[];
  schemaName?: string;
  temperature?: number;
  /** Providers that support cancellation (e.g. `OpenAIProvider`) should pass this to `fetch`. */
  signal?: AbortSignal;
};

export type AiGenerateResult = {
  provider: string;
  model: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export interface AIProvider {
  readonly name: string;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-embed-384";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => deterministicEmbedding(text, this.dimensions));
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly config: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
    },
  ) {
    this.model = config.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embeddings failed with status ${response.status}`);
    }
    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return data.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
  }
}

export function deterministicEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let i = 0; i < dimensions; i++) {
      const byte = digest[i % digest.length] ?? 0;
      vector[i]! += ((byte / 255) * 2 - 1) / Math.sqrt(tokens.length || 1);
    }
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const provider = process.env.EMBEDDING_PROVIDER ?? process.env.AI_PROVIDER ?? "mock";
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY");
    return new OpenAIEmbeddingProvider({ apiKey });
  }
  return new MockEmbeddingProvider();
}

export type GroundingPassage = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page?: number | null;
  segmentRef?: string | null;
  quote: string;
};

/** Deterministic grounded answer for tests/mock mode using retrieved passages only. */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const user = request.messages.find((m) => m.role === "user")?.content ?? "";

    if (
      /extract proposed matter intelligence/i.test(system) ||
      /Extract proposed timeline/i.test(user)
    ) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockExtractIntelligence(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/propose graph relationships/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockExtractRelationships(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/propose durable Matter Memory/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockProposeMemory(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/write a concise Matter Summary/i.test(system)) {
      const summary =
        "AI-generated matter summary based on verified structured intelligence only. Not attorney-authored.";
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify({ summary }),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate legal draft content/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockDraftGeneration(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/analyze contract documents/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockContractAnalysis(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/propose contract redline suggestions/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockRedlineSuggestions(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/analyze deposition transcripts/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockDepositionAnalysis(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/identify potential contradictions/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockContradictionCandidates(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/propose e-discovery review classifications/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockDiscoveryClassification(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/decompose legal research queries/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockQueryDecomposition(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/extract legal search concepts/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockLegalIssueExtraction(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/explain authority relevance/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockAuthorityRelevanceExplanation(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/summarize legal authority/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockAuthoritySummary(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/synthesize legal research answers/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockResearchSynthesis(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate contrary-authority search queries/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockContraryAuthoritySearch(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate quote candidates/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockQuoteCandidates(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate a legal research memo/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockResearchMemo(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/classify the user's request intent/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockIntentClassification(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/build an operational agent execution plan/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockAgentPlan(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate a student case brief/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockCaseBrief(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/compare two uploaded cases/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockCaseComparison(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/you are nyaya professor/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockProfessorAnswer(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/Nyaya Guide assistant/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockGuideAnswer(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/explain a legal document in plain language/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockGuideDocumentExplanation(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (/generate a consultation-preparation packet/i.test(system)) {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockConsultationPacket(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const passages = extractPassagesFromPrompt(user);
    const verifiedBlock = user
      .match(/VerifiedMatterIntelligence:([\s\S]*?)(?:\nSources:|$)/i)?.[1]
      ?.trim();
    const graphBlock = user
      .match(/VerifiedGraph:([\s\S]*?)(?:\nVerifiedMemory:|\nSources:|$)/i)?.[1]
      ?.trim();
    const memoryBlock = user.match(/VerifiedMemory:([\s\S]*?)(?:\nSources:|$)/i)?.[1]?.trim();
    const question = extractQuestionFromPrompt(user).toLowerCase();

    if (passages.length === 0 && !verifiedBlock && !graphBlock && !memoryBlock) {
      return jsonResult({
        answer:
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: [],
        unresolvedQuestions: [extractQuestionFromPrompt(user)],
        evidenceState: "insufficient",
      });
    }

    const matched = passages.filter((p) => {
      const tokens = question.split(/\W+/).filter((t) => t.length > 3);
      const hay = p.quote.toLowerCase();
      return tokens.some((token) => {
        if (hay.includes(token)) return true;
        const stem = token.slice(0, Math.min(6, token.length));
        return stem.length >= 4 && hay.includes(stem);
      });
    });
    const chosen = matched.length > 0 ? matched.slice(0, 3) : [];

    const usesVerified =
      Boolean(verifiedBlock) &&
      /(timeline|event|before|after|deadline|who|people|fact|verified)/i.test(question);
    const usesGraph =
      Boolean(graphBlock) &&
      /(connect|relationship|graph|related|linked|works for|attended|how is)/i.test(question);
    const usesMemory =
      Boolean(memoryBlock) &&
      /(remember|memory|decided|operative|caveat|instruction|preference|what have we)/i.test(
        question,
      );

    if (chosen.length === 0 && !usesVerified && !usesGraph && !usesMemory) {
      return jsonResult({
        answer:
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: [],
        unresolvedQuestions: [extractQuestionFromPrompt(user)],
        evidenceState: "insufficient",
      });
    }

    const parts: string[] = [];
    if (usesMemory && memoryBlock) {
      parts.push(`Based on approved Matter Memory: ${memoryBlock.slice(0, 400)}`);
    }
    if (usesGraph && graphBlock) {
      parts.push(`Based on verified Graph relationships: ${graphBlock.slice(0, 400)}`);
    }
    if (usesVerified && verifiedBlock) {
      parts.push(`Based on verified matter intelligence: ${verifiedBlock.slice(0, 400)}`);
    }
    if (chosen.length > 0) {
      const dateMatches = new Set<string>();
      for (const c of chosen) {
        for (const match of c.quote.matchAll(
          /\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/gi,
        )) {
          dateMatches.add(match[1]!);
        }
      }
      if (dateMatches.size >= 2) {
        parts.push(
          `The Case documents do not fully agree on the date. Conflicting dates appear in the sources (${[...dateMatches].join(" vs ")}).`,
        );
      }
      parts.push(
        `Based on the matter documents: ${chosen.map((c) => c.quote.slice(0, 220)).join(" ")}`,
      );
    }

    return jsonResult({
      answer: parts.join("\n\n"),
      sources: chosen.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentVersionId: c.documentVersionId,
        page: c.page ?? undefined,
        paragraph: c.segmentRef ?? undefined,
        quote: c.quote.slice(0, 400),
      })),
      assumptions: [
        ...(usesVerified ? ["Includes verified structured matter intelligence."] : []),
        ...(usesGraph ? ["Includes verified Graph relationships only."] : []),
        ...(usesMemory ? ["Includes approved Matter Memory only."] : []),
      ],
      unresolvedQuestions: [],
      evidenceState:
        chosen.length > 0 || usesVerified || usesGraph || usesMemory ? "grounded" : "insufficient",
    });
  }
}

function mockExtractIntelligence(userPrompt: string): MatterIntelligenceExtraction {
  const chunks = extractExtractionChunksFromPrompt(userPrompt);
  const timelineEvents: TimelineProposal[] = [];
  const facts: MatterFactProposal[] = [];
  const entities: EntityProposal[] = [];
  const deadlines: DeadlineProposal[] = [];

  for (const chunk of chunks) {
    const text = chunk.content;
    const lower = text.toLowerCase();
    const dateMatch =
      text.match(
        /\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/i,
      ) ?? text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const isoish = dateMatch?.[1] ? normalizeMockDate(dateMatch[1]) : null;

    if (/signed|executed|agreement/.test(lower)) {
      timelineEvents.push({
        title: "Agreement signed",
        description: text.slice(0, 240),
        eventType: "agreement_signed",
        eventDate: isoish,
        eventDateEnd: null,
        datePrecision: isoish ? "exact" : "unknown",
        actors: extractMockNames(text),
        sourceChunkIds: [chunk.chunkId],
        sourceQuotes: [text.slice(0, 280)],
        confidence: "high",
        uncertaintyNotes: null,
      });
      if (isoish) {
        facts.push({
          factKey: "agreement_date",
          label: "Agreement date",
          value: dateMatch?.[1] ?? isoish,
          normalizedValue: isoish,
          sourceChunkIds: [chunk.chunkId],
          sourceQuotes: [text.slice(0, 280)],
          confidence: "high",
          uncertaintyNotes: null,
        });
      }
    }

    if (/terminat/.test(lower)) {
      timelineEvents.push({
        title: "Termination notice provisions stated",
        description: text.slice(0, 240),
        eventType: "termination_communicated",
        eventDate: null,
        eventDateEnd: null,
        datePrecision: "unknown",
        actors: extractMockNames(text),
        sourceChunkIds: [chunk.chunkId],
        sourceQuotes: [text.slice(0, 280)],
        confidence: "medium",
        uncertaintyNotes: "Document describes termination terms; exact communication date unknown.",
      });
    }

    if (/payment is due|due on|response due|filing due|deadline|expires on|expire on/.test(lower)) {
      deadlines.push({
        title: /payment/i.test(text)
          ? "Payment due"
          : /expir/i.test(text)
            ? "Lease expires"
            : "Document-stated deadline",
        description: text.slice(0, 240),
        dueAt: isoish,
        dueAtEnd: null,
        datePrecision: isoish ? "exact" : "unknown",
        dateKind: isoish ? "explicit" : "inferred",
        timezone: null,
        sourceChunkIds: [chunk.chunkId],
        sourceQuotes: [text.slice(0, 280)],
        confidence: isoish ? "high" : "low",
        uncertaintyNotes: isoish ? null : "No explicit calendar date found in chunk.",
      });
    }

    for (const name of extractMockNames(text)) {
      entities.push({
        entityType: /corp|inc|llc|ltd|company|bank/i.test(name) ? "organization" : "person",
        displayName: name,
        aliases: [],
        roles: /party|parties/i.test(lower) ? ["party"] : [],
        description: null,
        sourceChunkIds: [chunk.chunkId],
        sourceQuotes: [text.slice(0, 280)],
        confidence: "medium",
      });
    }
  }

  return { timelineEvents, facts, entities, deadlines };
}

function normalizeMockDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function extractMockNames(text: string): string[] {
  const titleCase = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  const orgs =
    text.match(
      /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Corp|Inc|LLC|Ltd|Company|Bank)\.?)\b/g,
    ) ?? [];
  return [...new Set([...titleCase, ...orgs])].slice(0, 8);
}

function extractExtractionChunksFromPrompt(prompt: string): Array<{
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  content: string;
}> {
  const block = prompt.split(/Sources:\s*/i)[1] ?? prompt;
  const matches = [
    ...block.matchAll(
      /chunkId=([0-9a-f-]{36})[^\n]*?documentId=([0-9a-f-]{36})[^\n]*?documentVersionId=([0-9a-f-]{36})[^\n]*?text=\|([\s\S]*?)\|(?=\s*(?:- chunkId=|$))/gi,
    ),
  ];
  if (matches.length > 0) {
    return matches.map((m) => ({
      chunkId: m[1]!,
      documentId: m[2]!,
      documentVersionId: m[3]!,
      content: m[4]!.trim(),
    }));
  }
  return block
    .split(/\n?- chunkId=/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((part) => {
      const chunkId = part.match(/^([^\s|]+)/)?.[1] ?? "";
      const documentId = part.match(/documentId=([^\s|]+)/)?.[1] ?? "";
      const documentVersionId = part.match(/documentVersionId=([^\s|]+)/)?.[1] ?? "";
      const content = part.match(/text=\|([\s\S]*?)\|/)?.[1] ?? part;
      return { chunkId, documentId, documentVersionId, content: content.trim() };
    })
    .filter((c) => c.chunkId && c.documentId);
}

function mockExtractRelationships(userPrompt: string): GraphRelationshipExtraction {
  const nodes = [
    ...userPrompt.matchAll(/- ([^:]+):([0-9a-f-]{36}) \| type=(\w+) \| name=(.+)/gi),
  ].map((m) => ({
    canonicalEntityType: m[1]!.trim(),
    canonicalEntityId: m[2]!,
    nodeType: m[3]!,
    displayName: m[4]!.trim(),
  }));
  const chunks = extractExtractionChunksFromPrompt(userPrompt);
  const relationships: GraphRelationshipProposal[] = [];
  const person = nodes.find((n) => n.nodeType === "person");
  const org = nodes.find((n) => n.nodeType === "organization");
  const event = nodes.find((n) => n.nodeType === "event");
  const chunk = chunks[0];
  if (person && org && chunk) {
    relationships.push({
      fromCanonicalType: person.canonicalEntityType,
      fromCanonicalId: person.canonicalEntityId,
      toCanonicalType: org.canonicalEntityType,
      toCanonicalId: org.canonicalEntityId,
      relationshipType: "works_for",
      label: `${person.displayName} linked to ${org.displayName}`,
      confidence: "medium",
      sourceChunkIds: [chunk.chunkId],
      sourceQuotes: [chunk.content.slice(0, 280)],
      uncertaintyNotes: null,
    });
  }
  if (person && event && chunk) {
    relationships.push({
      fromCanonicalType: person.canonicalEntityType,
      fromCanonicalId: person.canonicalEntityId,
      toCanonicalType: event.canonicalEntityType,
      toCanonicalId: event.canonicalEntityId,
      relationshipType: "attended",
      label: `${person.displayName} connected to ${event.displayName}`,
      confidence: "medium",
      sourceChunkIds: [chunk.chunkId],
      sourceQuotes: [chunk.content.slice(0, 280)],
      uncertaintyNotes: null,
    });
  }
  return { relationships };
}

function mockProposeMemory(userPrompt: string): { proposals: MemoryProposal[] } {
  const hint = userPrompt.match(/Hint:\s*(.+)/i)?.[1]?.trim();
  const title = hint?.slice(0, 80) || "Operative matter context";
  const chunkId = userPrompt.match(
    /chunkId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1];
  return {
    proposals: [
      {
        memoryType: /operative|agreement|document/i.test(userPrompt)
          ? "document_significance"
          : "verified_context",
        title,
        content:
          hint ||
          "Counsel should treat the verified agreement context as operative for this matter until superseded.",
        importance: "normal",
        confidence: "medium",
        rationale: "Durable context useful for future Nyaya answers.",
        sourceChunkIds: chunkId ? [chunkId] : [],
      },
    ],
  };
}

function jsonResult(payload: CitedAnswer): AiGenerateResult {
  return {
    provider: "mock",
    model: "mock-1",
    text: JSON.stringify(payload),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function extractQuestionFromPrompt(prompt: string): string {
  const match = prompt.match(/Question:\s*([\s\S]*?)(?:\nSources:|$)/i);
  return match?.[1]?.trim() ?? prompt.trim();
}

function extractPassagesFromPrompt(prompt: string): GroundingPassage[] {
  const sourcesBlock = prompt.split(/Sources:\s*/i)[1] ?? "";
  const blocks = sourcesBlock
    .split(/\n?- chunkId=/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const chunkId = block.match(/^([^\s|]+)/)?.[1] ?? "";
      const documentId = block.match(/documentId=([^\s|]+)/)?.[1] ?? "";
      const documentVersionId = block.match(/documentVersionId=([^\s|]+)/)?.[1] ?? "";
      const pageRaw = block.match(/page=([^\s|]+)/)?.[1];
      const segmentRef = block.match(/segmentRef=([^\s|]+)/)?.[1];
      const quote = block.match(/quote=\|(.*)\|$/s)?.[1] ?? block;
      return {
        chunkId,
        documentId,
        documentVersionId,
        page: pageRaw && pageRaw !== "null" ? Number(pageRaw) : null,
        segmentRef: segmentRef && segmentRef !== "null" ? segmentRef : null,
        quote: quote.trim(),
      };
    })
    .filter((p) => p.chunkId && p.documentId);
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  constructor(
    private readonly config: {
      apiKey: string;
      model?: string;
      baseUrl?: string;
    },
  ) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const model = this.config.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0,
        response_format: { type: "json_object" },
      }),
      signal: request.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response missing content");
    return {
      provider: this.name,
      model,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    };
  }
}

const DEFAULT_AI_TIMEOUT_MS = 30_000;

export type ResilientAIProviderOptions = {
  /** Soft timeout per attempt (primary and, if used, fallback each get this budget). */
  timeoutMs?: number;
  /** Provider to retry with when the primary times out or throws. Its own `name` is reported on
   * the result, so callers can always see which provider actually answered. */
  fallback?: AIProvider;
};

async function generateWithTimeout(
  provider: AIProvider,
  request: AiGenerateRequest,
  timeoutMs: number,
): Promise<AiGenerateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () =>
      reject(new Error(`AI provider "${provider.name}" timed out after ${timeoutMs}ms`)),
    );
  });
  try {
    return await Promise.race([
      provider.generate({ ...request, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps an `AIProvider` with a soft timeout (via `AbortSignal`, when the provider honors it, plus
 * a `Promise.race` backstop for providers that don't) and an optional fallback provider. On
 * primary failure/timeout the fallback is tried once; whichever provider actually answered is
 * reflected in the returned `AiGenerateResult.provider`/`.model`, so callers never need to guess.
 */
export class ResilientAIProvider implements AIProvider {
  readonly name: string;

  constructor(
    private readonly primary: AIProvider,
    private readonly options: ResilientAIProviderOptions = {},
  ) {
    this.name = primary.name;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    try {
      return await generateWithTimeout(this.primary, request, timeoutMs);
    } catch (primaryError) {
      if (!this.options.fallback) throw primaryError;
      return generateWithTimeout(this.options.fallback, request, timeoutMs);
    }
  }
}

function envTimeoutMs(): number | undefined {
  const raw = process.env.AI_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function createFallbackProviderFromEnv(primaryProviderName: string): AIProvider | undefined {
  const fallbackName = process.env.AI_FALLBACK_PROVIDER;
  if (!fallbackName || fallbackName === primaryProviderName) return undefined;
  if (fallbackName === "mock") return new MockAIProvider();
  if (fallbackName === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return undefined;
    return new OpenAIProvider({
      apiKey,
      model: process.env.AI_FALLBACK_MODEL ?? process.env.OPENAI_MODEL,
    });
  }
  return undefined;
}

function createBaseAIProviderFromEnv(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY");
    return new OpenAIProvider({ apiKey, model: process.env.OPENAI_MODEL });
  }
  return new MockAIProvider();
}

/**
 * Builds the configured `AIProvider`, wrapped with a soft timeout and an optional
 * `AI_FALLBACK_PROVIDER` (`"mock"` or `"openai"`). Set `AI_TIMEOUT_MS` to override the default
 * 30s per-attempt budget.
 */
export function createAIProviderFromEnv(): AIProvider {
  const base = createBaseAIProviderFromEnv();
  const provider = process.env.AI_PROVIDER ?? "mock";
  const fallback = createFallbackProviderFromEnv(provider);
  return new ResilientAIProvider(base, { timeoutMs: envTimeoutMs(), fallback });
}

export function buildNyayaSystemPrompt(): string {
  return [
    "You are Nyaya, the matter-document assistant inside NyayaGrid.",
    "Answer ONLY using the provided Sources for the active matter.",
    "Never invent facts, dates, names, quotations, or citations.",
    "If sources are insufficient, set evidenceState to insufficient and say so clearly.",
    "If the question likely requires documents that are not among Sources, say so in unresolvedQuestions and ask which document to upload or select — do not guess.",
    "evidenceState MUST be exactly one of: grounded, insufficient, partial. Never use synonyms like sufficient.",
    "Return JSON only matching: {answer, sources, assumptions, unresolvedQuestions, evidenceState}.",
    "Each sources item must reference a provided chunkId/documentId/documentVersionId and include a quote copied from that source.",
  ].join(" ");
}

export function buildNyayaUserPrompt(
  question: string,
  passages: GroundingPassage[],
  verifiedIntelligence?: string | null,
  verifiedGraph?: string | null,
  verifiedMemory?: string | null,
  professionalAnalysis?: string | null,
): string {
  const sourceLines = passages.map(
    (p) =>
      `- chunkId=${p.chunkId} | documentId=${p.documentId} | documentVersionId=${p.documentVersionId} | page=${p.page ?? "null"} | segmentRef=${p.segmentRef ?? "null"} | quote=|${p.quote}|`,
  );
  const verified = verifiedIntelligence?.trim()
    ? `VerifiedMatterIntelligence:\n${verifiedIntelligence.trim()}\n\n`
    : "";
  const graph = verifiedGraph?.trim() ? `VerifiedGraph:\n${verifiedGraph.trim()}\n\n` : "";
  const memory = verifiedMemory?.trim() ? `VerifiedMemory:\n${verifiedMemory.trim()}\n\n` : "";
  const analysis = professionalAnalysis?.trim()
    ? `ProfessionalAnalysis:\n${professionalAnalysis.trim()}\n\n`
    : "";
  return `${verified}${graph}${memory}${analysis}Question: ${question}\nSources:\n${sourceLines.join("\n") || "(none)"}`;
}

export function buildNyayaSystemPromptWithIntelligence(): string {
  return [
    buildNyayaSystemPrompt(),
    "You may also use VerifiedMatterIntelligence, VerifiedGraph, VerifiedMemory, and ProfessionalAnalysis when provided.",
    "VerifiedMatterIntelligence / VerifiedGraph / VerifiedMemory contain human-approved structured facts only.",
    "ProfessionalAnalysis may include contract analyses, comparisons, deposition findings, and discovery review states.",
    "Never treat proposed/unapproved/superseded/rejected items as factual.",
    "If referencing PROPOSED/UNREVIEWED analytical findings, explicitly label them as unreviewed AI proposals.",
    "Human privilege designations are authoritative; AI privilege proposals are not final.",
    "External case-law research is not available. Do not invent legal authorities.",
    "Distinguish verified relationships from speculative ones. Cite document Sources when quoting documents.",
  ].join(" ");
}

export function buildNyayaSystemPromptWithResearch(): string {
  return [
    buildNyayaSystemPromptWithIntelligence(),
    "For legal research, use LegalAuthority passages as the sole basis for rules, holdings, and quotations.",
    "MatterSources and MatterContext may inform issue formulation and factual framing only; they are NOT legal authority.",
    "Authority treatment and currentness are unknown unless explicitly provided in LegalAuthority metadata.",
    "If research coverage is incomplete, state coverageWarnings clearly.",
    "Your training knowledge and external model memory are NOT legal sources; cite only provided LegalAuthority passages.",
    "Never fabricate authorities, citations, or quotes.",
  ].join(" ");
}

export function buildNyayaUserPromptWithResearch(
  question: string,
  passages: GroundingPassage[],
  legalAuthorityText: string,
  verifiedIntelligence?: string | null,
  verifiedGraph?: string | null,
  verifiedMemory?: string | null,
  professionalAnalysis?: string | null,
): string {
  const sourceLines = passages.map(
    (p) =>
      `- chunkId=${p.chunkId} | documentId=${p.documentId} | documentVersionId=${p.documentVersionId} | page=${p.page ?? "null"} | segmentRef=${p.segmentRef ?? "null"} | quote=|${p.quote}|`,
  );
  const verified = verifiedIntelligence?.trim()
    ? `VerifiedMatterIntelligence:\n${verifiedIntelligence.trim()}\n\n`
    : "";
  const graph = verifiedGraph?.trim() ? `VerifiedGraph:\n${verifiedGraph.trim()}\n\n` : "";
  const memory = verifiedMemory?.trim() ? `VerifiedMemory:\n${verifiedMemory.trim()}\n\n` : "";
  const analysis = professionalAnalysis?.trim()
    ? `ProfessionalAnalysis:\n${professionalAnalysis.trim()}\n\n`
    : "";
  const legal = legalAuthorityText.trim()
    ? `LegalAuthority:\n${legalAuthorityText.trim()}\n\n`
    : "";
  return `${verified}${graph}${memory}${analysis}${legal}Question: ${question}\nMatterSources:\n${sourceLines.join("\n") || "(none)"}`;
}

export * from "./intelligence";
export * from "./graph-memory";
export * from "./professional";
export * from "./research";
export * from "./agents";
export * from "./professor";
export * from "./guide";
export * from "./quotes";
export * from "./need-more-docs";
export {
  GOLDEN_MATTER_ID,
  GOLDEN_PASSAGES,
  buildGoldenFixtureDocuments,
  passagesByLabels,
  passageByChunkId,
  type GoldenFixtureDocument,
  type GoldenPassage,
} from "./evals/golden-matter";
export type {
  MatterIntelligenceExtraction,
  TimelineProposal,
  MatterFactProposal,
  EntityProposal,
  DeadlineProposal,
} from "./intelligence";
export type {
  GraphRelationshipExtraction,
  GraphRelationshipProposal,
  MemoryProposal,
} from "./graph-memory";
export type {
  DraftGeneration,
  DraftAssertion,
  ContractAnalysis,
  ContractAnalysisItem,
  RedlineSuggestions,
  RedlineSuggestionProposal,
  DepositionAnalysis,
  DepositionFinding,
  ContradictionCandidates,
  ContradictionCandidate,
  DiscoveryClassification,
} from "./professional";
export type {
  QueryDecomposition,
  LegalIssueExtraction,
  AuthorityRelevanceExplanation,
  AuthoritySummary,
  ResearchSynthesis,
  ContraryAuthoritySearch,
  QuoteCandidates,
  ResearchMemo,
  LegalProposition,
  ResearchAuthorityChunk,
} from "./research";
export type {
  AgentIntent,
  IntentClassification,
  AgentPlanStep,
  AgentPlan,
  ApprovalRequirement,
} from "./agents";
/** Live models sometimes return near-synonyms; map them before Zod rejects the payload. */
function normalizeCitedAnswerRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const state = typeof obj.evidenceState === "string" ? obj.evidenceState.toLowerCase().trim() : "";
  if (state === "sufficient" || state === "supported" || state === "complete" || state === "full") {
    obj.evidenceState = "grounded";
  } else if (
    state === "inadequate" ||
    state === "none" ||
    state === "missing" ||
    state === "unknown"
  ) {
    obj.evidenceState = "insufficient";
  } else if (state === "incomplete" || state === "weak") {
    obj.evidenceState = "partial";
  }
  return obj;
}

export function validateCitedAnswerAgainstPassages(
  raw: unknown,
  passages: GroundingPassage[],
): {
  answer: CitedAnswer;
  rejectedCitations: number;
} {
  const parsed = citedAnswerSchema.parse(normalizeCitedAnswerRaw(raw));
  const byChunk = new Map(passages.map((p) => [p.chunkId, p]));
  const allowedDocs = new Set(passages.map((p) => `${p.documentId}:${p.documentVersionId}`));
  let rejectedCitations = 0;
  const sources = parsed.sources.filter((source) => {
    let passage: GroundingPassage | undefined;
    if (source.chunkId && byChunk.has(source.chunkId)) {
      passage = byChunk.get(source.chunkId);
    } else if (allowedDocs.has(`${source.documentId}:${source.documentVersionId}`)) {
      const match = passages.find(
        (p) =>
          p.documentId === source.documentId &&
          p.documentVersionId === source.documentVersionId &&
          p.quote.includes(source.quote.slice(0, 40)),
      );
      if (match) {
        source.chunkId = match.chunkId;
        passage = match;
      }
    }
    if (!passage) {
      rejectedCitations += 1;
      return false;
    }
    const quoteCheck = validateQuoteAgainstText(source.quote, passage.quote);
    if (!quoteCheck.valid) {
      rejectedCitations += 1;
      return false;
    }
    if (quoteCheck.normalizedQuote) {
      source.quote = quoteCheck.normalizedQuote;
    }
    return true;
  });

  if (passages.length === 0 || sources.length === 0) {
    return {
      answer: {
        answer:
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: parsed.assumptions,
        unresolvedQuestions:
          parsed.unresolvedQuestions.length > 0
            ? parsed.unresolvedQuestions
            : ["Insufficient evidence in retrieved matter sources."],
        evidenceState: "insufficient",
      },
      rejectedCitations,
    };
  }

  return {
    answer: {
      ...parsed,
      sources,
      evidenceState: parsed.evidenceState === "insufficient" ? "partial" : "grounded",
    },
    rejectedCitations,
  };
}
