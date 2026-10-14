/**
 * Deterministic ineligible-artifact classification for unresolved citation edges.
 * Never deletes raw citation text. Never sends artifacts to CourtListener.
 */

import {
  classifyCaseCitationLookupEligibility,
  type CitationLookupLane,
} from "./eligibility.js";
import { experimentalNormalize, normalizeCitationWhitespace } from "./normalize.js";

export type ArtifactCategory =
  | "STATUTE"
  | "RULE"
  | "REGULATION"
  | "BARE_PAGE"
  | "PIN_CITE_ONLY"
  | "YYYY_PAGE_N"
  | "RECORD_REFERENCE"
  | "EXHIBIT_REFERENCE"
  | "DOCKET_REFERENCE"
  | "SECTION_REFERENCE"
  | "OCR_MALFORMED"
  | "PARSER_MALFORMED"
  | "NON_CASE_REPORTER"
  | "OTHER_NON_CASE"
  | "CASE_LIKE_BUT_MALFORMED"
  | "UNKNOWN_ARTIFACT"
  | "NOT_ARTIFACT_CASE_LIKE";

export type ArtifactClassification = {
  category: ArtifactCategory;
  reasons: string[];
  eligibilityLane: CitationLookupLane;
  eligibleForCaseLookup: boolean;
  normalized: string;
};

function leanText(raw: string | null | undefined, normalized?: string | null): string {
  return (
    experimentalNormalize(normalized || raw) ||
    experimentalNormalize(raw) ||
    normalizeCitationWhitespace(normalized || raw || "")
  ).trim();
}

/**
 * Fine-grained artifact taxonomy for reporting/accounting.
 * Case-like eligible citations return NOT_ARTIFACT_CASE_LIKE (must not be treated as artifacts).
 */
export function classifyCitationArtifact(
  raw: string | null | undefined,
  normalized?: string | null | undefined,
): ArtifactClassification {
  const el = classifyCaseCitationLookupEligibility(raw, normalized);
  const t = leanText(raw, normalized) || el.normalized;

  // Deterministic OCR: U.S. Reports volumes far beyond published range.
  const usVol = t.match(/\b(\d{3,4})\s+U\.?\s*S\.?\s+(\d{1,4})\b/i);
  if (usVol && Number(usVol[1]) >= 650) {
    return {
      category: "OCR_MALFORMED",
      reasons: ["implausible_us_reports_volume", `volume:${usVol[1]}`],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (el.eligible) {
    return {
      category: "NOT_ARTIFACT_CASE_LIKE",
      reasons: ["case_identity_lookup_eligible", ...el.reasons],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: true,
      normalized: t,
    };
  }

  // ——— Fine-grained overrides before coarse eligibility lanes ———

  if (/^\d{4}\s+Pages?\s+\d+$/i.test(t)) {
    return {
      category: "YYYY_PAGE_N",
      reasons: ["yyyy_page_n_document_pagination"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (/^(?:at\s+)?\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/i.test(t) || /^p{1,2}\.?\s*\d{1,4}$/i.test(t)) {
    return {
      category: "PIN_CITE_ONLY",
      reasons: ["pinpoint_or_bare_page"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (/^Pages?\s+\d+/i.test(t) || /\bPage\s+\d+\b/i.test(t) && !/\bU\.?\s*S\.?\b/i.test(t)) {
    return {
      category: "BARE_PAGE",
      reasons: ["page_token_artifact"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  // Statutes vs rules vs regulations
  if (/\bU\.?\s*S\.?\s*C\.?\b/i.test(t) && /§|sec\.?/i.test(t)) {
    return {
      category: "STATUTE",
      reasons: ["usc_statute"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (/\bC\.?\s*F\.?\s*R\.?\b/i.test(t)) {
    return {
      category: "REGULATION",
      reasons: ["cfr_regulation"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (
    /^Fed\.\s*R\./i.test(t) ||
    /\bR\.\s*(?:Civ|Crim|App|Evid|Bankr)\.\s*P\b/i.test(t) ||
    /\bFed\.\s*R\.\s*(?:Civ|Crim|App|Evid|Bankr)\.\s*P\b/i.test(t)
  ) {
    return {
      category: "RULE",
      reasons: ["procedural_rule"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (/\b(?:Pa\.?\s*C\.?\s*S|Code\s*Ann|Stat\.?\s*Ann|Comp\.\s*Stat)\b/i.test(t) && /§/.test(t)) {
    return {
      category: "STATUTE",
      reasons: ["state_statute"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (/§\s*\d/.test(t) && !/\b(?:U\.?\s*S\.?|F\.?(?:\s*(?:2d|3d|4th))?|P\.?(?:\s*(?:2d|3d))?)\b/i.test(t)) {
    return {
      category: "SECTION_REFERENCE",
      reasons: ["section_symbol_non_case"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (/\bEx(?:hibit)?\.?\s*\d/i.test(t) || /^Ex\.\s*\d/i.test(t)) {
    return {
      category: "EXHIBIT_REFERENCE",
      reasons: ["exhibit_reference"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (/\b(?:ECF|Dkt\.?|Doc\.?\s*No\.?)\b/i.test(t)) {
    return {
      category: "DOCKET_REFERENCE",
      reasons: ["docket_or_ecf"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (/\b(?:R\.\s*\d+|Record\s+at\s+\d+|Tr\.\s*\d+)/i.test(t)) {
    return {
      category: "RECORD_REFERENCE",
      reasons: ["record_transcript_reference"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (/\b(?:Am\.\s*Jur|C\.J\.S\.|A\.L\.R\.|Wright\s*&\s*Miller|Moore.?s\s*Federal)\b/i.test(t)) {
    return {
      category: "NON_CASE_REPORTER",
      reasons: ["secondary_source"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  // OCR / parser malformations
  if (/[|]{2,}|\uFFFD|{[^}]{0,8}$|^[^[{]*}/.test(t) || /\d{4}\s+U\.?\s*S\.?\s+\d{4,}/.test(t)) {
    return {
      category: "OCR_MALFORMED",
      reasons: ["ocr_garbage_or_implausible_us_volume"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (el.reasons.includes("empty_or_too_short") || el.reasons.includes("non_reporter_token")) {
    return {
      category: "PARSER_MALFORMED",
      reasons: el.reasons,
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }
  if (el.reasons.includes("year_volume_bare_word_likely_artifact") || el.reasons.includes("reporter_token_page")) {
    return {
      category: "PARSER_MALFORMED",
      reasons: el.reasons,
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  // Case-like shape but malformed / unknown reporter — not a confirmed case identity target
  if (el.lane === "MALFORMED_CASE_REFERENCE" || el.lane === "UNKNOWN_REVIEW") {
    const looksCaseLike = /^\d{1,4}\s+[A-Za-z]/.test(t) || /\b(?:U\.?\s*S\.?|F\.|P\.|A\.|So\.)\b/i.test(t);
    return {
      category: looksCaseLike ? "CASE_LIKE_BUT_MALFORMED" : "UNKNOWN_ARTIFACT",
      reasons: el.reasons.length ? el.reasons : ["ineligible_unknown"],
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (el.lane === "NON_CASE_REFERENCE") {
    return {
      category: "OTHER_NON_CASE",
      reasons: el.reasons,
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (el.lane === "STATUTE_RULE_REGULATION") {
    return {
      category: "STATUTE",
      reasons: el.reasons,
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  if (el.lane === "PIN_CITE_ONLY") {
    return {
      category: "PIN_CITE_ONLY",
      reasons: el.reasons,
      eligibilityLane: el.lane,
      eligibleForCaseLookup: false,
      normalized: t,
    };
  }

  return {
    category: "UNKNOWN_ARTIFACT",
    reasons: el.reasons.length ? el.reasons : ["unclassified_ineligible"],
    eligibilityLane: el.lane,
    eligibleForCaseLookup: false,
    normalized: t,
  };
}

export function isArtifactCategory(category: ArtifactCategory): boolean {
  return category !== "NOT_ARTIFACT_CASE_LIKE";
}
