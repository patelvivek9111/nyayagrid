/**
 * Live-6 Case Q&A payloads that failed Zod before source-id backfill.
 * Captured from docs/agent-quality-review/exports-live-6 (repeats were identical).
 */
export const LIVE6_COMBINE_RENT_AND_TERM = {
  answer: "The monthly base rent is $4,000 and the lease term commences on January 1, 2024.",
  sources: [
    {
      chunkId: "chunk_lease_rent",
      quote:
        "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.",
    },
    {
      chunkId: "chunk_lease_term",
      quote:
        "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};

export const LIVE6_COMBINE_NOTICE_AND_TERM = {
  answer:
    "The lease expires on December 31, 2026, and thirty (30) days written notice is required to terminate.",
  sources: [
    {
      chunkId: "chunk_lease_term",
      quote:
        "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.",
    },
    {
      chunkId: "chunk_lease_notice",
      quote:
        "Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};

export const LIVE6_COMBINE_DISPUTE_AND_LATE_FEE = {
  answer:
    "Tenant disputed the February CAM reconciliation on March 14, 2025, and a delinquency charge of five hundred dollars ($500) applies if payment is more than five days overdue.",
  sources: [
    {
      chunkId: "chunk_email_dispute",
      quote:
        "On March 14, 2025, Tenant disputed the February CAM reconciliation and requested supporting invoices within ten business days.",
    },
    {
      chunkId: "chunk_late_fee",
      quote:
        "A delinquency charge of five hundred dollars ($500) applies if payment is more than five days overdue.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};

export const LIVE6_COMBINE_RENEWAL_AND_EXPIRATION = {
  answer:
    "The lease expires on December 31, 2026, and Tenant must give sixty (60) days written notice to renew for an additional year.",
  sources: [
    {
      chunkId: "chunk_lease_term",
      quote:
        "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.",
    },
    {
      chunkId: "chunk_renewal_notice",
      quote:
        "Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};

export const LIVE6_NEAR_MISS_TERM_SHEET_RENT = {
  answer: "$4,000 Base Rent",
  sources: [
    {
      chunkId: "chunk_lease_rent",
      quote:
        "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};

export const LIVE6_RENT_VS_LATE_FEE_REPEAT2 = {
  answer: "$4,000",
  sources: [
    {
      chunkId: "chunk_lease_rent",
      quote:
        "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.",
    },
  ],
  assumptions: [] as string[],
  unresolvedQuestions: [] as string[],
  evidenceState: "grounded",
};
