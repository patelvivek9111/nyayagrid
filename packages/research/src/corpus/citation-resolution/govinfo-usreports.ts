/**
 * Deterministic U.S. Reports identity lookup via GovInfo (GPO) public API / content URLs.
 * ZERO CourtListener. Auto-resolve only exact volume+page granule matches with CASE class.
 */

import { experimentalNormalize, parseVolReporterPage } from "./normalize.js";

export const GOVINFO_USREPORTS_PROVIDER = "US_SUPREME_COURT_OFFICIAL" as const;
export const GOVINFO_SOURCE_LABEL = "GOVINFO_USREPORTS" as const;

export type OfficialIdentityConfidence =
  | "OFFICIAL_EXACT_MATCH"
  | "OFFICIAL_NORMALIZED_MATCH"
  | "OFFICIAL_PARALLEL_MATCH"
  | "OFFICIAL_AMBIGUOUS"
  | "OFFICIAL_NOT_FOUND"
  | "OFFICIAL_UNSUPPORTED";

export type GovInfoUsReportsLookupResult = {
  rawCitation: string;
  normalizedCitation: string | null;
  sourceProvider: typeof GOVINFO_USREPORTS_PROVIDER;
  sourceLabel: typeof GOVINFO_SOURCE_LABEL;
  providerCaseId: string | null;
  canonicalCitation: string | null;
  caseName: string | null;
  court: string | null;
  date: string | null;
  sourceUrl: string | null;
  pdfUrl: string | null;
  identityConfidence: OfficialIdentityConfidence;
  evidence: string[];
  volume: number | null;
  page: number | null;
};

export type GovInfoFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type GovInfoUsReportsClientOptions = {
  apiKey?: string;
  fetchImpl?: GovInfoFetch;
  /** When true, also require granuleClass=CASE from API summary (recommended for writes). */
  requireCaseClass?: boolean;
  /** Minimum PDF Content-Length to treat HEAD as existence proof when skipping summary. */
  minPdfBytes?: number;
  userAgent?: string;
};

const DEFAULT_UA = "NyayaGridCorpusIdentityProbe/1.0 (+research; identity-only; no scraping)";

function isUsReporter(reporter: string): boolean {
  const r = reporter.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return r === "us" || r === "u.s" || r === "unitedstates";
}

export function parseUsReportsCitation(raw: string | null | undefined): { volume: number; page: number; normalized: string } | null {
  const seed = experimentalNormalize(raw) || String(raw || "").trim();
  if (!seed) return null;
  const parsed = parseVolReporterPage(seed);
  if (!parsed || !isUsReporter(parsed.reporter) || !Number.isFinite(parsed.volume) || !Number.isFinite(parsed.page)) {
    // Explicit U.S. pattern fallback (handles "573 U. S. 373")
    const m = seed.match(/\b(\d+)\s+U\.?\s*S\.?\s+(\d+)\b/i);
    if (!m) return null;
    return { volume: Number(m[1]), page: Number(m[2]), normalized: `${m[1]} U.S. ${m[2]}` };
  }
  return { volume: parsed.volume, page: parsed.page, normalized: `${parsed.volume} U.S. ${parsed.page}` };
}

export function govInfoUsReportsIds(volume: number, page: number): {
  packageId: string;
  granuleId: string;
  detailsUrl: string;
  pdfUrl: string;
  summaryUrl: (apiKey: string) => string;
} {
  const packageId = `USREPORTS-${volume}`;
  const granuleId = `USREPORTS-${volume}-${page}`;
  return {
    packageId,
    granuleId,
    detailsUrl: `https://www.govinfo.gov/app/details/${packageId}/${granuleId}`,
    pdfUrl: `https://www.govinfo.gov/content/pkg/${packageId}/pdf/${granuleId}.pdf`,
    summaryUrl: (apiKey: string) =>
      `https://api.govinfo.gov/packages/${packageId}/granules/${granuleId}/summary?api_key=${encodeURIComponent(apiKey)}`,
  };
}

function unsupported(raw: string, reasons: string[]): GovInfoUsReportsLookupResult {
  return {
    rawCitation: raw,
    normalizedCitation: experimentalNormalize(raw),
    sourceProvider: GOVINFO_USREPORTS_PROVIDER,
    sourceLabel: GOVINFO_SOURCE_LABEL,
    providerCaseId: null,
    canonicalCitation: null,
    caseName: null,
    court: null,
    date: null,
    sourceUrl: null,
    pdfUrl: null,
    identityConfidence: "OFFICIAL_UNSUPPORTED",
    evidence: reasons,
    volume: null,
    page: null,
  };
}

function citationsMatch(expected: string, actual: string | null | undefined): boolean {
  const a = parseUsReportsCitation(expected);
  const b = parseUsReportsCitation(actual || "");
  if (!a || !b) return false;
  return a.volume === b.volume && a.page === b.page;
}

/**
 * Lookup a U.S. Reports citation on GovInfo.
 * Deterministic: volume+page → unique granule ID. No search ranking.
 */
export async function lookupGovInfoUsReports(
  rawCitation: string,
  options: GovInfoUsReportsClientOptions = {},
): Promise<GovInfoUsReportsLookupResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requireCaseClass = options.requireCaseClass !== false;
  const minPdfBytes = options.minPdfBytes ?? 5_000;
  const ua = options.userAgent ?? DEFAULT_UA;
  const headers = { "User-Agent": ua, Accept: "application/json" };

  const parsed = parseUsReportsCitation(rawCitation);
  if (!parsed) {
    return unsupported(rawCitation, ["not_us_reports_citation"]);
  }

  const ids = govInfoUsReportsIds(parsed.volume, parsed.page);
  const base: GovInfoUsReportsLookupResult = {
    rawCitation,
    normalizedCitation: parsed.normalized,
    sourceProvider: GOVINFO_USREPORTS_PROVIDER,
    sourceLabel: GOVINFO_SOURCE_LABEL,
    providerCaseId: null,
    canonicalCitation: null,
    caseName: null,
    court: "U.S. Supreme Court",
    date: null,
    sourceUrl: ids.detailsUrl,
    pdfUrl: ids.pdfUrl,
    identityConfidence: "OFFICIAL_NOT_FOUND",
    evidence: [],
    volume: parsed.volume,
    page: parsed.page,
  };

  // Prefer API summary when key present (granuleClass + usCitation verification).
  const apiKey = options.apiKey?.trim() || process.env.GOVINFO_API_KEY?.trim() || process.env.API_DATA_GOV_KEY?.trim();
  if (apiKey) {
    const summaryRes = await fetchImpl(ids.summaryUrl(apiKey), { method: "GET", headers });
    if (summaryRes.status === 404) {
      return { ...base, identityConfidence: "OFFICIAL_NOT_FOUND", evidence: ["govinfo_summary_404"] };
    }
    if (!summaryRes.ok) {
      return {
        ...base,
        identityConfidence: "OFFICIAL_NOT_FOUND",
        evidence: [`govinfo_summary_http_${summaryRes.status}`],
      };
    }
    const body = (await summaryRes.json()) as Record<string, unknown>;
    const granuleClass = String(body.granuleClass || "");
    const usCitation = String(body.usCitation || body.fullCitation || "");
    const title = String(body.title || "");
    const decisionDate =
      body.decisionDate && typeof body.decisionDate === "object" && body.decisionDate !== null
        ? String((body.decisionDate as { date?: string }).date || "")
        : "";

    if (requireCaseClass && granuleClass && granuleClass !== "CASE") {
      return {
        ...base,
        providerCaseId: String(body.granuleId || ids.granuleId),
        identityConfidence: "OFFICIAL_AMBIGUOUS",
        evidence: [`granule_class_${granuleClass || "unknown"}`, "refused_non_case_granule"],
      };
    }

    if (usCitation && !citationsMatch(parsed.normalized, usCitation)) {
      return {
        ...base,
        providerCaseId: String(body.granuleId || ids.granuleId),
        canonicalCitation: usCitation || null,
        caseName: title || null,
        date: decisionDate || null,
        identityConfidence: "OFFICIAL_AMBIGUOUS",
        evidence: [`usCitation_mismatch expected=${parsed.normalized} got=${usCitation}`],
      };
    }

    const confidence: OfficialIdentityConfidence =
      String(rawCitation).replace(/\s+/g, " ").trim() === parsed.normalized
        ? "OFFICIAL_EXACT_MATCH"
        : "OFFICIAL_NORMALIZED_MATCH";

    return {
      ...base,
      providerCaseId: String(body.granuleId || ids.granuleId),
      canonicalCitation: usCitation || parsed.normalized,
      caseName: title || null,
      date: decisionDate || null,
      identityConfidence: confidence,
      evidence: [
        `govinfo_granule=${ids.granuleId}`,
        granuleClass ? `granuleClass=${granuleClass}` : "granuleClass_absent",
        usCitation ? `usCitation=${usCitation}` : "usCitation_absent",
      ],
    };
  }

  // No API key: existence proof via public PDF HEAD (deterministic URL only).
  // GovInfo soft-404s often return HTTP 200 text/html without Content-Length.
  const head = await fetchImpl(ids.pdfUrl, { method: "HEAD", headers: { "User-Agent": ua } });
  if (head.status === 404) {
    return { ...base, identityConfidence: "OFFICIAL_NOT_FOUND", evidence: ["govinfo_pdf_404"] };
  }
  if (!head.ok) {
    return { ...base, identityConfidence: "OFFICIAL_NOT_FOUND", evidence: [`govinfo_pdf_http_${head.status}`] };
  }
  const contentType = (head.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("pdf")) {
    return {
      ...base,
      identityConfidence: "OFFICIAL_NOT_FOUND",
      evidence: [`govinfo_pdf_not_pdf content-type=${contentType || "null"}`],
    };
  }
  const lenHeader = head.headers.get("content-length");
  const len = lenHeader ? Number(lenHeader) : NaN;
  if (!Number.isFinite(len) || len < minPdfBytes) {
    return {
      ...base,
      identityConfidence: "OFFICIAL_NOT_FOUND",
      evidence: [`govinfo_pdf_too_small_or_missing_length content-length=${lenHeader ?? "null"}`],
    };
  }

  // Without CASE-class confirmation, do not auto-resolve for writes — mark as provisional exact URL hit.
  // Callers must set requireCaseClass=false explicitly to treat HEAD as resolvable.
  if (requireCaseClass) {
    return {
      ...base,
      providerCaseId: ids.granuleId,
      canonicalCitation: parsed.normalized,
      identityConfidence: "OFFICIAL_AMBIGUOUS",
      evidence: [`govinfo_pdf_exists bytes=${len}`, "api_key_required_for_case_class_confirm"],
    };
  }

  return {
    ...base,
    providerCaseId: ids.granuleId,
    canonicalCitation: parsed.normalized,
    identityConfidence: "OFFICIAL_EXACT_MATCH",
    evidence: [`govinfo_pdf_exists bytes=${len}`, "head_only_no_api_key"],
  };
}

/** True when result is safe for AUTO_RESOLVE identity write. */
export function isGovInfoAutoResolvable(result: GovInfoUsReportsLookupResult): boolean {
  return (
    result.identityConfidence === "OFFICIAL_EXACT_MATCH" ||
    result.identityConfidence === "OFFICIAL_NORMALIZED_MATCH" ||
    result.identityConfidence === "OFFICIAL_PARALLEL_MATCH"
  );
}
