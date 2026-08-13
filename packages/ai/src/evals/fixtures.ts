/**
 * Deterministic eval fixtures for the Nyaya matter Q&A prompt + quality gates.
 *
 * See docs/AGENT_QUALITY.md. Fixtures check:
 *   1. Citation grounding — grounded answers must cite verbatim passage text
 *   2. Insufficient-evidence handling — unanswerable questions must not invent sources
 */
import { buildNyayaSystemPrompt, buildNyayaUserPrompt, type GroundingPassage } from "../index";

export type EvalCase = {
  name: string;
  description: string;
  suite: "case_qa";
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

const noticePassage: GroundingPassage = {
  chunkId: "chunk_notice_1",
  documentId: "doc_notice",
  documentVersionId: "docv_notice_1",
  page: 1,
  segmentRef: null,
  quote:
    "Either party may terminate this agreement by providing thirty days written notice to the other party.",
};

export const EVAL_CASES: EvalCase[] = [
  {
    name: "citation-grounding",
    suite: "case_qa",
    description:
      "A question directly answerable from a provided passage must be grounded and cite only that passage's text.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("When does the lease term commence?", [leasePassage]),
    expectEvidenceState: "grounded",
    passages: [leasePassage],
  },
  {
    name: "insufficient-evidence-unrelated-question",
    suite: "case_qa",
    description:
      "A question unrelated to any provided passage must be marked insufficient rather than answered from general knowledge.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("What is the capital of France?", [leasePassage]),
    expectEvidenceState: "insufficient",
  },
  {
    name: "insufficient-evidence-no-sources",
    suite: "case_qa",
    description: "No passages at all must short-circuit to insufficient with zero cited sources.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("What happened at the deposition?", []),
    expectEvidenceState: "insufficient",
  },
  {
    name: "grounded-notice-period",
    suite: "case_qa",
    description: "Termination notice question must cite the notice passage verbatim.",
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt("How much notice is required to terminate?", [noticePassage]),
    expectEvidenceState: "grounded",
    passages: [noticePassage],
  },
];
