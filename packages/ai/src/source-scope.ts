import { z } from "zod";

/**
 * Explicit source boundaries for Ask / Research. Web access is never inferred from
 * prompt wording — only from this contract.
 */
export const SOURCE_SCOPES = ["case", "legal_research", "web", "case_plus_legal"] as const;
export type SourceScope = (typeof SOURCE_SCOPES)[number];

export const sourceScopeSchema = z.enum(SOURCE_SCOPES);

export type SourceScopeFlags = {
  sourceScope: SourceScope;
  /** Live internet / general web retrieval. True only for explicit `web`. */
  webEnabled: boolean;
  /** Alias kept for LEGAL RESEARCH invariant clarity. */
  generalWebEnabled: boolean;
  caseRetrievalEnabled: boolean;
  legalCorpusEnabled: boolean;
};

export function resolveSourceScopeFlags(scope: SourceScope): SourceScopeFlags {
  const webEnabled = scope === "web";
  return {
    sourceScope: scope,
    webEnabled,
    generalWebEnabled: webEnabled,
    caseRetrievalEnabled: scope === "case" || scope === "case_plus_legal",
    legalCorpusEnabled: scope === "legal_research" || scope === "case_plus_legal",
  };
}

/**
 * Fail closed if flags disagree with the declared scope (e.g. router tried to enable web
 * for Case mode).
 */
export function assertSourceScopeInvariants(flags: SourceScopeFlags): void {
  const { sourceScope, webEnabled, generalWebEnabled, caseRetrievalEnabled, legalCorpusEnabled } =
    flags;

  if (sourceScope === "case") {
    if (webEnabled || generalWebEnabled) {
      throw new SourceScopeViolationError(
        "CASE mode requires webEnabled=false; refusing silent Web Research broadening",
      );
    }
    if (!caseRetrievalEnabled) {
      throw new SourceScopeViolationError("CASE mode requires case retrieval");
    }
    if (legalCorpusEnabled) {
      throw new SourceScopeViolationError(
        "CASE mode must not silently load the legal corpus; use case_plus_legal",
      );
    }
  }

  if (sourceScope === "legal_research") {
    if (webEnabled || generalWebEnabled) {
      throw new SourceScopeViolationError(
        "LEGAL RESEARCH requires generalWebEnabled=false; refusing silent Web Research",
      );
    }
    if (!legalCorpusEnabled) {
      throw new SourceScopeViolationError("LEGAL RESEARCH requires legal corpus retrieval");
    }
    if (caseRetrievalEnabled) {
      throw new SourceScopeViolationError(
        "LEGAL RESEARCH must not silently mix case evidence; use case_plus_legal",
      );
    }
  }

  if (sourceScope === "web") {
    if (!webEnabled || !generalWebEnabled) {
      throw new SourceScopeViolationError("WEB RESEARCH requires webEnabled=true");
    }
    if (caseRetrievalEnabled || legalCorpusEnabled) {
      throw new SourceScopeViolationError(
        "WEB RESEARCH must not silently mix case evidence or legal corpus as web sources",
      );
    }
  }

  if (sourceScope === "case_plus_legal") {
    if (webEnabled || generalWebEnabled) {
      throw new SourceScopeViolationError(
        "CASE + LEGAL RESEARCH must not enable Web; select Web Research explicitly",
      );
    }
    if (!caseRetrievalEnabled || !legalCorpusEnabled) {
      throw new SourceScopeViolationError("CASE + LEGAL requires both case and corpus retrieval");
    }
  }
}

export class SourceScopeViolationError extends Error {
  readonly code = "SOURCE_SCOPE_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "SourceScopeViolationError";
  }
}

export type ProvenanceSourceCounts = {
  caseSourceCount: number;
  authoritySourceCount: number;
  webSourceCount: number;
  unresolvedConflictCount?: number;
  webRetrievedAt?: string | null;
  controllingAmendmentAffected?: boolean;
};

export type ProvenanceSummary = {
  sourceScope: SourceScope;
  headline: string;
  detail: string;
  counts: ProvenanceSourceCounts;
};

export function buildProvenanceSummary(params: ProvenanceSourceCounts & { sourceScope: SourceScope }): ProvenanceSummary {
  const {
    sourceScope,
    caseSourceCount,
    authoritySourceCount,
    webSourceCount,
    unresolvedConflictCount = 0,
    webRetrievedAt,
    controllingAmendmentAffected,
  } = params;

  const conflictBit =
    unresolvedConflictCount > 0
      ? ` · ${unresolvedConflictCount} unresolved conflict${unresolvedConflictCount === 1 ? "" : "s"}`
      : "";
  const amendmentBit = controllingAmendmentAffected ? " · Controlling amendment applied" : "";

  if (sourceScope === "case") {
    return {
      sourceScope,
      headline: "Grounded in this case",
      detail: `${caseSourceCount} case source${caseSourceCount === 1 ? "" : "s"}${conflictBit}${amendmentBit} · No external web sources`,
      counts: params,
    };
  }
  if (sourceScope === "legal_research") {
    return {
      sourceScope,
      headline: "Legal research",
      detail: `${authoritySourceCount} NyayaGrid authorit${authoritySourceCount === 1 ? "y" : "ies"} · No general web sources`,
      counts: params,
    };
  }
  if (sourceScope === "web") {
    const when = webRetrievedAt
      ? formatRetrievalDate(webRetrievedAt)
      : "Retrieved date unavailable";
    return {
      sourceScope,
      headline: "Web research",
      detail: `${webSourceCount} external source${webSourceCount === 1 ? "" : "s"} · ${when}`,
      counts: params,
    };
  }
  return {
    sourceScope,
    headline: "Case + Legal research",
    detail: `${caseSourceCount} case source${caseSourceCount === 1 ? "" : "s"} · ${authoritySourceCount} authorit${authoritySourceCount === 1 ? "y" : "ies"}${conflictBit} · No external web sources`,
    counts: params,
  };
}

function formatRetrievalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `Retrieved ${iso}`;
  return `Retrieved ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export const SOURCE_CATEGORY_LABELS = {
  case_evidence: "Case evidence",
  legal_authority: "Legal authorities",
  web: "Web",
} as const;

export type SourceCategory = keyof typeof SOURCE_CATEGORY_LABELS;
