/**
 * Deterministic eval fixtures for the Nyaya matter Q&A prompt.
 *
 * Each fixture pairs a system/user prompt with the evidence-state the response must land on.
 * These check two properties that make or break trust in a legal-answer product:
 *
 *   1. Citation grounding — every quote in a "grounded" answer must trace back to a provided
 *      passage verbatim. A quote that doesn't appear in any passage means the model invented or
 *      altered text, which `run.ts` treats as a failure regardless of the reported evidenceState.
 *   2. Insufficient-evidence handling — a question with no supporting passage must come back
 *      `insufficient` with zero sources, never an answer synthesized from the model's own
 *      training data.
 */
import { buildNyayaSystemPrompt, buildNyayaUserPrompt, type GroundingPassage } from "../index";

export type EvalCase = {
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  expectEvidenceState: "grounded" | "insufficient" | "partial";
  /** Only relevant when `expectEvidenceState` is "grounded": the passages available to the model. */
  passages?: GroundingPassage[];
};

const leasePassage: GroundingPassage = {
  chunkId: "chunk_lease_1",
  documentId: "doc_lease",
  documentVersionId: "docv_lease_1",
  page: 3,
  segmentRef: null,
  quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
};

export const EVAL_CASES: EvalCase[] = [
  {
    name: "citation-grounding",
    description:
      "A question directly answerable from a provided passage must be grounded and cite only that passage's text.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("When does the lease term commence?", [leasePassage]),
    expectEvidenceState: "grounded",
    passages: [leasePassage],
  },
  {
    name: "insufficient-evidence-unrelated-question",
    description:
      "A question unrelated to any provided passage must be marked insufficient rather than answered from general knowledge.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("What is the capital of France?", [leasePassage]),
    expectEvidenceState: "insufficient",
  },
  {
    name: "insufficient-evidence-no-sources",
    description: "No passages at all must short-circuit to insufficient with zero cited sources.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("What happened at the deposition?", []),
    expectEvidenceState: "insufficient",
  },
];
