/**
 * Case-citation external lookup eligibility gate.
 * Reclassifies resolution lane only — never deletes raw extraction evidence.
 */

import {
  experimentalNormalize,
  normalizeCitationWhitespace,
  parseVolReporterPage,
} from "./normalize.js";

/** Resolution-lane classification for unresolved citation targets. */
export type CitationLookupLane =
  | "CASE_IDENTITY_LOOKUP_ELIGIBLE"
  | "NON_CASE_REFERENCE"
  | "MALFORMED_CASE_REFERENCE"
  | "PIN_CITE_ONLY"
  | "STATUTE_RULE_REGULATION"
  | "UNKNOWN_REVIEW";

export type CaseCitationEligibility = {
  eligible: boolean;
  lane: CitationLookupLane;
  reasons: string[];
  reporterFamily: string | null;
  volume: number | null;
  page: number | null;
  normalized: string;
};

/** Words that match the loose extractor catch-all but are not reporters. */
const NON_REPORTER_TOKENS = new Set(
  [
    "page",
    "pages",
    "id",
    "ibid",
    "supra",
    "see",
    "cf",
    "but",
    "and",
    "the",
    "at",
    "of",
    "in",
    "to",
    "for",
    "note",
    "notes",
    "vol",
    "doc",
    "ex",
    "exh",
    "exhibit",
    "ecf",
    "docket",
    "record",
    "app",
    "cir",
    "dist",
    "no",
    "nos",
    "slip",
    "op",
    "opin",
    "para",
    "section",
    "sec",
    "ch",
    "chapter",
    "art",
    "article",
    "fn",
    "n",
  ].map((s) => s.toLowerCase()),
);

/**
 * Recognized official / regional / historical reporters for CourtListener case lookup.
 * Includes common state names used as official reporters (Idaho, Oregon, etc.).
 */
const RECOGNIZED_REPORTER =
  /^(?:U\.?\s*S\.?|S\.?\s*Ct\.?|L\.?\s*Ed\.?(?:\s*2d)?|F\.?(?:\s*(?:2d|3d|4th))?|F\.?\s*Supp\.?(?:\s*(?:2d|3d))?|A\.?(?:\s*(?:2d|3d))?|P\.?(?:\s*(?:2d|3d))?|N\.?\s*E\.?(?:\s*(?:2d|3d))?|N\.?\s*W\.?(?:\s*(?:2d|3d))?|S\.?\s*E\.?(?:\s*(?:2d|3d))?|S\.?\s*W\.?(?:\s*(?:2d|3d))?|So\.?(?:\s*(?:2d|3d))?|Wall\.?|How\.?|Pet\.?|Cranch|Dallas|Black|Idaho|Or\.?|N\.?\s*H\.?|N\.?\s*J\.?|N\.?\s*Y\.?(?:\s*(?:2d|3d|S\.?\s*2d))?|Cal\.?(?:\s*(?:2d|3d|4th|App\.?(?:\s*(?:2d|3d|4th))?))?|Ill\.?(?:\s*(?:2d|App\.?(?:\s*2d|3d)?))?|Mass\.?|Pa\.?(?:\s*(?:Super\.?|Cmwlth\.?))?|Tex\.?(?:\s*(?:App\.?|Civ\.?\s*App\.?))?|Ohio\s*St\.?(?:\s*2d|3d)?|Mich\.?(?:\s*App\.?)?|Fla\.?(?:\s*(?:2d|3d|App\.?))?|Ga\.?(?:\s*App\.?)?|Va\.?(?:\s*App\.?)?|Wash\.?(?:\s*(?:2d|App\.?))?|Minn\.?|Wis\.?(?:\s*2d)?|Kan\.?(?:\s*App\.?\s*2d)?|Okla\.?|Ark\.?(?:\s*App\.?)?|Ala\.?(?:\s*App\.?)?|Tenn\.?(?:\s*App\.?)?|Ky\.?|Ind\.?(?:\s*App\.?)?|Conn\.?(?:\s*App\.?)?|Md\.?(?:\s*App\.?)?|Mo\.?(?:\s*App\.?)?|Colo\.?(?:\s*App\.?)?|Ariz\.?(?:\s*App\.?)?)$/i;

const NEUTRAL_CITATION =
  /^(?:19|20)\d{2}\s+(?:ND|SD|OK|NM|WY|MT|KS|NE|IA|WI|MN|AK|HI|OH|UT|VT|ME|NH|NV|ID|DE|RI|SC|NC|WV|MT|WI)\s+\d{1,4}$/i;

const VRP_LOOSE =
  /^(\d{1,4})\s+([A-Za-z][A-Za-z.]{0,20}?)\s*(?:2d|3d|4th|App\.?)?\s+(\d{1,4})$/i;

function reporterToken(rawReporter: string): string {
  return rawReporter.replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function isYearLikeVolume(volume: number): boolean {
  return volume >= 1900 && volume <= 2100;
}

/**
 * Classify whether a citation string may enter the CourtListener case-identity lane.
 * Preserves raw evidence elsewhere; this only gates external case lookup.
 */
export function classifyCaseCitationLookupEligibility(
  raw: string | null | undefined,
  normalized?: string | null | undefined,
): CaseCitationEligibility {
  const reasons: string[] = [];
  const lean =
    experimentalNormalize(normalized || raw) ||
    experimentalNormalize(raw) ||
    normalizeCitationWhitespace(normalized || raw || "");
  const t = lean.trim();

  if (!t || t.length < 5) {
    return {
      eligible: false,
      lane: "MALFORMED_CASE_REFERENCE",
      reasons: ["empty_or_too_short"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  if (/^(id\.?|ibid\.?|supra)\b/i.test(t)) {
    return {
      eligible: false,
      lane: "NON_CASE_REFERENCE",
      reasons: ["short_form_signal"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  // Pinpoint-only / bare page
  if (/^(?:at\s+)?\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/i.test(t) || /^p{1,2}\.?\s*\d{1,4}$/i.test(t)) {
    return {
      eligible: false,
      lane: "PIN_CITE_ONLY",
      reasons: ["pinpoint_or_bare_page"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  // Document pagination artifacts: "2026 Page 2"
  if (/^\d{4}\s+Pages?\s+\d+$/i.test(t)) {
    return {
      eligible: false,
      lane: "MALFORMED_CASE_REFERENCE",
      reasons: ["yyyy_page_n_document_pagination"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  // Statutes / regs / rules
  if (/\bU\.?\s*S\.?\s*C\.?\s*§/i.test(t) || /\bC\.?\s*F\.?\s*R\.?\s*§/i.test(t) || /^Fed\.\s*R\./i.test(t)) {
    return {
      eligible: false,
      lane: "STATUTE_RULE_REGULATION",
      reasons: ["statute_regulation_or_federal_rule"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }
  if (/\b(?:Pa\.?\s*C\.?\s*S|R\.\s*Civ\.\s*P|R\.\s*Evid|Code\s*Ann|Stat\.?\s*Ann|Comp\.\s*Stat)\b/i.test(t) && /§/.test(t)) {
    return {
      eligible: false,
      lane: "STATUTE_RULE_REGULATION",
      reasons: ["state_statute_or_rule"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  // Secondary / record / ECF
  if (/\b(?:Am\.\s*Jur|C\.J\.S\.|A\.L\.R\.|Wright\s*&\s*Miller|Moore.?s\s*Federal)\b/i.test(t)) {
    return {
      eligible: false,
      lane: "NON_CASE_REFERENCE",
      reasons: ["secondary_source"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }
  if (/\b(?:ECF|Dkt\.?|Doc\.?\s*No\.?|Ex(?:hibit)?\.?\s*\d)\b/i.test(t)) {
    return {
      eligible: false,
      lane: "NON_CASE_REFERENCE",
      reasons: ["record_ecf_or_exhibit"],
      reporterFamily: null,
      volume: null,
      page: null,
      normalized: t,
    };
  }

  // Structured federal / parallel via existing parser
  const parsed = parseVolReporterPage(t);
  if (parsed) {
    if (/^page$/i.test(parsed.reporter)) {
      return {
        eligible: false,
        lane: "MALFORMED_CASE_REFERENCE",
        reasons: ["reporter_token_page"],
        reporterFamily: parsed.family,
        volume: parsed.volume,
        page: parsed.page,
        normalized: t,
      };
    }
    reasons.push("recognized_federal_or_parallel_vrp");
    return {
      eligible: true,
      lane: "CASE_IDENTITY_LOOKUP_ELIGIBLE",
      reasons,
      reporterFamily: parsed.family,
      volume: parsed.volume,
      page: parsed.page,
      normalized: t,
    };
  }

  // Neutral citations
  if (NEUTRAL_CITATION.test(t)) {
    reasons.push("recognized_neutral_citation");
    const m = t.match(/^(?:19|20)\d{2}\s+([A-Z]{2})\s+(\d{1,4})$/i);
    return {
      eligible: true,
      lane: "CASE_IDENTITY_LOOKUP_ELIGIBLE",
      reasons,
      reporterFamily: m ? `neutral_${m[1]!.toUpperCase()}` : "neutral",
      volume: m ? Number(t.slice(0, 4)) : null,
      page: m ? Number(m[2]) : null,
      normalized: t,
    };
  }

  // Loose VRP with recognized reporter token
  const loose = t.match(VRP_LOOSE);
  if (loose) {
    const volume = Number(loose[1]);
    const reporter = reporterToken(loose[2] || "");
    const page = Number(loose[3]);
    const tokenKey = reporter.toLowerCase().replace(/\./g, "");

    if (NON_REPORTER_TOKENS.has(reporter.toLowerCase()) || NON_REPORTER_TOKENS.has(tokenKey)) {
      return {
        eligible: false,
        lane: "MALFORMED_CASE_REFERENCE",
        reasons: ["non_reporter_token", `token:${reporter}`],
        reporterFamily: null,
        volume,
        page,
        normalized: t,
      };
    }

    // Year-like volume + bare word without periods often = pagination / header junk
    if (isYearLikeVolume(volume) && !/\./.test(reporter) && reporter.length <= 6) {
      const knownStateName = /^(Idaho|Oregon|Ohio|Iowa|Utah|Maine|Texas|Kansas|Alaska|Hawaii)$/i.test(
        reporter,
      );
      if (!knownStateName) {
        return {
          eligible: false,
          lane: "MALFORMED_CASE_REFERENCE",
          reasons: ["year_volume_bare_word_likely_artifact", `token:${reporter}`],
          reporterFamily: null,
          volume,
          page,
          normalized: t,
        };
      }
    }

    if (RECOGNIZED_REPORTER.test(reporter) || RECOGNIZED_REPORTER.test(`${reporter}.`)) {
      reasons.push("recognized_reporter_vrp");
      return {
        eligible: true,
        lane: "CASE_IDENTITY_LOOKUP_ELIGIBLE",
        reasons,
        reporterFamily: reporter,
        volume,
        page,
        normalized: t,
      };
    }

    // Unknown reporter shape — review, do not auto-queue for bulk CL
    return {
      eligible: false,
      lane: "UNKNOWN_REVIEW",
      reasons: ["unrecognized_reporter_token", `token:${reporter}`],
      reporterFamily: reporter,
      volume,
      page,
      normalized: t,
    };
  }

  return {
    eligible: false,
    lane: "UNKNOWN_REVIEW",
    reasons: ["no_case_citation_structure"],
    reporterFamily: null,
    volume: null,
    page: null,
    normalized: t,
  };
}

export function isCaseCitationLookupEligible(
  raw: string | null | undefined,
  normalized?: string | null | undefined,
): boolean {
  return classifyCaseCitationLookupEligibility(raw, normalized).eligible;
}

/** Strategic exception signals for below-threshold edge demand. */
export function isStrategicIdentityException(input: {
  edgeCount: number;
  jurisdictions?: string[];
  priorityScore?: number;
  normalizedCitation?: string;
}): boolean {
  const j = (input.jurisdictions || []).join(" ").toLowerCase();
  if (/us-ca-3|ca3|third/.test(j)) return true;
  if (/us-d-pa|paed|edpa/.test(j)) return true;
  if (/st-pa|pennsylvania/.test(j) && Number(input.priorityScore || 0) >= 40) return true;
  if (/us-scotus|scotus/.test(j) && Number(input.priorityScore || 0) >= 45) return true;
  if (Number(input.priorityScore || 0) >= 55) return true;
  return false;
}

export type DemandLanePolicy = "BULK_IDENTITY" | "STRATEGIC_LOOKUP" | "DEFER" | "LOCAL_ONLY_WAIT" | "NO_BULK";

export function classifyDemandLanePolicy(input: {
  eligible: boolean;
  edgeCount: number;
  jurisdictions?: string[];
  priorityScore?: number;
  localCandidateStatus?: string;
}): DemandLanePolicy {
  if (!input.eligible) return "NO_BULK";
  if (input.edgeCount >= 5) return "BULK_IDENTITY";
  const strategic = isStrategicIdentityException(input);
  if (input.edgeCount >= 3) {
    if (strategic) return "STRATEGIC_LOOKUP";
    if (input.localCandidateStatus && input.localCandidateStatus !== "NO_LOCAL_MATCH") {
      return "LOCAL_ONLY_WAIT";
    }
    return "DEFER";
  }
  if (strategic) return "STRATEGIC_LOOKUP";
  return "NO_BULK";
}
