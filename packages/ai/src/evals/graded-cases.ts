/**
 * Graded Case Q&A cases over the synthetic golden matter.
 *
 * Coverage target: ≥30 cases including `partial`, QA-06 (verified intel without doc cites),
 * and ≥5 adversarial traps. See docs/AGENT_QUALITY.md.
 */
import {
  buildNyayaSystemPrompt,
  buildNyayaSystemPromptWithIntelligence,
  buildNyayaUserPrompt,
} from "../index";
import {
  assessRetrievedEvidenceDeterministic,
  formatEvidenceAssessmentForPrompt,
} from "../evidence-assessment";
import type { GroundingPassage } from "../index";
import { passagesByLabels } from "./golden-matter";
import type { GradedCase } from "./grade";

/** Near-miss decoys: real matter-like passages that do not support the asked claim. */
const DECOY_PROPOSED_COMMENCEMENT: GroundingPassage = {
  chunkId: "chunk_decoy_proposed_commencement",
  documentId: "doc_lease",
  documentVersionId: "docv_lease_1",
  page: 2,
  quote:
    "A rejected calendar hold listed 15 January 2024 as a target move-in; that hold is not the executed start date.",
};

const DECOY_TERM_SHEET_RENT: GroundingPassage = {
  chunkId: "chunk_decoy_term_sheet_rent",
  documentId: "doc_lease",
  documentVersionId: "docv_lease_1",
  page: 1,
  quote:
    "Landlord's unsigned term sheet listed five thousand dollars ($5,000) as a discussion figure; that figure was not executed.",
};

const DECOY_NINETY_DAY_DRAFT: GroundingPassage = {
  chunkId: "chunk_decoy_ninety_day_draft",
  documentId: "doc_lease",
  documentVersionId: "docv_lease_1",
  page: 11,
  quote:
    "A prior unexecuted draft used ninety (90) days for ending the arrangement; the executed instrument did not keep that period.",
};

export const GRADED_CASES: GradedCase[] = [
  {
    id: "golden-lease-commencement",
    description: "Direct lease-term fact — grounded + cite term chunk",
    question: "When does the lease term commence?",
    retrieved: [...passagesByLabels("lease_term"), ...passagesByLabels("rent")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_term"],
      forbiddenChunkIds: ["chunk_lease_rent"],
      forbiddenPhrases: ["Westlaw", "supreme court", "guaranteed"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-lease-expiration",
    description: "Expiration date from the same term chunk",
    question: "When does the lease term expire?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["December 31, 2026"],
      mustCiteChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["December 31, 2027"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-rent-amount",
    description: "Base rent amount from lease — grounded",
    question: "What is the monthly base rent under the lease?",
    retrieved: [...passagesByLabels("rent"), ...passagesByLabels("late_fee")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000"],
      mustCiteChunkIds: ["chunk_lease_rent"],
      forbiddenChunkIds: ["chunk_late_fee"],
      forbiddenPhrases: ["$5,000", "weekly"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-rent-annual",
    description: "Annual base rent from the rent chunk",
    question: "What is the yearly base rent payable under the lease?",
    retrieved: passagesByLabels("rent"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["48,000"],
      mustCiteChunkIds: ["chunk_lease_rent"],
      forbiddenPhrases: ["weekly"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-notice-period",
    description: "Termination notice period — grounded",
    question: "How much written notice is required to terminate the lease?",
    retrieved: passagesByLabels("termination_notice"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["thirty"],
      mustCiteChunkIds: ["chunk_lease_notice"],
      forbiddenPhrases: ["sixty (60)"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-notice-section",
    description: "Notice address is in Section 15 — do not invent a street",
    question: "Where must termination notice be sent under the lease?",
    retrieved: passagesByLabels("termination_notice"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["Section 15"],
      mustCiteChunkIds: ["chunk_lease_notice"],
      forbiddenPhrases: ["123 Main", "Westlaw"],
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
    retrieved: [...passagesByLabels("indemnity", "amendment"), ...passagesByLabels("lease_term")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["negligence"],
      mustCiteChunkIds: ["chunk_amend_indemnity"],
      forbiddenChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["unlimited indemnity", "strict liability"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-unrelated-capital",
    description: "Unrelated question must not invent from training data",
    shouldRefuse: true,
    trapKind: "should_refuse",
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
    shouldRefuse: true,
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
    question: "When was the February CAM package sent, and do the Case documents agree?",
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
    question: "When was the February CAM package sent, and do the Case documents agree?",
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
  {
    id: "golden-dispute-date",
    description: "Tenant dispute date from counsel email",
    question: "When did Tenant dispute the February CAM reconciliation?",
    retrieved: [...passagesByLabels("dispute_date"), ...passagesByLabels("lease_term")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["March 14, 2025"],
      mustCiteChunkIds: ["chunk_email_dispute"],
      forbiddenChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["February 28, 2025"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-invoice-request",
    description: "Supporting invoices requested within ten business days",
    question: "What supporting materials did Tenant request after disputing CAM?",
    retrieved: passagesByLabels("dispute_date"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["invoices"],
      mustCiteChunkIds: ["chunk_email_dispute"],
      forbiddenPhrases: ["guaranteed"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-depo-receipt-same-day",
    description: "Depo claims Tenant confirmed receipt the same day",
    question: "Did the property manager testify that Tenant confirmed CAM receipt?",
    retrieved: passagesByLabels("contradiction_side_a"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["confirmed receipt"],
      mustCiteChunkIds: ["chunk_depo_cam"],
      forbiddenPhrases: ["March 3, 2025"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-portal-upload-date",
    description: "PM email places the upload on March 3",
    question: "When does the property manager email say the February CAM package was uploaded?",
    retrieved: passagesByLabels("contradiction_side_b"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["March 3, 2025"],
      mustCiteChunkIds: ["chunk_email_receipt"],
      forbiddenPhrases: ["February 28, 2025"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-late-fee",
    description: "Delinquency charge is not base rent",
    question: "What delinquency charge applies if payment is overdue?",
    retrieved: [...passagesByLabels("late_fee"), ...passagesByLabels("lease_term")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["500"],
      mustCiteChunkIds: ["chunk_late_fee"],
      forbiddenChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["4,000"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-renewal-notice",
    description: "Renewal notice is 60 days — not the 30-day termination period",
    question: "How much notice must Tenant give to renew for an additional year?",
    retrieved: passagesByLabels("renewal"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["sixty"],
      mustCiteChunkIds: ["chunk_renewal_notice"],
      forbiddenPhrases: ["thirty (30)"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-cam-estimate-not-transmittal",
    description: "Internal worksheet date is not a send date",
    question: "When was the estimated February CAM worksheet prepared internally?",
    retrieved: passagesByLabels("near_miss_date"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["February 15, 2025"],
      mustCiteChunkIds: ["chunk_cam_estimate"],
      forbiddenPhrases: ["emailed the worksheet to Tenant"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-partial-hedge-indemnity",
    description: "QA-05: model hedges (insufficient) with valid cites → partial",
    question:
      "Is the indemnity obligation fully settled in these excerpts, or is this only a partial picture, and what remains uncertain?",
    retrieved: passagesByLabels("indemnity", "amendment"),
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["negligence"],
      mustCiteChunkIds: ["chunk_amend_indemnity"],
      forbiddenPhrases: ["unlimited indemnity"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-partial-hedge-term",
    description: "QA-05: hedge language with a real term cite → partial",
    question:
      "Is the lease term fully settled from this excerpt, or is this only a partial picture of commencement?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_term"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-qa06-intel-no-docs",
    description: "QA-06: verified intel without document cites must cap at partial",
    question: "According to verified matter intelligence, when was the CAM package sent?",
    retrieved: [],
    verifiedIntelligence:
      "Verified timeline event: Property manager sent the February CAM package on February 28, 2025 (attorney-verified).",
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["February 28, 2025"],
      forbiddenPhrases: ["Westlaw"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-qa06-graph-no-docs",
    description: "QA-06: verified graph without document cites must cap at partial",
    question: "How is Tenant related to the CAM dispute on the verified graph?",
    retrieved: [],
    verifiedGraph:
      "Verified relationship: Tenant --disputed--> February CAM reconciliation (attorney-verified Graph edge).",
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["CAM"],
      forbiddenPhrases: ["Westlaw"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-qa06-memory-no-docs",
    description: "QA-06: approved memory without document cites must cap at partial",
    question: "What have we decided in approved matter memory about indemnity?",
    retrieved: [],
    verifiedMemory:
      "Approved Matter Memory: Operative indemnity is Tenant negligence only; Landlord sole negligence is excluded (attorney-approved).",
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["negligence"],
      forbiddenPhrases: ["unlimited indemnity"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-adv-near-miss-commencement",
    description: "Adversarial: near-miss date January 15 must not be confirmed",
    adversarial: true,
    question: "Did the lease commence on January 15, 2024?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_term"],
      forbiddenPhrases: ["January 15, 2024"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-similar-clause-rent-vs-late-fee",
    description: "Adversarial: similarly worded delinquency clause is not monthly base rent",
    adversarial: true,
    question: "What is the monthly base rent under the lease?",
    retrieved: [...passagesByLabels("rent"), ...passagesByLabels("late_fee")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000"],
      mustCiteChunkIds: ["chunk_lease_rent"],
      forbiddenPhrases: ["$5,000"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-combine-rent-and-term",
    description: "Adversarial: answer requires combining rent + term chunks, not one alone",
    adversarial: true,
    question: "What is the monthly base rent and when does the lease term commence?",
    retrieved: passagesByLabels("rent", "lease_term"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000", "January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_rent", "chunk_lease_term"],
      forbiddenPhrases: ["guaranteed"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-notice-vs-renewal",
    description: "Adversarial: 30-day termination vs 60-day renewal — do not swap",
    adversarial: true,
    question: "How much written notice is required to terminate the lease?",
    retrieved: [...passagesByLabels("termination_notice"), ...passagesByLabels("renewal")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["thirty"],
      mustCiteChunkIds: ["chunk_lease_notice"],
      forbiddenPhrases: ["guaranteed outcome"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-near-miss-cam-worksheet",
    description: "Adversarial: internal February 15 worksheet is not the send date",
    adversarial: true,
    question: "When was the February CAM package sent to Tenant?",
    retrieved: [...passagesByLabels("contradiction_side_a"), ...passagesByLabels("near_miss_date")],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["February 28, 2025"],
      mustCiteChunkIds: ["chunk_depo_cam"],
      forbiddenPhrases: ["sent to Tenant on February 15"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-combine-notice-and-term",
    description: "Adversarial: combine termination notice with lease term dates",
    adversarial: true,
    question: "When does the lease expire, and how much written notice is required to terminate?",
    retrieved: passagesByLabels("lease_term", "termination_notice"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["December 31, 2026", "thirty"],
      mustCiteChunkIds: ["chunk_lease_term", "chunk_lease_notice"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-false-rent-amount",
    description: "Refuse a rent figure that is not in the sources",
    shouldRefuse: true,
    trapKind: "should_refuse",
    question: "Is the monthly base rent seven thousand dollars?",
    retrieved: passagesByLabels("lease_term"),
    rubric: {
      expectEvidenceState: "insufficient",
      forbiddenPhrases: ["7,000", "seven thousand"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-judge-not-in-record",
    description: "Must not invent a judge or docket from training data",
    shouldRefuse: true,
    trapKind: "should_refuse",
    question: "Which judge is assigned to this Case and what is the docket number?",
    retrieved: passagesByLabels("rent"),
    rubric: {
      expectEvidenceState: "insufficient",
      forbiddenPhrases: ["Hon.", "docket"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-adv-combine-indemnity-and-rent",
    description: "Adversarial: answer requires combining indemnity + rent chunks",
    adversarial: true,
    question:
      "What is the monthly base rent, and how does the amendment change the indemnity obligation?",
    retrieved: passagesByLabels("rent", "indemnity", "amendment"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000", "negligence"],
      mustCiteChunkIds: ["chunk_lease_rent", "chunk_amend_indemnity"],
      forbiddenPhrases: ["unlimited indemnity"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-combine-dispute-and-late-fee",
    description: "Adversarial: answer requires combining dispute-date + late-fee chunks",
    adversarial: true,
    question:
      "When did Tenant dispute the February CAM reconciliation, and what delinquency charge applies if payment is overdue?",
    retrieved: passagesByLabels("dispute_date", "late_fee"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["March 14, 2025", "500"],
      mustCiteChunkIds: ["chunk_email_dispute", "chunk_late_fee"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-combine-renewal-and-expiration",
    description: "Adversarial: answer requires combining renewal notice + lease expiration",
    adversarial: true,
    question:
      "When does the lease expire, and how much notice must Tenant give to renew for an additional year?",
    retrieved: passagesByLabels("lease_term", "renewal"),
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["December 31, 2026", "sixty"],
      mustCiteChunkIds: ["chunk_lease_term", "chunk_renewal_notice"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-near-miss-proposed-commencement",
    description:
      "Adversarial: unsigned January 15 move-in hold is in retrieval but is not the executed commencement",
    adversarial: true,
    question: "When does the lease term commence?",
    retrieved: [...passagesByLabels("lease_term"), DECOY_PROPOSED_COMMENCEMENT],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["January 1, 2024"],
      mustCiteChunkIds: ["chunk_lease_term"],
      forbiddenChunkIds: ["chunk_decoy_proposed_commencement"],
      forbiddenPhrases: ["January 15, 2024", "15 January 2024"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-near-miss-term-sheet-rent",
    description:
      "Adversarial: unsigned $5,000 term-sheet figure is in retrieval but is not executed Base Rent",
    adversarial: true,
    question: "What is the monthly base rent under the lease?",
    retrieved: [...passagesByLabels("rent"), DECOY_TERM_SHEET_RENT],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["4,000"],
      mustCiteChunkIds: ["chunk_lease_rent"],
      forbiddenChunkIds: ["chunk_decoy_term_sheet_rent"],
      forbiddenPhrases: ["$5,000"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-adv-near-miss-ninety-day-draft",
    description:
      "Adversarial: unexecuted 90-day draft period is in retrieval but is not the termination notice",
    adversarial: true,
    question: "How much written notice is required to terminate the lease?",
    retrieved: [...passagesByLabels("termination_notice"), DECOY_NINETY_DAY_DRAFT],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["thirty"],
      mustCiteChunkIds: ["chunk_lease_notice"],
      forbiddenChunkIds: ["chunk_decoy_ninety_day_draft"],
      forbiddenPhrases: ["ninety (90)"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-access-log-limitation",
    description: "System record establishes badge activity, not the named person's physical entry",
    question: "At exactly what time did Alex Rivera physically enter the server room?",
    retrieved: [
      {
        chunkId: "chunk_access_log",
        documentId: "doc_access_log",
        documentVersionId: "docv_access_log_1",
        page: 1,
        quote:
          "Badge assigned to Alex Rivera — ACCESS GRANTED at 14:47. This log records badge activity; it does not independently prove who physically carried the badge.",
      },
    ],
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["ACCESS GRANTED", "does not independently prove"],
      mustCiteChunkIds: ["chunk_access_log"],
      forbiddenPhrases: ["physically entered the server"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-false-premise-future-effective",
    description: "Question assumes a future-effective amendment is retroactive",
    question: "Explain why the parties made Amendment 2 retroactive to March 1, 2024.",
    retrieved: [
      {
        chunkId: "chunk_future_amend",
        documentId: "doc_future_amend",
        documentVersionId: "docv_future_amend_1",
        page: 1,
        quote: "This Amendment 2 becomes effective January 1, 2027.",
      },
    ],
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["not support", "January 1, 2027"],
      mustCiteChunkIds: ["chunk_future_amend"],
      forbiddenPhrases: ["align with the original commencement"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-invoice-silence-not-proof",
    description: "Absence of a credit on one invoice is not proof none was ever issued",
    question: "Did the vendor ever issue a service credit?",
    retrieved: [
      {
        chunkId: "chunk_invoice_silence",
        documentId: "doc_invoice",
        documentVersionId: "docv_invoice_1",
        page: 1,
        quote: "This invoice does not reflect any service credit.",
      },
    ],
    rubric: {
      expectEvidenceState: "partial",
      mustIncludePhrases: ["this invoice", "does not"],
      mustCiteChunkIds: ["chunk_invoice_silence"],
      forbiddenPhrases: ["no credit was ever issued", "never issued a service credit"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-email-vs-signed-amendment",
    description: "Informal email recollection does not control over a signed in-force amendment",
    question: "What notice period does the signed agreement require?",
    retrieved: [
      {
        chunkId: "chunk_email_recollection",
        documentId: "doc_email_recollection",
        documentVersionId: "docv_email_recollection_1",
        page: 1,
        quote: "I think the notice period is 60 days.",
      },
      {
        chunkId: "chunk_signed_notice",
        documentId: "doc_signed_amendment",
        documentVersionId: "docv_signed_amendment_1",
        page: 1,
        quote:
          "Section 4 is amended to require thirty (30) days' written notice, effective immediately.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["thirty (30)"],
      mustCiteChunkIds: ["chunk_signed_notice"],
      forbiddenChunkIds: ["chunk_email_recollection"],
      forbiddenPhrases: ["I think"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-supersession-effective-amendment",
    description: "Currently effective amendment replaces the original notice term",
    question: "What notice period is currently operative under the executed instruments?",
    retrieved: [
      {
        chunkId: "chunk_original_notice",
        documentId: "doc_base_agreement",
        documentVersionId: "docv_base_agreement_1",
        page: 4,
        quote: "Notice shall be sixty (60) days.",
      },
      {
        chunkId: "chunk_effective_amend",
        documentId: "doc_notice_amendment",
        documentVersionId: "docv_notice_amendment_1",
        page: 1,
        quote:
          "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["thirty (30)"],
      mustCiteChunkIds: ["chunk_effective_amend"],
      forbiddenPhrases: ["currently sixty"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-future-effective-current-term",
    description: "Signed but not-yet-effective amendment does not replace the current term",
    question: "What notice period does the contract currently require?",
    retrieved: [
      {
        chunkId: "chunk_current_notice",
        documentId: "doc_base_notice",
        documentVersionId: "docv_base_notice_1",
        page: 4,
        quote: "Notice shall be sixty (60) days.",
      },
      {
        chunkId: "chunk_not_yet_effective",
        documentId: "doc_future_notice",
        documentVersionId: "docv_future_notice_1",
        page: 1,
        quote:
          "Amendment 2 is signed and becomes effective January 1, 2027; thereafter notice shall be forty-five (45) days.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["sixty (60)", "not yet effective"],
      mustCiteChunkIds: ["chunk_current_notice"],
      forbiddenPhrases: ["currently forty-five", "currently 45"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-future-effective-future-term",
    description: "Question date after a future-effective amendment uses the later term",
    question: "What notice period will apply on January 2, 2027?",
    retrieved: [
      {
        chunkId: "chunk_current_notice_future_q",
        documentId: "doc_base_notice_future_q",
        documentVersionId: "docv_base_notice_future_q_1",
        page: 4,
        quote: "Notice shall be sixty (60) days.",
      },
      {
        chunkId: "chunk_future_notice_future_q",
        documentId: "doc_future_notice_future_q",
        documentVersionId: "docv_future_notice_future_q_1",
        page: 1,
        quote:
          "This amendment is signed and becomes effective January 1, 2027; thereafter notice shall be forty-five (45) days.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["forty-five (45)", "January 1, 2027"],
      mustCiteChunkIds: ["chunk_future_notice_future_q"],
      forbiddenPhrases: ["cannot answer", "insufficient"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-corroborated-actor-inference",
    description: "Activity record plus independent visual evidence may support the actor claim",
    question: "Did Priya Shah personally use the credential at the loading dock?",
    retrieved: [
      {
        chunkId: "chunk_dock_log",
        documentId: "doc_dock_log",
        documentVersionId: "docv_dock_log_1",
        page: 1,
        quote: "Credential assigned to Priya Shah — ACCESS GRANTED at 09:12 at Dock B.",
      },
      {
        chunkId: "chunk_dock_video",
        documentId: "doc_dock_video",
        documentVersionId: "docv_dock_video_1",
        page: 1,
        quote: "Loading-dock video shows Priya Shah used the credential at Dock B at 09:12.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["Priya Shah", "credential"],
      mustCiteChunkIds: ["chunk_dock_video"],
      forbiddenPhrases: ["does not independently prove"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-qualifier-preserve-approximately",
    description: "Source hedge language must survive into the answer",
    question: "When did delivery occur?",
    retrieved: [
      {
        chunkId: "chunk_approx_delivery",
        documentId: "doc_delivery_note",
        documentVersionId: "docv_delivery_note_1",
        page: 1,
        quote: "Delivery occurred on or about approximately March 12, 2026.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["approximately"],
      mustCiteChunkIds: ["chunk_approx_delivery"],
      forbiddenPhrases: ["exactly March 12"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-compatible-approx-exact-date",
    description: "Approximate mid-month language is compatible with an exact date in that month",
    question: 'Is "near the middle of November" inconsistent with the meeting date 2026-11-10?',
    retrieved: [
      {
        chunkId: "chunk_approx_meeting",
        documentId: "doc_depo_meeting",
        documentVersionId: "docv_depo_meeting_1",
        page: 1,
        quote:
          "Q. When was the pricing issue discussed? A. Near the middle of November, at the review meeting.",
      },
      {
        chunkId: "chunk_exact_meeting",
        documentId: "doc_minutes_meeting",
        documentVersionId: "docv_minutes_meeting_1",
        page: 1,
        quote: "The review meeting was held on 2026-11-10.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["compatible"],
      forbiddenPhrases: ["is inconsistent", "creates a contradiction"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-named-exhibit-missing",
    description: "A named exhibit that is not retrieved cannot be answered from another amount",
    question: "What exact amount appears in Exhibit Z - Cost Reconciliation?",
    retrieved: [
      {
        chunkId: "chunk_other_invoice",
        documentId: "doc_invoice_other",
        documentVersionId: "docv_invoice_other_1",
        page: 1,
        quote: "Invoice INV-2606: Amount due $132,500.",
      },
    ],
    rubric: {
      expectEvidenceState: "insufficient",
      forbiddenPhrases: ["$132,500"],
      mustIncludePhrases: ["not established"],
      requireVerbatimQuotes: false,
      expectNeedsMoreDocuments: true,
    },
  },
  {
    id: "golden-guardrail-states-operative-days",
    description: "Source-role arbitration still states the operative numeric term",
    question:
      "An internal email says the contract still says 60 days. Should that be treated as the current contractual requirement?",
    retrieved: [
      {
        chunkId: "chunk_email_sixty",
        documentId: "doc_email_sixty",
        documentVersionId: "docv_email_sixty_1",
        page: 1,
        quote: "I think the contract still says 60 days.",
      },
      {
        chunkId: "chunk_signed_thirty",
        documentId: "doc_signed_thirty",
        documentVersionId: "docv_signed_thirty_1",
        page: 1,
        quote:
          "Section 4 is deleted and replaced: notice shall be thirty (30) days, effective immediately.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["30 days"],
      mustCiteChunkIds: ["chunk_signed_thirty"],
      forbiddenPhrases: ["currently 60"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
  {
    id: "golden-evidentiary-tension-testimony-log",
    description:
      "Testimony denying entry versus badge ACCESS GRANTED is tension, not compatibility or physical proof",
    question:
      "Does the witness testimony about entering the records room conflict with other supplied evidence?",
    retrieved: [
      {
        chunkId: "chunk_depo_entry",
        documentId: "doc_depo_entry",
        documentVersionId: "docv_depo_entry_1",
        page: 1,
        quote:
          "Q. Did you enter the records room that day? A. No. I never entered the records room on 2026-11-10.",
      },
      {
        chunkId: "chunk_log_entry",
        documentId: "doc_log_entry",
        documentVersionId: "docv_log_entry_1",
        page: 1,
        quote: "2026-11-10 14:47 - Badge assigned to the witness - Records Room - ACCESS GRANTED.",
      },
    ],
    rubric: {
      expectEvidenceState: "grounded",
      mustIncludePhrases: ["tension"],
      forbiddenPhrases: ["physically entered the records room", "difference of precision"],
      requireVerbatimQuotes: true,
      expectNeedsMoreDocuments: false,
    },
  },
];

/** Prompt pairs for running graded cases through an AIProvider.
 * Eval rerank is off (isolation). Production search/hybrid may still rank. */
export const EVAL_CASE_QA_RERANK = false;

export function gradedCaseToPrompt(testCase: GradedCase): {
  systemPrompt: string;
  userPrompt: string;
} {
  const hasVerified =
    Boolean(testCase.verifiedIntelligence?.trim()) ||
    Boolean(testCase.verifiedGraph?.trim()) ||
    Boolean(testCase.verifiedMemory?.trim());
  const assessment = assessRetrievedEvidenceDeterministic(testCase.question, testCase.retrieved);
  return {
    systemPrompt: hasVerified ? buildNyayaSystemPromptWithIntelligence() : buildNyayaSystemPrompt(),
    userPrompt: buildNyayaUserPrompt(
      testCase.question,
      testCase.retrieved,
      testCase.verifiedIntelligence,
      testCase.verifiedGraph,
      testCase.verifiedMemory,
      undefined,
      assessment ? formatEvidenceAssessmentForPrompt(assessment) : null,
    ),
  };
}
