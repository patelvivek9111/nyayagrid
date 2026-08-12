import type { ImportAuthorityInput } from "./ingest";

/**
 * Synthetic authorities for tests and local development.
 *
 * Every name, citation, court, and jurisdiction here is deliberately fictional (Acme, Contoso,
 * year 2099, "Synthetic Jurisdiction") so no test fixture can ever be mistaken for real law.
 */
export const SYNTHETIC_SOURCE_PROVIDER = "synthetic-fixtures";

export const SYNTHETIC_CASE_CITATION = "999 F.3d 1";
export const SYNTHETIC_STATUTE_CITATION = "Synthetic Jurisdiction Code § 100";

export const syntheticCaseAuthority: ImportAuthorityInput = {
  title: "Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099)",
  shortTitle: "Acme v. Contoso",
  authorityType: "case",
  jurisdiction: "Synthetic Federal",
  court: "Synthetic Court of Appeals",
  citation: "999 F.3d 1",
  docketNumber: "SYN-2099-0001",
  decisionDate: "2099-04-01",
  publicationStatus: "published",
  sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
  sourceExternalId: "acme-v-contoso-999-f3d-1",
  canonicalSourceUrl: "https://example.invalid/synthetic/acme-v-contoso",
  content: [
    "Acme Corp. v. Contoso Ltd., 999 F.3d 1 (Fed. Cir. 2099).",
    "",
    "This synthetic opinion exists only to exercise ingestion, chunking, and retrieval. A party seeking a preliminary injunction under Synthetic Jurisdiction Code § 100 must show a likelihood of success on the merits and irreparable harm that money damages cannot cure.",
    "",
    "The panel below applied the wrong standard when it treated commercial inconvenience as irreparable harm. Irreparable harm requires an injury that cannot be remedied by a later award of damages, and the record here shows only lost revenue that is fully compensable.",
    "",
    "We therefore vacate the injunction and remand for application of the correct standard as described in 42 Synth. Reg. Code § 7 and in the two-part test recited above.",
  ].join("\n"),
  opinionParts: [
    {
      part: "majority",
      content: [
        "A party seeking a preliminary injunction under Synthetic Jurisdiction Code § 100 must show a likelihood of success on the merits and irreparable harm that money damages cannot cure.",
        "",
        "Irreparable harm requires an injury that cannot be remedied by a later award of damages. Lost revenue that is fully compensable does not satisfy this requirement.",
      ].join("\n"),
    },
    {
      part: "dissent",
      content: [
        "I would affirm. In my view, the majority reads the irreparable-harm requirement of Synthetic Jurisdiction Code § 100 too narrowly, and the loss of an exclusive distribution channel is not fully compensable in damages.",
      ].join("\n"),
    },
  ],
  metadata: { synthetic: true },
};

export const syntheticStatuteAuthority: ImportAuthorityInput = {
  title: "Synthetic Jurisdiction Code § 100 — Preliminary Injunctions",
  shortTitle: "SJC § 100",
  authorityType: "statute",
  jurisdiction: "Synthetic Jurisdiction",
  citation: "Synthetic Jurisdiction Code § 100",
  effectiveDate: "2095-01-01",
  effectiveFrom: "2095-01-01",
  sourceProvider: SYNTHETIC_SOURCE_PROVIDER,
  sourceExternalId: "synthetic-jurisdiction-code-100",
  hierarchyPath: [
    { level: "title", ref: "IV", label: "Civil Remedies" },
    { level: "chapter", ref: "3", label: "Provisional Relief" },
    { level: "section", ref: "100", label: "Preliminary Injunctions" },
  ],
  content: [
    "Synthetic Jurisdiction Code § 100. Preliminary injunctions.",
    "",
    "(a) A court may grant a preliminary injunction only on a showing of a likelihood of success on the merits and irreparable harm.",
    "",
    "(b) Irreparable harm does not include harm that can be fully remedied by an award of money damages.",
    "",
    "(c) The court shall state the findings that support the grant or denial of relief under this section.",
  ].join("\n"),
  sections: [
    {
      sectionRef: "100",
      subsectionRef: "a",
      content:
        "A court may grant a preliminary injunction only on a showing of a likelihood of success on the merits and irreparable harm.",
    },
    {
      sectionRef: "100",
      subsectionRef: "b",
      content:
        "Irreparable harm does not include harm that can be fully remedied by an award of money damages.",
    },
    {
      sectionRef: "100",
      subsectionRef: "c",
      content:
        "The court shall state the findings that support the grant or denial of relief under this section.",
    },
  ],
  metadata: { synthetic: true },
};

export const syntheticAuthorityFixtures: ImportAuthorityInput[] = [
  syntheticStatuteAuthority,
  syntheticCaseAuthority,
];

/** Quote taken verbatim from the synthetic statute, for quote-validation tests. */
export const SYNTHETIC_VALID_QUOTE =
  "Irreparable harm does not include harm that can be fully remedied by an award of money damages.";

/** Plausible-sounding but fabricated quote that quote validation must reject. */
export const SYNTHETIC_FABRICATED_QUOTE =
  "Irreparable harm is presumed whenever a distribution agreement is terminated.";
