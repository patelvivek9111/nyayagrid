import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchOpenAIWithRetry } from "./openai-http";
import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiMessage,
  AIProvider,
  EmbeddingProvider,
  ProviderId,
} from "./provider-contract";
import { AnthropicProvider } from "./router/providers/anthropic";
import { GoogleProvider } from "./router/providers/google";
import { XaiProvider } from "./router/providers/xai";
import { NyayaRouter } from "./router/router";
import { resolvePinnedModelId } from "./router/registry";
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
import {
  NYAYA_EVIDENCE_BOUND_RULES,
  NYAYA_EVIDENCE_BOUND_WORKED_EXAMPLE,
  NYAYA_FUTURE_EFFECTIVE_WORKED_EXAMPLE,
  NYAYA_PREMISE_CHALLENGE_WORKED_EXAMPLE,
  NYAYA_QUALIFIER_PRESERVE_WORKED_EXAMPLE,
  NYAYA_SILENCE_NOT_PROOF_WORKED_EXAMPLE,
  NYAYA_SOURCE_ROLE_WORKED_EXAMPLE,
  formatSourceQualifierBlock,
} from "./evidence-bound";
import {
  assessRetrievedEvidenceDeterministic,
  parseEvidenceAssessmentFromPrompt,
} from "./evidence-assessment";

export const EMBEDDING_DIMENSIONS = 384;
export const NYAYA_PROMPT_VERSION = "nyaya-matter-qa-v11";
/** Marker the conservatism probe uses to detect the decoy-adjacent worked example. */
export const NYAYA_WORKED_EXAMPLE_MARKER = "Worked example (SYNTH, not a real lease)";
/** Marker for Option B: refuse a false-premise number without echoing it. */
export const NYAYA_FALSE_PREMISE_EXAMPLE_MARKER = "Worked example (SYNTH false premise)";
/** Marker for amendment-present conservatism (indemnity-with-amendment). */
export const NYAYA_AMENDMENT_EXAMPLE_MARKER = "Worked example (SYNTH amendment grounded)";
/** Marker for the QA-05 contrast: amendment present does not imply grounded. */
export const NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER = "Worked example (SYNTH amendment hedge)";

export const NYAYA_DECOY_WORKED_EXAMPLE = `${NYAYA_WORKED_EXAMPLE_MARKER}: Question: What is the monthly base rent under the lease? Source chunk_lease_rent: Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000). Source chunk_late_fee: a delinquency charge of five hundred dollars ($500) if payment is overdue. Correct output: evidenceState=grounded, answer the $4,000 Base Rent, cite chunk_lease_rent only. Do not set insufficient because chunk_late_fee is also present. chunk_late_fee does not answer this question.`;

export const NYAYA_AMENDMENT_GROUNDED_WORKED_EXAMPLE = `${NYAYA_AMENDMENT_EXAMPLE_MARKER}: (a) Question: How does the amendment change the indemnity obligation? Source chunk_amend_indemnity: Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence. Source chunk_lease_term: The lease term commences on January 1, 2024. Correct output: evidenceState=grounded, answer from the amendment (Tenant's negligence), cite chunk_amend_indemnity only. Do not set insufficient because a base-lease excerpt is also present. When an original and an amendment both appear, use the amendment's version of the obligation.`;

export const NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE = `${NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER}: (b) Question: Is the indemnity obligation fully settled in these excerpts, or is this only a partial picture? Source chunk_amend_indemnity: Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence. Correct output: evidenceState=partial, cite chunk_amend_indemnity, answer that this is only a partial picture — the excerpt states Tenant's negligence scope but does not complete every indemnity term. Do not set grounded merely because an amendment chunk is present.`;

export const NYAYA_AMENDMENT_WORKED_EXAMPLE = `${NYAYA_AMENDMENT_GROUNDED_WORKED_EXAMPLE} ${NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE}`;

export const NYAYA_FALSE_PREMISE_WORKED_EXAMPLE = `${NYAYA_FALSE_PREMISE_EXAMPLE_MARKER}: Question: Is the monthly CAM charge nine thousand dollars? Source chunk_lease_term: The lease term commences on January 1, 2024 and expires on December 31, 2026. Correct output: evidenceState=insufficient, say that Sources do not contain enough information to confirm the CAM charge. Do not restate nine thousand or $9,000 in either polarity (do not say it is that amount, and do not say it is not). Do not set partial.`;

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

export type {
  AiGenerateRequest,
  AiGenerateResult,
  AiMessage,
  AIProvider,
  EmbeddingProvider,
  EstimatedCost,
  ExecutionStrategy,
  ProviderId,
  RiskLevel,
  RiskSignal,
  RouterRequestContext,
  RouterSubsystem,
  RoutingMode,
  TokenUsage,
  CertificationSubsystem,
} from "./provider-contract";
export { CERTIFICATION_SUBSYSTEMS } from "./provider-contract";

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
    const response = await fetchOpenAIWithRetry(`${baseUrl}/embeddings`, {
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

    if (request.schemaName === "evidence_assessment") {
      const passages = extractPassagesFromPrompt(user);
      const question = extractQuestionFromPrompt(user);
      const assessment = assessRetrievedEvidenceDeterministic(question, passages) ?? {
        proposition: question,
        status: "insufficient" as const,
        premiseStatus: "not_applicable" as const,
        dateSensitive: false,
        relevantDate: null,
        operativeTerm: null,
        allowedClaim: "Retrieved sources do not establish the asked proposition.",
        prohibitedOverclaims: [],
        limitations: [],
        evidence: [],
      };
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(assessment),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (request.schemaName === "student_case_brief") {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockCaseBrief(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.schemaName === "professor_answer") {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockProfessorAnswer(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    if (request.schemaName === "student_case_comparison") {
      return {
        provider: "mock",
        model: "mock-1",
        text: JSON.stringify(mockCaseComparison(user)),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

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

    const boundAssessment = parseEvidenceAssessmentFromPrompt(user);
    if (boundAssessment) {
      const passages = extractPassagesFromPrompt(user);
      const cited = boundAssessment.evidence
        .map((item) => passages.find((p) => p.chunkId === item.chunkId))
        .filter((p): p is GroundingPassage => Boolean(p))
        .slice(0, 3);
      const abstain =
        boundAssessment.status === "not_established" ||
        boundAssessment.status === "insufficient";
      const fallback =
        cited.length > 0 ? cited : abstain ? [] : passages.slice(0, 1);
      const evidenceState =
        boundAssessment.status === "established" || boundAssessment.status === "supported"
          ? "grounded"
          : abstain && /\bnot established\b/i.test(boundAssessment.allowedClaim)
            ? "insufficient"
            : "partial";
      return jsonResult({
        answer: [boundAssessment.allowedClaim, ...boundAssessment.limitations]
          .filter(Boolean)
          .join(" "),
        sources: fallback.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentVersionId: c.documentVersionId,
          page: c.page ?? undefined,
          paragraph: c.segmentRef ?? undefined,
          quote: c.quote.slice(0, 400),
        })),
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState,
      });
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

    const citeChosen = (answer: string, evidenceState: CitedAnswer["evidenceState"]) =>
      jsonResult({
        answer,
        sources: chosen.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentVersionId: c.documentVersionId,
          page: c.page ?? undefined,
          paragraph: c.segmentRef ?? undefined,
          quote: c.quote.slice(0, 400),
        })),
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState,
      });

    const chosenText = chosen.map((c) => c.quote).join("\n");
    if (
      /does not independently prove/i.test(chosenText) &&
      /physically enter|personally enter/i.test(question)
    ) {
      return citeChosen(
        `The source records activity, but it does not independently prove the stronger personal-entry claim. ${chosen.map((c) => c.quote.slice(0, 240)).join(" ")}`,
        "partial",
      );
    }
    if (
      /explain why|why did (the )?part(y|ies)/i.test(question) &&
      /becomes effective/i.test(chosenText) &&
      !/\bretroactive\b/i.test(chosenText)
    ) {
      return citeChosen(
        `The supplied documents do not support that premise. ${chosen.map((c) => c.quote.slice(0, 240)).join(" ")} The documents do not provide a basis for explaining a supposed retroactive agreement.`,
        "partial",
      );
    }
    if (
      /ever (issue|pay)|actually (issue|pay)/i.test(question) &&
      /this invoice|reflected on this invoice/i.test(chosenText)
    ) {
      return citeChosen(
        `${chosen.map((c) => c.quote.slice(0, 240)).join(" ")} Absence of that item from this invoice does not prove it was never issued.`,
        "partial",
      );
    }
    if (
      /currently require/i.test(question) &&
      /becomes effective/i.test(chosenText) &&
      /sixty \(60\)|60 days/i.test(chosenText)
    ) {
      return citeChosen(
        `The currently operative notice remains sixty (60) days because the later signed amendment is not yet effective. ${chosen.map((c) => c.quote.slice(0, 200)).join(" ")}`,
        "grounded",
      );
    }
    if (
      /currently operative/i.test(question) &&
      /effective immediately/i.test(chosenText) &&
      /thirty \(30\)/i.test(chosenText)
    ) {
      const controlling = chosen.find((c) => /thirty \(30\)/i.test(c.quote)) ?? chosen[0]!;
      return jsonResult({
        answer:
          "The currently operative notice period is thirty (30) days because the signed amendment is effective immediately and replaces the original sixty-day term.",
        sources: [
          {
            chunkId: controlling.chunkId,
            documentId: controlling.documentId,
            documentVersionId: controlling.documentVersionId,
            page: controlling.page ?? undefined,
            paragraph: controlling.segmentRef ?? undefined,
            quote: controlling.quote.slice(0, 400),
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      });
    }
    if (
      /notice period does the signed agreement require/i.test(question) &&
      /i think/i.test(chosenText) &&
      /thirty \(30\)/i.test(chosenText)
    ) {
      const controlling = chosen.find((c) => /thirty \(30\)/i.test(c.quote)) ?? chosen[0]!;
      return jsonResult({
        answer:
          "The signed agreement requires thirty (30) days' written notice. The email is informal recollection, not the controlling term.",
        sources: [
          {
            chunkId: controlling.chunkId,
            documentId: controlling.documentId,
            documentVersionId: controlling.documentVersionId,
            page: controlling.page ?? undefined,
            paragraph: controlling.segmentRef ?? undefined,
            quote: controlling.quote.slice(0, 400),
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      });
    }

    const hedge =
      /what remains uncertain|only a partial picture|is (the|this) (record|evidence) complete|not fully settled/i.test(
        question,
      );
    if (hedge && chosen.length > 0) {
      return jsonResult({
        answer: `Based on the matter documents: ${chosen.map((c) => c.quote.slice(0, 220)).join(" ")} The record is not fully settled.`,
        sources: chosen.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentVersionId: c.documentVersionId,
          page: c.page ?? undefined,
          paragraph: c.segmentRef ?? undefined,
          quote: c.quote.slice(0, 400),
        })),
        assumptions: [],
        unresolvedQuestions: ["What remains uncertain given incomplete coverage?"],
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
      const quote = block.match(/quote=\|(.*?)\|/s)?.[1] ?? block;
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

export function buildOpenAIChatCompletionsBody(params: {
  model: string;
  messages: AiGenerateRequest["messages"];
  temperature?: number;
}) {
  return {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0,
    response_format: { type: "json_object" as const },
    /** Do not persist customer prompts in OpenAI storage / training pipelines. */
    store: false,
  };
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
    const started = Date.now();
    const model = this.config.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com/v1";
    const response = await fetchOpenAIWithRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOpenAIChatCompletionsBody({
          model,
          messages: request.messages,
          temperature: request.temperature,
        }),
      ),
      signal: request.signal,
    });
    const data = (await response.json()) as {
      model?: string;
      system_fingerprint?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response missing content");
    const resolvedModel = data.model?.trim() || model;
    return {
      provider: this.name,
      model: resolvedModel,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
      systemFingerprint: data.system_fingerprint?.trim() || undefined,
      finishReason: data.choices?.[0]?.finish_reason,
      latencyMs: Date.now() - started,
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

function googleApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_API_KEY?.trim() ||
    undefined
  );
}

export function createDirectProvider(params: {
  provider: Extract<ProviderId, "openai" | "anthropic" | "xai" | "google">;
  env?: NodeJS.ProcessEnv;
}): { provider: AIProvider; modelId: string } {
  const env = params.env ?? process.env;
  const modelId = resolvePinnedModelId(params.provider, env);
  if (params.provider === "openai") {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing");
    return { provider: new OpenAIProvider({ apiKey, model: modelId }), modelId };
  }
  if (params.provider === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");
    return { provider: new AnthropicProvider({ apiKey, model: modelId }), modelId };
  }
  if (params.provider === "xai") {
    const apiKey = env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is missing");
    return { provider: new XaiProvider({ apiKey, model: modelId }), modelId };
  }
  const apiKey = googleApiKey(env);
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY / GOOGLE_API_KEY) is missing",
    );
  }
  return { provider: new GoogleProvider({ apiKey, model: modelId }), modelId };
}

function createNyayaProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<ProviderId, AIProvider>> {
  const providers: Partial<Record<ProviderId, AIProvider>> = {
    mock: new MockAIProvider(),
  };
  if (env.OPENAI_API_KEY) {
    providers.openai = new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.anthropic = new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: resolvePinnedModelId("anthropic", env),
    });
  }
  if (env.XAI_API_KEY) {
    providers.xai = new XaiProvider({
      apiKey: env.XAI_API_KEY,
      model: resolvePinnedModelId("xai", env),
    });
  }
  const geminiKey = googleApiKey(env);
  if (geminiKey) {
    providers.google = new GoogleProvider({
      apiKey: geminiKey,
      model: resolvePinnedModelId("google", env),
    });
  }
  return providers;
}

/**
 * Builds Nyaya Router over configured adapters. `AI_PROVIDER` selects the preferred
 * validated route (`mock` or `openai` today). Other adapters are available but Auto
 * will not use uncertified models. Set `AI_TIMEOUT_MS` to override the 30s per-attempt budget.
 */
export function createAIProviderFromEnv(): AIProvider {
  const env = process.env;
  const envProvider = env.AI_PROVIDER ?? "mock";
  if (envProvider === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY");
  }
  if (envProvider === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }
  if (envProvider === "xai" && !env.XAI_API_KEY) {
    throw new Error("AI_PROVIDER=xai requires XAI_API_KEY");
  }
  if (envProvider === "google" && !googleApiKey(env)) {
    throw new Error(
      "AI_PROVIDER=google requires GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY / GOOGLE_API_KEY)",
    );
  }
  return new NyayaRouter({
    providers: createNyayaProvidersFromEnv(env),
    envProvider,
    env,
    timeoutMs: envTimeoutMs(),
  });
}

export function buildNyayaSystemPrompt(): string {
  return [
    "You are Nyaya, the matter-document assistant inside NyayaGrid.",
    "Answer ONLY using the provided Sources for the active matter.",
    "Never invent facts, dates, names, quotations, citations, or legal rules from training knowledge.",
    "When evidenceState is grounded or partial, write the answer field as a complete attorney-facing response, not a one-line factoid. Use short paragraphs covering: (1) the direct answer, (2) how the cited Sources support it, (3) what remains uncertain, and (4) a suggested next question or document only if it follows from a gap in the Sources. Do not pad with general knowledge.",
    "When evidenceState is insufficient, keep the refusal clear and short. Do not write an essay, and do not fill the gap with outside law.",
    "If one Source answers the question, cite that Source even when other Sources contain similar but non-matching dates, amounts, or clauses. Do not refuse solely because a near-miss decoy is also retrieved.",
    NYAYA_DECOY_WORKED_EXAMPLE,
    NYAYA_AMENDMENT_WORKED_EXAMPLE,
    "If the question asks two distinct facts and two Sources each answer one of them, cite both and answer both. Do not set insufficient because the answer spans two Sources.",
    "Sources are listed in descending relevance to the question. Prefer an earlier Source that answers the question over a later near-miss.",
    "If sources are insufficient, set evidenceState to insufficient and say so clearly.",
    NYAYA_FALSE_PREMISE_WORKED_EXAMPLE,
    NYAYA_EVIDENCE_BOUND_RULES,
    NYAYA_EVIDENCE_BOUND_WORKED_EXAMPLE,
    NYAYA_PREMISE_CHALLENGE_WORKED_EXAMPLE,
    NYAYA_SILENCE_NOT_PROOF_WORKED_EXAMPLE,
    NYAYA_SOURCE_ROLE_WORKED_EXAMPLE,
    NYAYA_FUTURE_EFFECTIVE_WORKED_EXAMPLE,
    NYAYA_QUALIFIER_PRESERVE_WORKED_EXAMPLE,
    "If the question likely requires documents that are not among Sources, say so in unresolvedQuestions and ask which document to upload or select — do not guess.",
    "evidenceState MUST be exactly one of: grounded, insufficient, partial. Never use synonyms like sufficient.",
    "If the question asks whether the record is fully settled or only a partial picture, and Sources cite what exists but do not complete the obligation or term, use evidenceState=partial — not grounded and not insufficient.",
    "When an EvidenceAssessment block is present, treat it as binding: stay within allowedClaim; never assert prohibitedOverclaims; if premiseStatus is unsupported or contradicted, correct the premise and do not invent motives; if operativeTerm is set, state that value explicitly for the asked date, including a future date after an amendment's effective date; never replace a requested number, date, or amount with a generic statement that a signed instrument controls; if status is established or supported, answer and do not refuse; if status is not_established or insufficient, do not assert a positive determination. Keep straightforward established answers concise and do not add epistemic commentary.",
    "answer MUST be a single string (never an object or null).",
    "assumptions and unresolvedQuestions MUST be arrays of strings (never a bare string).",
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
  evidenceAssessment?: string | null,
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
  const qualifiers = formatSourceQualifierBlock(passages);
  const qualifierBlock = qualifiers ? `\n${qualifiers}` : "";
  const assessmentBlock = evidenceAssessment?.trim() ? `\n\n${evidenceAssessment.trim()}` : "";
  return `${verified}${graph}${memory}${analysis}Question: ${question}\nSources:\n${sourceLines.join("\n") || "(none)"}${qualifierBlock}${assessmentBlock}`;
}

export function buildNyayaSystemPromptWithIntelligence(): string {
  return [
    buildNyayaSystemPrompt(),
    "You may also use VerifiedMatterIntelligence, VerifiedGraph, VerifiedMemory, and ProfessionalAnalysis when provided.",
    "If those verified blocks answer the question and document Sources are empty, you MUST still answer from the verified blocks with evidenceState partial — never insufficient solely because no document quote exists.",
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
    "User instructions and assumptions are not Case evidence and do not change recorded coverage status.",
    "When a LegalAuthority passage directly answers the asked legal rule, state that supported rule in the answer, including any numeric period, threshold, or element that appears in the passage. Do not describe the source only in the abstract. If no provided passage supports the rule, do not invent it.",
    "If LegalAuthority passages are provided, do not refuse solely because MatterSources are empty or do not answer the legal question.",
    "If the question names an exhibit, schedule, or document that is not among MatterSources, state that it is not available in the Case materials currently accessible. Distinguish what can be concluded from available sources versus what cannot be concluded without it. Do not invent its contents.",
    "If coverage is UNVALIDATED, clearly say NyayaGrid does not have validated primary-law coverage sufficient to provide the requested state-law rule.",
    "When governing law differs from forum and the question depends on substantive state law, name Forum and Governing law in the answer. Related jurisdictions are not governing law.",
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
  evidenceAssessment?: string | null,
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
  const qualifiers = formatSourceQualifierBlock(passages);
  const qualifierBlock = qualifiers ? `\n${qualifiers}` : "";
  const assessmentBlock = evidenceAssessment?.trim() ? `\n\n${evidenceAssessment.trim()}` : "";
  return `Question: ${question}\n${legal}MatterSources:\n${sourceLines.join("\n") || "(none)"}${qualifierBlock}${assessmentBlock}\n\n${verified}${graph}${memory}${analysis}`.trim();
}

export * from "./intelligence";
export * from "./timeline-date-precision";
export * from "./graph-memory";
export * from "./professional";
export * from "./research";
export * from "./agents";
export * from "./professor";
export * from "./guide";
export * from "./quotes";
export * from "./need-more-docs";
export * from "./qa06";
export * from "./imprecise-date";
export * from "./contradiction-semantics";
export * from "./retrieval-rank";
export * from "./contract-compare-intent";
export * from "./evidence-bound";
export * from "./evidence-assessment";
export {
  NyayaRouter,
  AnthropicProvider,
  XaiProvider,
  GoogleProvider,
  FakeProvider,
  ProviderError,
  RouterUnavailableError,
  RouterPolicyError,
  ROUTER_UNAVAILABLE_USER_MESSAGE,
  classifyTask,
  classifyRisk,
  selectStrategy,
  analyzeDisagreement,
  buildDefaultModelRegistry,
  listValidatedRoutingOptions,
  isCertificationSubsystem,
  PINNED_MODEL_IDS,
  MODEL_REGISTRY_VERSION,
  STRATEGY_LABELS,
  decideCertification,
  pickPreferredAuto,
  rankFallbackOrder,
  blockedExternalMeasurement,
  providerApiKeyPresent,
  parseJsonObject,
} from "./router";
export type { DirectProviderId, SubsystemMeasurement } from "./router";
export type { RoutingOptions, RoutingOptionModel } from "./router";
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

function isPresentSourceId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function quoteOverlap(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  const needle = a.slice(0, Math.min(40, a.length));
  return b.includes(needle) || a.includes(b.slice(0, Math.min(40, b.length)));
}

function findPassageForCite(
  item: { chunkId?: string; documentId?: string; documentVersionId?: string; quote?: string },
  passages: GroundingPassage[],
): GroundingPassage | undefined {
  if (item.chunkId) {
    const byChunk = passages.find((p) => p.chunkId === item.chunkId);
    if (byChunk) return byChunk;
  }
  if (item.quote) {
    const byQuote = passages.find((p) => quoteOverlap(item.quote!, p.quote));
    if (byQuote) return byQuote;
  }
  if (item.documentId) {
    return passages.find(
      (p) =>
        p.documentId === item.documentId &&
        (!item.documentVersionId || p.documentVersionId === item.documentVersionId),
    );
  }
  return undefined;
}

/**
 * Canonical Case Q&A source shape: `{ chunkId?, documentId, documentVersionId, page?, paragraph?, quote }`.
 * Live models sometimes emit a string, omit ids, or wrap a single object instead of an array.
 */
export function coerceCitedSource(
  item: unknown,
  passages: GroundingPassage[] = [],
): Record<string, unknown> | null {
  if (typeof item === "string") {
    const text = item.trim();
    if (!text) return null;
    const passage =
      passages.find((p) => p.chunkId === text) ??
      passages.find((p) => p.documentId === text) ??
      passages.find((p) => quoteOverlap(text, p.quote));
    if (!passage) return null;
    return {
      chunkId: passage.chunkId,
      documentId: passage.documentId,
      documentVersionId: passage.documentVersionId,
      page: passage.page ?? undefined,
      paragraph: passage.segmentRef ?? undefined,
      quote: quoteOverlap(text, passage.quote) && text.length > 12 ? text : passage.quote,
    };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const source = { ...(item as Record<string, unknown>) };
  const chunkId = isPresentSourceId(source.chunkId) ? String(source.chunkId) : "";
  const quote = typeof source.quote === "string" ? source.quote : "";
  const documentId = isPresentSourceId(source.documentId) ? String(source.documentId) : "";
  const documentVersionId = isPresentSourceId(source.documentVersionId)
    ? String(source.documentVersionId)
    : "";
  const passage = findPassageForCite({ chunkId, documentId, documentVersionId, quote }, passages);
  if (passage) {
    if (!chunkId) source.chunkId = passage.chunkId;
    if (!isPresentSourceId(source.documentId)) source.documentId = passage.documentId;
    if (!isPresentSourceId(source.documentVersionId)) {
      source.documentVersionId = passage.documentVersionId;
    }
    if (typeof source.quote !== "string" || !source.quote.trim()) source.quote = passage.quote;
    return source;
  }
  if (
    isPresentSourceId(source.documentId) &&
    isPresentSourceId(source.documentVersionId) &&
    quote
  ) {
    return source;
  }
  return null;
}

export function normalizeCitedSources(
  sources: unknown,
  passages: GroundingPassage[] = [],
): unknown[] {
  const list = Array.isArray(sources)
    ? sources
    : typeof sources === "string" && sources.trim()
      ? [sources]
      : sources && typeof sources === "object"
        ? [sources]
        : [];
  return list
    .map((item) => coerceCitedSource(item, passages))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

/** Live models sometimes return near-synonyms; map them before Zod rejects the payload. */
export function normalizeCitedAnswerRaw(raw: unknown, passages?: GroundingPassage[]): unknown {
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
  if (typeof obj.answer !== "string") {
    obj.answer = flattenCitedAnswerText(obj.answer);
  }
  if (
    typeof obj.evidenceState !== "string" ||
    !["grounded", "partial", "insufficient"].includes(obj.evidenceState)
  ) {
    obj.evidenceState = "insufficient";
  }
  obj.assumptions = asStringList(obj.assumptions);
  obj.unresolvedQuestions = asStringList(obj.unresolvedQuestions);
  obj.sources = normalizeCitedSources(obj.sources, passages ?? []);
  return obj;
}

export function citedAnswerTextFromRaw(raw: unknown): string {
  const normalized = normalizeCitedAnswerRaw(raw);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return "";
  const answer = (normalized as { answer?: unknown }).answer;
  return typeof answer === "string" ? answer : "";
}

function flattenCitedAnswerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenCitedAnswerText(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => flattenCitedAnswerText(item))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

export function validateCitedAnswerAgainstPassages(
  raw: unknown,
  passages: GroundingPassage[],
): {
  answer: CitedAnswer;
  rejectedCitations: number;
} {
  const parsedResult = citedAnswerSchema.safeParse(normalizeCitedAnswerRaw(raw, passages));
  if (!parsedResult.success) {
    return {
      answer: {
        answer:
          citedAnswerTextFromRaw(raw) ||
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: ["The model returned a citation payload that could not be normalized."],
        unresolvedQuestions: ["Insufficient evidence in retrieved matter sources."],
        evidenceState: "insufficient",
      },
      rejectedCitations: 0,
    };
  }
  const parsed = parsedResult.data;
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
      evidenceState:
        parsed.evidenceState === "insufficient" || parsed.evidenceState === "partial"
          ? "partial"
          : "grounded",
    },
    rejectedCitations,
  };
}
