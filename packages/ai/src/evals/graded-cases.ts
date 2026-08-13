/**
 * Graded Case Q&A cases over the synthetic golden matter.
 */
import { buildNyayaSystemPrompt, buildNyayaUserPrompt } from "../index";
import { passagesByLabels } from "./golden-matter";
import type { GradedCase } from "./grade";

export const GRADED_CASES: GradedCase[] = [
  {
    id: "golden-lease-commencement",
    description: "Direct lease-term fact — grounded + cite term chunk",
    question: "When does the lease term commence?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["Westlaw", "supreme court", "guaranteed"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-rent-amount",
    description: "Base rent amount from lease — grounded",
    question: "What is the monthly base rent under the lease?",
    retrieved: passagesByLabels("rent"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000"],
      mustCiteChunkIds: ["chunk_lease_rent"],
      forbiddenPhrases: ["$5,000", "weekly"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-indemnity-missing-amendment",
    description:
      "Indemnity question with only lease retrieval — should be insufficient and need more docs",
    question: "How does the amendment change the indemnity obligation?",
    retrieved: passagesByLabels("lease_term", "rent"),
    rubric: {
      expectEvidenceState: "insufficient",
      forbiddenPhrases: ["sole negligence", "Section 9 is deleted"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-indemnity-with-amendment",
    description: "Indemnity with amendment in retrieval — grounded",
    question: "How does the amendment change the indemnity obligation?",
    retrieved: passagesByLabels("indemnity", "amendment"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["negligence"],
      mustCiteChunkIds: ["chunk_amend_indemnity"],
      forbiddenPhrases: ["unlimited indemnity", "strict liability"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-unrelated-capital",
    description: "Unrelated question must not invent from training data",
    question: "What is the capital of France?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "insufficient",
      forbiddenPhrases: ["Paris"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-empty-retrieval",
    description: "No passages — insufficient + need more documents",
    question: "When was the CAM package sent?",
    retrieved: [],
    rubric: {
      expectEvidenceState: "insufficient",
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-cam-date-conflict",
    description:
      "Issue-spotting: multi-hop CAM send-date conflict across deposition + PM email — surface both dates",
    question:
      "When was the February CAM package sent, and do the Case documents agree?",
    retrieved: passagesByLabels("cam"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["February 28, 2025", "March 3, 2025"],
      mustCiteChunkIds: ["chunk_depo_cam", "chunk_email_receipt"],
      forbiddenPhrases: ["fully reconciled", "no conflict", "definitely only February 28"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-cam-date-conflict-incomplete",
    description:
      "Issue-spotting: only deposition retrieved — must not invent the conflicting March 3 email date",
    question:
      "When was the February CAM package sent, and do the Case documents agree?",
    retrieved: passagesByLabels("contradiction_side_a"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["February 28, 2025"],
      mustCiteChunkIds: ["chunk_depo_cam"],
      forbiddenPhrases: ["March 3, 2025", "uploaded to the portal"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
];

/** Prompt pairs for running graded cases through an AIProvider. */
export function gradedCaseToPrompt(testCase: GradedCase): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt(testCase.question, testCase.retrieved),
  };
}
