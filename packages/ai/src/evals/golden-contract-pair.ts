/**
 * Second synthetic contract pair for CC-01..CC-05 graded evals.
 *
 * Original + redline with planted material changes and decoy non-material edits.
 * Not a real agreement.
 */
export const GOLDEN_CONTRACT_PAIR_ID = "golden_synth_msa_redline_v1";

export const GOLDEN_CONTRACT_ORIGINAL = [
  "SYNTH — Master Services Agreement (Original).",
  "This Synthetic Master Services Agreement is entered into by Acme Corp and Beta LLC.",
  "The term begins on January 1, 2024 and expires on December 31, 2026.",
  "Customer shall pay fees of four thousand dollars ($4,000) per month.",
  "Customer shall pay twelve percent (12%) of operating expenses as a shared-cost allocation.",
  "Vendor shall indemnify Customer for all claims without limitation.",
  "Either party may terminate this agreement by providing thirty (30) days written notice.",
  "Vendor warrants quiet enjoyment of the licensed materials.",
  "Customer shall not assign this agreement without Vendor's sole discretion consent.",
  "Customer shall maintain insurance of one million dollars ($1,000,000).",
  "Notices shall be delivered to the address listed on the cover page.",
  "This heading is labelled Recitals.",
  "The parties are Acme Corp and Beta LLC.",
  "This counterpart page is part of the synthetic agrement packet.",
  "Section 16 is reserved.",
  "Notices may recieve electronic copies as a courtesy.",
  "Governing law is the law of the State named on the cover, without regard to conflicts principles.",
  "Exhibit 1 lists the statements of work.",
].join("\n\n");

export const GOLDEN_CONTRACT_REDLINE = [
  "SYNTH — Master Services Agreement (Redline).",
  "This Synthetic Master Services Agreement is entered into by Acme Corp and Beta LLC.",
  "The term begins on January 1, 2024 and expires on December 31, 2027.",
  "Customer shall pay fees of four thousand five hundred dollars ($4,500) per month.",
  "Customer shall pay fifteen percent (15%) of operating expenses as a shared-cost allocation.",
  "Vendor shall indemnify Customer only for third-party claims arising from Vendor's negligence, and not for Customer's sole negligence.",
  "Either party may terminate this agreement by providing sixty (60) days written notice.",
  "Vendor provides the licensed materials as is, without warranty of quiet enjoyment.",
  "Customer shall not assign this agreement without Vendor's reasonable consent.",
  "Customer shall maintain insurance of two million dollars ($2,000,000).",
  "Notices shall be delivered to the address listed on the cover page.",
  "This heading is labeled Recitals.",
  "The parties are Acme Corp and Beta LLC.",
  "This counterpart page is part of the synthetic agreement packet.",
  "Section 16.0 is reserved.",
  "Notices may receive electronic copies as a courtesy.",
  "Governing law is the law of the State named on the cover,\nwithout regard to conflicts principles.",
  "Exhibit I lists the statements of work.",
].join("\n\n");

/** Needles that must appear in some diff old/new text for the 8 planted material changes. */
export const PLANTED_MATERIAL_NEEDLES = [
  "December 31, 2027",
  "$4,500",
  "fifteen percent",
  "Vendor's negligence",
  "sixty (60) days",
  "as is",
  "reasonable consent",
  "$2,000,000",
] as const;

/** Decoy (non-material) needles — typo / spelling / numbering / reformat / identical substance. */
export const DECOY_NEEDLES = [
  "labelled",
  "labeled",
  "agrement",
  "agreement packet",
  "Section 16",
  "recieve",
  "without regard to conflicts principles",
  "Exhibit 1",
] as const;

export const CLOSEST_MATCH_LIMITATION_NEEDLE = "closest match only";
