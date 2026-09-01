/**
 * Contradiction / timeline graded cases forking the CAM date-conflict fixtures.
 *
 * Chunk IDs are UUIDs because contradictionSideSchema requires uuid().
 * See CX-01..CX-05 in docs/AGENT_QUALITY.md.
 */
import {
  buildContradictionAnalysisSystemPrompt,
  buildContradictionAnalysisUserPrompt,
  type ProfessionalChunk,
} from "../professional";
import type { TrapKind } from "./grade";
import type { WorkflowId } from "./metrics";

export type ContradictionCaseKind = "generate" | "schema_reject" | "schema_accept";

export type ContradictionCase = {
  id: string;
  description: string;
  kind: ContradictionCaseKind;
  adversarial?: boolean;
  trapKind?: TrapKind;
  shouldRefuse?: boolean;
  chunks: ProfessionalChunk[];
  /** Raw payload for schema_* kinds. */
  raw?: unknown;
  expectCandidateCount?: number;
  mustIncludeSideChunkIds?: string[];
  /**
   * Real chunk IDs in `chunks` that must not be cited as a contradiction side
   * (decoy passages that are not actually inconsistent with the other side).
   */
  forbiddenChunkIds?: string[];
  /** If true, any emitted candidate is false-confidence. */
  expectNoCandidates?: boolean;
  expectRelation?: "contradiction" | "tension";
};

export const CX_CHUNK_DEPO = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
export const CX_CHUNK_EMAIL = "bbbbbbbb-cccc-4ddd-8eee-222222222222";
export const CX_CHUNK_DISPUTE = "cccccccc-dddd-4eee-8fff-333333333333";
export const CX_CHUNK_IMPRECISE = "dddddddd-eeee-4fff-8aaa-444444444444";
export const CX_CHUNK_PARAPHRASE = "eeeeeeee-ffff-4aaa-8bbb-555555555555";
export const CX_CHUNK_BEFORE = "ffffffff-aaaa-4bbb-8ccc-666666666666";
export const CX_CHUNK_AFTER = "aaaa1111-bbbb-4ccc-8ddd-777777777777";
export const CX_CHUNK_FABRICATED = "99999999-9999-4999-8999-999999999999";
export const CX_CHUNK_DECOY_NOTICE = "bbbb2222-cccc-4ddd-8eee-888888888888";
export const CX_CHUNK_ROUND_A = "cccc3333-dddd-4eee-8fff-121212121212";
export const CX_CHUNK_ROUND_B = "dddd4444-eeee-4fff-8aaa-131313131313";
export const CX_CHUNK_SYN_A = "eeee5555-ffff-4aaa-8bbb-141414141414";
export const CX_CHUNK_SYN_B = "ffff6666-aaaa-4bbb-8ccc-151515151515";
export const CX_CHUNK_ABOUT = "aaaa7777-bbbb-4ccc-8ddd-161616161616";
export const CX_CHUNK_TENSION_DEPO = "aaaa8888-bbbb-4ccc-8ddd-171717171717";
export const CX_CHUNK_TENSION_LOG = "bbbb8888-cccc-4ddd-8eee-181818181818";
export const CX_CHUNK_DIRECT_A = "cccc8888-dddd-4eee-8fff-191919191919";
export const CX_CHUNK_DIRECT_B = "dddd8888-eeee-4fff-8aaa-202020202020";
export const CX_CHUNK_DATE_A = "eeee8888-ffff-4aaa-8bbb-212121212121";
export const CX_CHUNK_DATE_B = "ffff8888-aaaa-4bbb-8ccc-222222222222";
export const CX_CHUNK_SEQ_A = "aaaa9999-bbbb-4ccc-8ddd-232323232323";
export const CX_CHUNK_SEQ_B = "bbbb9999-cccc-4ddd-8eee-242424242424";
export const CX_CHUNK_ACTOR_A = "cccc9999-dddd-4eee-8fff-252525252525";
export const CX_CHUNK_ACTOR_B = "dddd9999-eeee-4fff-8aaa-262626262626";

const DEPO_CAM: ProfessionalChunk = {
  chunkId: CX_CHUNK_DEPO,
  documentId: "doc_depo",
  documentVersionId: "docv_depo_1",
  page: 44,
  segmentRef: "44:12-44:20",
  content:
    "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.",
};

const EMAIL_CAM: ProfessionalChunk = {
  chunkId: CX_CHUNK_EMAIL,
  documentId: "doc_email_pm",
  documentVersionId: "docv_email_pm_1",
  page: 1,
  content:
    "Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.",
};

const DISPUTE: ProfessionalChunk = {
  chunkId: CX_CHUNK_DISPUTE,
  documentId: "doc_email",
  documentVersionId: "docv_email_1",
  page: 1,
  content:
    "On March 14, 2025, Tenant disputed the February CAM reconciliation and requested supporting invoices within ten business days.",
};

const IMPRECISE: ProfessionalChunk = {
  chunkId: CX_CHUNK_IMPRECISE,
  documentId: "doc_email_pm",
  documentVersionId: "docv_email_pm_2",
  page: 1,
  content:
    "I sent the February CAM package around the end of February; I do not remember the exact calendar day.",
};

const PARAPHRASE: ProfessionalChunk = {
  chunkId: CX_CHUNK_PARAPHRASE,
  documentId: "doc_email",
  documentVersionId: "docv_email_2",
  page: 1,
  content:
    "Tenant asked for supporting invoices in ten business days after disputing the February CAM reconciliation.",
};

const BEFORE: ProfessionalChunk = {
  chunkId: CX_CHUNK_BEFORE,
  documentId: "doc_depo",
  documentVersionId: "docv_depo_2",
  page: 12,
  content: "A: Yes, I confirmed the work was completed before the inspection.",
};

const AFTER: ProfessionalChunk = {
  chunkId: CX_CHUNK_AFTER,
  documentId: "doc_email",
  documentVersionId: "docv_email_3",
  page: 1,
  content: "The work was never completed; it was still unfinished after the inspection.",
};

const DECOY_NOTICE: ProfessionalChunk = {
  chunkId: CX_CHUNK_DECOY_NOTICE,
  documentId: "doc_lease",
  documentVersionId: "docv_lease_1",
  page: 11,
  content: "Either party may terminate this agreement by providing thirty (30) days written notice.",
};

const ROUND_A: ProfessionalChunk = {
  chunkId: CX_CHUNK_ROUND_A,
  documentId: "doc_lease",
  documentVersionId: "docv_lease_2",
  page: 4,
  content: "The shared-cost allocation is twelve percent (12.0%).",
};

const ROUND_B: ProfessionalChunk = {
  chunkId: CX_CHUNK_ROUND_B,
  documentId: "doc_email",
  documentVersionId: "docv_email_4",
  page: 1,
  content: "The shared-cost allocation is about 12 percent.",
};

const SYN_A: ProfessionalChunk = {
  chunkId: CX_CHUNK_SYN_A,
  documentId: "doc_email_pm",
  documentVersionId: "docv_email_pm_3",
  page: 1,
  content: "I emailed the February CAM package to Tenant.",
};

const SYN_B: ProfessionalChunk = {
  chunkId: CX_CHUNK_SYN_B,
  documentId: "doc_depo",
  documentVersionId: "docv_depo_3",
  page: 20,
  content: "I transmitted the February CAM package to Tenant.",
};

const ABOUT_FEB28: ProfessionalChunk = {
  chunkId: CX_CHUNK_ABOUT,
  documentId: "doc_email_pm",
  documentVersionId: "docv_email_pm_4",
  page: 1,
  content: "I sent the package on or about February 28, 2025.",
};

export const CONTRADICTION_CASES: ContradictionCase[] = [
  {
    id: "cx-cam-dual-sided",
    description: "Genuine CAM send-date conflict — dual-sided, both chunks valid",
    kind: "generate",
    chunks: [DEPO_CAM, EMAIL_CAM, DECOY_NOTICE],
    expectCandidateCount: 1,
    mustIncludeSideChunkIds: [CX_CHUNK_DEPO, CX_CHUNK_EMAIL],
    forbiddenChunkIds: [CX_CHUNK_DECOY_NOTICE],
  },
  {
    id: "cx-cam-dual-sided-reversed",
    description: "Same genuine conflict with chunk order reversed",
    kind: "generate",
    chunks: [EMAIL_CAM, DEPO_CAM, DECOY_NOTICE],
    expectCandidateCount: 1,
    mustIncludeSideChunkIds: [CX_CHUNK_DEPO, CX_CHUNK_EMAIL],
    forbiddenChunkIds: [CX_CHUNK_DECOY_NOTICE],
  },
  {
    id: "cx-before-after",
    description: "Genuine before/after conflict on completion vs inspection",
    kind: "generate",
    chunks: [BEFORE, AFTER, DECOY_NOTICE],
    expectCandidateCount: 1,
    mustIncludeSideChunkIds: [CX_CHUNK_BEFORE, CX_CHUNK_AFTER],
    forbiddenChunkIds: [CX_CHUNK_DECOY_NOTICE],
  },
  {
    id: "cx-one-sided-generate",
    description: "CX-01/CX-02: one chunk only — must not emit a candidate",
    kind: "generate",
    trapKind: "one_sided",
    shouldRefuse: true,
    chunks: [DEPO_CAM],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-one-sided-email-only",
    description: "CX-01: PM email alone is not a contradiction",
    kind: "generate",
    trapKind: "one_sided",
    shouldRefuse: true,
    chunks: [EMAIL_CAM],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-empty-sources",
    description: "No sources — no candidates",
    kind: "generate",
    shouldRefuse: true,
    chunks: [],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-false-positive-paraphrase",
    description: "Differently worded but non-contradictory invoice request",
    kind: "generate",
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [DISPUTE, PARAPHRASE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-false-positive-imprecise-date",
    description: "Imprecise 'end of February' is not a conflict with February 28",
    kind: "generate",
    trapKind: "false_positive",
    adversarial: true,
    shouldRefuse: true,
    chunks: [DEPO_CAM, IMPRECISE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-false-positive-same-depo-twice",
    description: "The same statement twice is not a contradiction",
    kind: "generate",
    trapKind: "false_positive",
    chunks: [DEPO_CAM, { ...DEPO_CAM, chunkId: CX_CHUNK_PARAPHRASE, documentId: "doc_depo_copy" }],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-schema-one-sided-reject",
    description: "CX-01: schema rejects a candidate missing side B",
    kind: "schema_reject",
    trapKind: "one_sided",
    chunks: [],
    raw: {
      candidates: [
        {
          title: "One sided",
          explanation: "Missing side B",
          sideA: { chunkIds: [CX_CHUNK_DEPO], summary: "Witness said the package went out February 28." },
        },
      ],
    },
  },
  {
    id: "cx-schema-empty-side-chunks",
    description: "CX-01: schema rejects empty chunkIds on a side",
    kind: "schema_reject",
    trapKind: "one_sided",
    chunks: [],
    raw: {
      candidates: [
        {
          title: "Empty side",
          explanation: "Side B has no chunks",
          sideA: { chunkIds: [CX_CHUNK_DEPO], summary: "February 28 send." },
          sideB: { chunkIds: [], summary: "Unsourced contrary claim." },
        },
      ],
    },
  },
  {
    id: "cx-schema-dual-accept",
    description: "CX-01: dual-sided candidate with valid UUIDs is accepted",
    kind: "schema_accept",
    chunks: [],
    raw: {
      candidates: [
        {
          title: "Date conflict",
          explanation: "Sources disagree on the send date; both sides are presented without picking a winner.",
          sideA: { chunkIds: [CX_CHUNK_DEPO], summary: "Depo places send on February 28, 2025." },
          sideB: { chunkIds: [CX_CHUNK_EMAIL], summary: "Email places upload on March 3, 2025." },
        },
      ],
    },
  },
  {
    id: "cx-schema-fabricated-still-needs-both-sides",
    description: "CX-02: fabricated id does not excuse a missing side",
    kind: "schema_reject",
    chunks: [],
    raw: {
      candidates: [
        {
          title: "Fabricated side",
          explanation: "One side cites a made-up chunk and the other side is omitted.",
          sideA: { chunkIds: [CX_CHUNK_FABRICATED], summary: "Invented statement." },
        },
      ],
    },
  },
  {
    id: "cx-adv-imprecise-phrasing",
    description:
      "Adversarial: imprecise phrasing vs exact date must be rejected (not a real conflict)",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [DEPO_CAM, IMPRECISE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-adv-paraphrase-invoices",
    description: "Adversarial: paraphrase of the same invoice request is not a contradiction",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [DISPUTE, PARAPHRASE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-adv-genuine-still-required",
    description: "Adversarial: a real dual-sided date conflict must still be surfaced",
    kind: "generate",
    adversarial: true,
    chunks: [DEPO_CAM, EMAIL_CAM],
    expectCandidateCount: 1,
    mustIncludeSideChunkIds: [CX_CHUNK_DEPO, CX_CHUNK_EMAIL],
  },
  {
    id: "cx-reject-rounding-percent",
    description:
      "One-sided reject: 12.0% vs about 12 percent is a rounding difference, not a contradiction",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [ROUND_A, ROUND_B],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-reject-synonym-sent",
    description:
      "One-sided reject: emailed vs transmitted is a paraphrase, not an inconsistency",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [SYN_A, SYN_B],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-reject-on-or-about-same-date",
    description:
      "One-sided reject: on-or-about February 28 is not inconsistent with February 28, 2025",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [DEPO_CAM, ABOUT_FEB28],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-reject-one-sided-dispute",
    description: "One-sided reject: dispute email alone is not a contradiction",
    kind: "generate",
    adversarial: true,
    trapKind: "one_sided",
    shouldRefuse: true,
    chunks: [DISPUTE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-reject-imprecise-plus-decoy-notice",
    description:
      "One-sided reject: imprecise phrasing plus an unrelated notice clause is still not a contradiction",
    kind: "generate",
    adversarial: true,
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [DEPO_CAM, IMPRECISE, DECOY_NOTICE],
    expectNoCandidates: true,
    expectCandidateCount: 0,
    forbiddenChunkIds: [CX_CHUNK_DECOY_NOTICE],
  },
  {
    id: "cx-tension-badge-vs-testimony",
    description: "Assigned-badge ACCESS GRANTED versus a physical-entry denial is tension",
    kind: "generate",
    chunks: [
      {
        chunkId: CX_CHUNK_TENSION_DEPO,
        documentId: "doc_depo_entry",
        documentVersionId: "docv_depo_entry_1",
        page: 20,
        content: "A. No. I never entered the records room that day.",
      },
      {
        chunkId: CX_CHUNK_TENSION_LOG,
        documentId: "doc_access_log",
        documentVersionId: "docv_log_1",
        page: 1,
        content: "14:47 - Badge assigned to the witness - Records Room - ACCESS GRANTED.",
      },
    ],
    expectCandidateCount: 1,
    expectRelation: "tension",
    mustIncludeSideChunkIds: [CX_CHUNK_TENSION_DEPO, CX_CHUNK_TENSION_LOG],
  },
  {
    id: "cx-direct-entered-vs-did-not",
    description: "Same-actor entered versus did not enter is a contradiction",
    kind: "generate",
    chunks: [
      {
        chunkId: CX_CHUNK_DIRECT_A,
        documentId: "doc_statement_a",
        documentVersionId: "docv_a_1",
        page: 1,
        content: "I entered the room at 3 PM.",
      },
      {
        chunkId: CX_CHUNK_DIRECT_B,
        documentId: "doc_statement_b",
        documentVersionId: "docv_b_1",
        page: 1,
        content: "I did not enter the room that day.",
      },
    ],
    expectCandidateCount: 1,
    expectRelation: "contradiction",
    mustIncludeSideChunkIds: [CX_CHUNK_DIRECT_A, CX_CHUNK_DIRECT_B],
  },
  {
    id: "cx-compatible-date-precision",
    description: "Near mid-November is compatible with an exact November date",
    kind: "generate",
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [
      {
        chunkId: CX_CHUNK_DATE_A,
        documentId: "doc_depo_date",
        documentVersionId: "docv_depo_date_1",
        page: 8,
        content: "A. The pricing issue was discussed near the middle of November, at the review meeting.",
      },
      {
        chunkId: CX_CHUNK_DATE_B,
        documentId: "doc_minutes",
        documentVersionId: "docv_minutes_1",
        page: 1,
        content: "The review meeting was held on 2026-11-10.",
      },
    ],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-sequential-amendment-not-contradiction",
    description: "Original 60-day notice versus later 30-day amendment is sequential, not a contradiction",
    kind: "generate",
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [
      {
        chunkId: CX_CHUNK_SEQ_A,
        documentId: "doc_agreement",
        documentVersionId: "docv_ag_1",
        page: 4,
        content: "The original agreement requires 60 days written notice unless amended.",
      },
      {
        chunkId: CX_CHUNK_SEQ_B,
        documentId: "doc_amendment",
        documentVersionId: "docv_am_1",
        page: 1,
        content:
          "Amendment 1 is effective on a later date. Formal notice now requires 30 days written notice.",
      },
    ],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
  {
    id: "cx-wrong-actor-not-contradiction",
    description: "One person's denial versus another person's credential activity is not a contradiction",
    kind: "generate",
    trapKind: "false_positive",
    shouldRefuse: true,
    chunks: [
      {
        chunkId: CX_CHUNK_ACTOR_A,
        documentId: "doc_depo_alice",
        documentVersionId: "docv_alice_1",
        page: 12,
        content: "Alice Nguyen testified: I never entered the records room.",
      },
      {
        chunkId: CX_CHUNK_ACTOR_B,
        documentId: "doc_log_robert",
        documentVersionId: "docv_robert_1",
        page: 1,
        content: "Badge assigned to Robert Chen — Records Room — ACCESS GRANTED.",
      },
    ],
    expectNoCandidates: true,
    expectCandidateCount: 0,
  },
];

export function contradictionCaseToPrompt(testCase: ContradictionCase): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: buildContradictionAnalysisSystemPrompt(),
    userPrompt: buildContradictionAnalysisUserPrompt({
      matterTitle: "SYNTH — Golden CAM date conflict",
      chunks: testCase.chunks,
    }),
  };
}

export const CONTRADICTION_WORKFLOW: WorkflowId = "contradiction";
