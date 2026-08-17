/**
 * Synthetic golden matter for graded Case Q&A evals.
 *
 * All text is clearly synthetic — never presents as real authority or case law.
 * Labels describe what a perfect retrieval/answer should cover.
 */
import type { GroundingPassage } from "../index";

export type GoldenPassage = GroundingPassage & {
  documentTitle: string;
  labels: string[];
};

/** Synthetic commercial lease dispute (NyayaGrid eval corpus — not a real matter). */
export const GOLDEN_MATTER_ID = "golden_synth_lease_v1";

export const GOLDEN_PASSAGES: GoldenPassage[] = [
  {
    chunkId: "chunk_lease_term",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    page: 2,
    segmentRef: "§3",
    documentTitle: "SYNTH — Master Lease Agreement",
    labels: ["lease_term", "commencement"],
    quote:
      "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.",
  },
  {
    chunkId: "chunk_lease_rent",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    page: 3,
    segmentRef: "§4.1",
    documentTitle: "SYNTH — Master Lease Agreement",
    labels: ["rent", "payment"],
    quote:
      "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.",
  },
  {
    chunkId: "chunk_lease_notice",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    page: 11,
    segmentRef: "§12.2",
    documentTitle: "SYNTH — Master Lease Agreement",
    labels: ["termination_notice"],
    quote:
      "Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15.",
  },
  {
    chunkId: "chunk_amend_indemnity",
    documentId: "doc_amendment",
    documentVersionId: "docv_amend_1",
    page: 1,
    segmentRef: "¶2",
    documentTitle: "SYNTH — First Amendment",
    labels: ["indemnity", "amendment"],
    quote:
      "Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence, and not for Landlord's sole negligence.",
  },
  {
    chunkId: "chunk_email_dispute",
    documentId: "doc_email",
    documentVersionId: "docv_email_1",
    page: 1,
    segmentRef: null,
    documentTitle: "SYNTH — Email from Tenant counsel",
    labels: ["dispute_date", "communication"],
    quote:
      "On March 14, 2025, Tenant disputed the February CAM reconciliation and requested supporting invoices within ten business days.",
  },
  {
    chunkId: "chunk_depo_cam",
    documentId: "doc_depo",
    documentVersionId: "docv_depo_1",
    page: 44,
    segmentRef: "44:12-44:20",
    documentTitle: "SYNTH — Deposition of Property Manager",
    labels: ["cam", "deposition", "contradiction_side_a"],
    quote:
      "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.",
  },
  {
    chunkId: "chunk_email_receipt",
    documentId: "doc_email_pm",
    documentVersionId: "docv_email_pm_1",
    page: 1,
    segmentRef: null,
    documentTitle: "SYNTH — Email from Property Manager",
    labels: ["cam", "contradiction_side_b"],
    quote:
      "Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.",
  },
  {
    chunkId: "chunk_late_fee",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    page: 3,
    segmentRef: "§4.3",
    documentTitle: "SYNTH — Master Lease Agreement",
    labels: ["late_fee", "payment", "similar_clause"],
    quote:
      "A delinquency charge of five hundred dollars ($500) applies if payment is more than five days overdue.",
  },
  {
    chunkId: "chunk_renewal_notice",
    documentId: "doc_lease",
    documentVersionId: "docv_lease_1",
    page: 12,
    segmentRef: "§13.1",
    documentTitle: "SYNTH — Master Lease Agreement",
    labels: ["renewal", "similar_clause"],
    quote:
      "Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date.",
  },
  {
    chunkId: "chunk_cam_estimate",
    documentId: "doc_email_pm",
    documentVersionId: "docv_email_pm_1",
    page: 1,
    segmentRef: null,
    documentTitle: "SYNTH — Email from Property Manager",
    labels: ["near_miss_date"],
    quote:
      "Separately, the estimated February CAM worksheet was prepared internally on February 15, 2025, and is not a transmittal to Tenant.",
  },
];

export function passagesByLabels(...labels: string[]): GroundingPassage[] {
  const wanted = new Set(labels);
  return GOLDEN_PASSAGES.filter((p) => p.labels.some((l) => wanted.has(l))).map(
    ({ documentTitle: _t, labels: _l, ...passage }) => passage,
  );
}

export function passageByChunkId(chunkId: string): GroundingPassage | undefined {
  const found = GOLDEN_PASSAGES.find((p) => p.chunkId === chunkId);
  if (!found) return undefined;
  const { documentTitle: _t, labels: _l, ...passage } = found;
  return passage;
}

/** One uploadable .txt body derived from golden passages (manual demo + seed + e2e). */
export type GoldenFixtureDocument = {
  documentKey: string;
  filename: string;
  title: string;
  body: string;
};

function titleToFixtureFilename(title: string): string {
  return `${title
    .replace(/^SYNTH —\s*/i, "SYNTH-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}.txt`;
}

/**
 * Build SYNTH .txt documents from `GOLDEN_PASSAGES` (single source of truth).
 * Files under `golden-fixtures/` must match these bodies.
 * The default corpus also includes the party roster for People onboarding.
 */
const GOLDEN_PARTY_ROSTER: GoldenFixtureDocument = {
  documentKey: "doc_party_roster",
  filename: "synth-party-roster.txt",
  title: "SYNTH — Party roster",
  body: [
    "# SYNTH — Party roster",
    "",
    "SYNTHETIC EVAL FIXTURE — not a real legal authority, docket, or matter.",
    `Corpus: ${GOLDEN_MATTER_ID}`,
    "",
    "This Synthetic Assignment Agreement was signed on March 4, 2026 by Jordan Lee on behalf of Acme Corp.",
    "",
  ].join("\n"),
};

export function buildGoldenFixtureDocuments(
  passages: GoldenPassage[] = GOLDEN_PASSAGES,
): GoldenFixtureDocument[] {
  const byDoc = new Map<string, GoldenPassage[]>();
  for (const passage of passages) {
    const list = byDoc.get(passage.documentId) ?? [];
    list.push(passage);
    byDoc.set(passage.documentId, list);
  }

  const passageDocs = [...byDoc.entries()].map(([documentKey, docs]) => {
    const title = docs[0]!.documentTitle;
    const sections = docs.map((p) => {
      const loc =
        p.segmentRef != null
          ? `${p.segmentRef}${p.page != null ? ` · p.${p.page}` : ""}`
          : p.page != null
            ? `p.${p.page}`
            : "excerpt";
      return `[${loc}]\n${p.quote}`;
    });
    const body = [
      `# ${title}`,
      "",
      "SYNTHETIC EVAL FIXTURE — not a real legal authority, docket, or matter.",
      `Corpus: ${GOLDEN_MATTER_ID}`,
      "",
      ...sections.flatMap((s) => [s, ""]),
    ].join("\n");
    return {
      documentKey,
      filename: titleToFixtureFilename(title),
      title,
      body,
    };
  });

  if (passages === GOLDEN_PASSAGES) {
    return [...passageDocs, GOLDEN_PARTY_ROSTER];
  }
  return passageDocs;
}
