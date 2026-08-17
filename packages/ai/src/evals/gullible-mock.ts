/**
 * Deliberately bait-taking mock for eval stress mode.
 *
 * Inverse of MockAIProvider: when several retrieved passages are present, it
 * prefers the one with the *least* question overlap (the decoy / forbidden
 * chunk we appended). It also answers grounded on should-refuse prompts and
 * emits contradiction candidates for one-sided / paraphrase pairs.
 *
 * Not a general adversarial model — just enough to prove decoy scoring fires
 * when a model actually takes the bait.
 */
import type { AIProvider, AiGenerateRequest, AiGenerateResult, GroundingPassage } from "../index";
import { extractProfessionalChunksFromPrompt } from "../professional";

export const GULLIBLE_MOCK_NAME = "gullible-mock";

function jsonResult(payload: unknown): AiGenerateResult {
  return {
    provider: GULLIBLE_MOCK_NAME,
    model: "gullible-1",
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

export function tokenOverlap(question: string, quote: string): number {
  const tokens = question.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const hay = quote.toLowerCase();
  return tokens.filter((token) => {
    if (hay.includes(token)) return true;
    const stem = token.slice(0, Math.min(6, token.length));
    return stem.length >= 4 && hay.includes(stem);
  }).length;
}

/** Prefer the least-overlapping (later) passage — the planted decoy. */
export function pickBaitPassages(question: string, passages: GroundingPassage[]): GroundingPassage[] {
  if (passages.length === 0) return [];
  if (passages.length === 1) return passages;
  const scored = passages.map((p, index) => ({
    p,
    index,
    overlap: tokenOverlap(question, p.quote),
  }));
  const min = Math.min(...scored.map((s) => s.overlap));
  const bait = scored.filter((s) => s.overlap === min);
  bait.sort((a, b) => b.index - a.index);
  return [bait[0]!.p];
}

function gullibleCitedAnswer(user: string): AiGenerateResult {
  const passages = extractPassagesFromPrompt(user);
  const question = extractQuestionFromPrompt(user);
  const chosen = pickBaitPassages(question, passages);

  if (chosen.length === 0) {
    return jsonResult({
      answer: "The lease definitely commenced on July 4, 2020, which fully answers this question.",
      sources: [],
      assumptions: [],
      unresolvedQuestions: [],
      evidenceState: "grounded",
    });
  }

  const bait = chosen[0]!;
  return jsonResult({
    answer: `Based on the matter documents, this is a complete answer: ${bait.quote}`,
    sources: [
      {
        chunkId: bait.chunkId,
        documentId: bait.documentId,
        documentVersionId: bait.documentVersionId,
        page: bait.page ?? undefined,
        paragraph: bait.segmentRef ?? undefined,
        quote: bait.quote,
      },
    ],
    assumptions: [],
    unresolvedQuestions: [],
    evidenceState: "grounded",
  });
}

function gullibleContradiction(user: string): AiGenerateResult {
  const chunks = extractProfessionalChunksFromPrompt(user);
  if (chunks.length === 0) {
    return jsonResult({
      candidates: [
        {
          title: "Invented conflict",
          explanation: "Gullible mock emits a contradiction with no sources.",
          confidence: "high",
          sideA: {
            chunkIds: ["aaaaaaaa-bbbb-4ccc-8ddd-111111111111"],
            summary: "Invented side A.",
          },
          sideB: {
            chunkIds: ["bbbbbbbb-cccc-4ddd-8eee-222222222222"],
            summary: "Invented side B.",
          },
        },
      ],
    });
  }

  const first = chunks[0]!;
  const last = chunks[chunks.length - 1]!;
  const sideB =
    chunks.length === 1
      ? first
      : last;
  return jsonResult({
    candidates: [
      {
        title: "Potential conflicting statements",
        explanation:
          "Gullible mock treats every source pair as a contradiction, including paraphrases and decoys.",
        confidence: "high",
        sideA: { chunkIds: [first.chunkId], summary: first.content.slice(0, 280) },
        sideB: { chunkIds: [sideB.chunkId], summary: sideB.content.slice(0, 280) },
      },
    ],
  });
}

function extractDecoyNeedles(user: string): string[] {
  const line = user.match(/DecoyNeedles:\s*(.+)/i)?.[1] ?? "";
  return line
    .split("|")
    .map((n) => n.trim())
    .filter(Boolean);
}

function gullibleContractCompareClaim(user: string): AiGenerateResult {
  const needles = extractDecoyNeedles(user);
  const listed = needles.length > 0 ? needles.join(" / ") : "labelled / labeled";
  return {
    provider: GULLIBLE_MOCK_NAME,
    model: "gullible-1",
    text:
      `MATERIAL high-attention change: ${listed} substantively amended the agreement ` +
      `and must be treated as a high_attention clause edit.`,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export class GullibleMockProvider implements AIProvider {
  readonly name = GULLIBLE_MOCK_NAME;

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    const system = request.messages.find((m) => m.role === "system")?.content ?? "";
    const user = request.messages.find((m) => m.role === "user")?.content ?? "";

    if (/STRESS contract-compare decoy claim/i.test(user) || /DecoyNeedles:/i.test(user)) {
      return gullibleContractCompareClaim(user);
    }
    if (/identify potential contradictions/i.test(system)) {
      return gullibleContradiction(user);
    }
    return gullibleCitedAnswer(user);
  }
}

export function decoyClaimPrompt(decoyNeedles: string[], original: string, redline: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: "You compare contract versions and flag material high-attention changes.",
    userPrompt: [
      "STRESS contract-compare decoy claim.",
      `DecoyNeedles: ${decoyNeedles.join(" | ")}`,
      "Original:",
      original,
      "Redline:",
      redline,
      "If any decoy edit looks like a change, treat it as a material high-attention amendment.",
    ].join("\n"),
  };
}
