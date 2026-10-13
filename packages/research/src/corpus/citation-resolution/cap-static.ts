/**
 * Harvard Caselaw Access Project (CAP) static bulk identity lookup.
 * Uses CasesMetadata.json per reporter/volume — no CAP API, no CourtListener.
 * Public-domain case data (CC0 / restrictions expired). Auto-resolve only unique matches.
 */

import { experimentalNormalize, parseVolReporterPage } from "./normalize.js";

export const CAP_STATIC_PROVIDER = "PUBLIC_CASELAW_DATASET_CAP" as const;
export const CAP_SOURCE_LABEL = "HARVARD_CAP_STATIC" as const;

export type PublicIdentityConfidence =
  | "PUBLIC_EXACT_MATCH"
  | "PUBLIC_NORMALIZED_MATCH"
  | "PUBLIC_PARALLEL_MATCH"
  | "PUBLIC_AMBIGUOUS"
  | "PUBLIC_NOT_FOUND"
  | "PUBLIC_UNSUPPORTED";

export type CapCaseMetadata = {
  id: number | string;
  name?: string | null;
  name_abbreviation?: string | null;
  decision_date?: string | null;
  first_page?: string | number | null;
  last_page?: string | number | null;
  citations?: Array<{ type?: string; cite?: string }> | null;
  court?: { name?: string | null; name_abbreviation?: string | null } | null;
  jurisdiction?: { name?: string | null; name_long?: string | null } | null;
};

export type CapStaticLookupResult = {
  rawCitation: string;
  normalizedCitation: string | null;
  sourceProvider: typeof CAP_STATIC_PROVIDER;
  sourceLabel: typeof CAP_SOURCE_LABEL;
  providerCaseId: string | null;
  canonicalCitation: string | null;
  caseName: string | null;
  court: string | null;
  date: string | null;
  sourceUrl: string | null;
  identityConfidence: PublicIdentityConfidence;
  evidence: string[];
  volume: number | null;
  page: number | null;
  reporterSlug: string | null;
};

export type CapFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type CapStaticClientOptions = {
  fetchImpl?: CapFetch;
  /** In-memory volume metadata cache (shared across lookups). */
  volumeCache?: Map<string, CapCaseMetadata[] | null>;
  baseUrl?: string;
  userAgent?: string;
};

const DEFAULT_UA = "NyayaGridCorpusIdentityProbe/1.0 (+research; CAP static metadata; identity-only)";
const DEFAULT_BASE = "https://static.case.law";

/** Map Nyaya compact reporter → CAP static slug. */
export function nyayaReporterToCapSlug(reporter: string | null | undefined): string | null {
  if (!reporter) return null;
  const r = String(reporter).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const map: Record<string, string> = {
    us: "us",
    sct: "s-ct",
    led2d: "l-ed-2d",
    led: "l-ed",
    f: "f",
    f2d: "f2d",
    f3d: "f3d",
    f4th: "f4th", // absent from CAP as of 2026 audit
    fsupp: "f-supp",
    fsupp2d: "f-supp-2d",
    fsupp3d: "f-supp-3d",
    p2d: "p2d",
    p3d: "p3d",
    a2d: "a2d",
    a3d: "a3d",
    so: "so",
    so2d: "so2d",
    so3d: "so3d",
    se2d: "se2d",
    sw2d: "sw2d",
    sw3d: "sw3d",
    nw2d: "nw2d",
    nw3d: "nw3d",
    ne2d: "ne2d",
    ne3d: "ne3d",
  };
  return map[r] || r;
}

export function parseCapCitationParts(
  raw: string | null | undefined,
): { volume: number; page: number; reporter: string; normalized: string; capSlug: string } | null {
  const seed = experimentalNormalize(raw) || String(raw || "").trim();
  if (!seed) return null;
  const parsed = parseVolReporterPage(seed);
  if (!parsed || !Number.isFinite(parsed.volume) || !Number.isFinite(parsed.page)) return null;
  const compact = String(parsed.reporter || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const capSlug = nyayaReporterToCapSlug(compact);
  if (!capSlug) return null;
  return {
    volume: parsed.volume,
    page: parsed.page,
    reporter: compact,
    normalized: `${parsed.volume} ${formatReporterDisplay(compact)} ${parsed.page}`,
    capSlug,
  };
}

function formatReporterDisplay(compact: string): string {
  const display: Record<string, string> = {
    us: "U.S.",
    sct: "S. Ct.",
    led2d: "L. Ed. 2d",
    f2d: "F.2d",
    f3d: "F.3d",
    f4th: "F.4th",
    fsupp3d: "F. Supp. 3d",
    fsupp2d: "F. Supp. 2d",
    p3d: "P.3d",
    p2d: "P.2d",
    a3d: "A.3d",
    a2d: "A.2d",
    so3d: "So.3d",
    so2d: "So.2d",
    se2d: "S.E.2d",
    sw3d: "S.W.3d",
    nw2d: "N.W.2d",
    idaho: "Idaho",
    kan: "Kan.",
    or: "Or.",
    mass: "Mass.",
    ariz: "Ariz.",
    conn: "Conn.",
    va: "Va.",
    mich: "Mich.",
  };
  return display[compact] || compact;
}

function normalizeCiteKey(cite: string): string {
  return experimentalNormalize(cite)?.toLowerCase().replace(/\s+/g, " ").trim() || "";
}

function pageNum(v: string | number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function casesMetadataUrl(baseUrl: string, slug: string, volume: number): string {
  return `${baseUrl.replace(/\/$/, "")}/${slug}/${volume}/CasesMetadata.json`;
}

function unsupported(raw: string, reasons: string[]): CapStaticLookupResult {
  return {
    rawCitation: raw,
    normalizedCitation: experimentalNormalize(raw),
    sourceProvider: CAP_STATIC_PROVIDER,
    sourceLabel: CAP_SOURCE_LABEL,
    providerCaseId: null,
    canonicalCitation: null,
    caseName: null,
    court: null,
    date: null,
    sourceUrl: null,
    identityConfidence: "PUBLIC_UNSUPPORTED",
    evidence: reasons,
    volume: null,
    page: null,
    reporterSlug: null,
  };
}

export function matchCapCases(
  cases: CapCaseMetadata[],
  volume: number,
  page: number,
  normalizedCitation: string,
): { matches: CapCaseMetadata[]; mode: "citation" | "first_page" | "none" } {
  const want = normalizeCiteKey(normalizedCitation);
  const byCite = cases.filter((c) =>
    (c.citations || []).some((ci) => ci.cite && normalizeCiteKey(ci.cite) === want),
  );
  if (byCite.length >= 1) return { matches: byCite, mode: "citation" };

  // Official reporter page equals CAP first_page only — never match mid-opinion pin pages.
  const byPage = cases.filter((c) => pageNum(c.first_page) === page);
  if (byPage.length >= 1) return { matches: byPage, mode: "first_page" };
  return { matches: [], mode: "none" };
}

export async function loadCapVolumeCases(
  slug: string,
  volume: number,
  options: CapStaticClientOptions = {},
): Promise<CapCaseMetadata[] | null> {
  const cache = options.volumeCache;
  const key = `${slug}|${volume}`;
  if (cache?.has(key)) return cache.get(key) ?? null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const url = casesMetadataUrl(baseUrl, slug, volume);
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { "User-Agent": options.userAgent ?? DEFAULT_UA, Accept: "application/json" },
  });
  if (res.status === 404) {
    cache?.set(key, null);
    return null;
  }
  if (!res.ok) {
    throw new Error(`cap_volume_http_${res.status}`);
  }
  const body = (await res.json()) as CapCaseMetadata[];
  const cases = Array.isArray(body) ? body : [];
  cache?.set(key, cases);
  return cases;
}

/**
 * Lookup a reporter citation in CAP static CasesMetadata.
 * Deterministic: volume CasesMetadata → unique cite/first_page match.
 */
export async function lookupCapStatic(
  rawCitation: string,
  options: CapStaticClientOptions = {},
): Promise<CapStaticLookupResult> {
  const parsed = parseCapCitationParts(rawCitation);
  if (!parsed) {
    return unsupported(rawCitation, ["unparseable_or_non_vrp_citation"]);
  }

  // Known absent series
  if (parsed.capSlug === "f4th" || parsed.capSlug === "nw3d") {
    return {
      ...unsupported(rawCitation, [`cap_slug_absent_${parsed.capSlug}`]),
      normalizedCitation: parsed.normalized,
      volume: parsed.volume,
      page: parsed.page,
      reporterSlug: parsed.capSlug,
    };
  }

  let cases: CapCaseMetadata[] | null;
  try {
    cases = await loadCapVolumeCases(parsed.capSlug, parsed.volume, options);
  } catch (e) {
    return {
      rawCitation,
      normalizedCitation: parsed.normalized,
      sourceProvider: CAP_STATIC_PROVIDER,
      sourceLabel: CAP_SOURCE_LABEL,
      providerCaseId: null,
      canonicalCitation: null,
      caseName: null,
      court: null,
      date: null,
      sourceUrl: casesMetadataUrl(options.baseUrl ?? DEFAULT_BASE, parsed.capSlug, parsed.volume),
      identityConfidence: "PUBLIC_NOT_FOUND",
      evidence: [`cap_fetch_error:${e instanceof Error ? e.message : String(e)}`],
      volume: parsed.volume,
      page: parsed.page,
      reporterSlug: parsed.capSlug,
    };
  }

  const sourceUrl = casesMetadataUrl(options.baseUrl ?? DEFAULT_BASE, parsed.capSlug, parsed.volume);
  if (!cases) {
    return {
      rawCitation,
      normalizedCitation: parsed.normalized,
      sourceProvider: CAP_STATIC_PROVIDER,
      sourceLabel: CAP_SOURCE_LABEL,
      providerCaseId: null,
      canonicalCitation: null,
      caseName: null,
      court: null,
      date: null,
      sourceUrl,
      identityConfidence: "PUBLIC_UNSUPPORTED",
      evidence: [`cap_volume_missing ${parsed.capSlug}/${parsed.volume}`],
      volume: parsed.volume,
      page: parsed.page,
      reporterSlug: parsed.capSlug,
    };
  }

  const { matches, mode } = matchCapCases(cases, parsed.volume, parsed.page, parsed.normalized);
  if (matches.length === 0) {
    return {
      rawCitation,
      normalizedCitation: parsed.normalized,
      sourceProvider: CAP_STATIC_PROVIDER,
      sourceLabel: CAP_SOURCE_LABEL,
      providerCaseId: null,
      canonicalCitation: null,
      caseName: null,
      court: null,
      date: null,
      sourceUrl,
      identityConfidence: "PUBLIC_NOT_FOUND",
      evidence: [`cap_no_case_for_page mode=${mode}`],
      volume: parsed.volume,
      page: parsed.page,
      reporterSlug: parsed.capSlug,
    };
  }
  if (matches.length > 1) {
    return {
      rawCitation,
      normalizedCitation: parsed.normalized,
      sourceProvider: CAP_STATIC_PROVIDER,
      sourceLabel: CAP_SOURCE_LABEL,
      providerCaseId: null,
      canonicalCitation: null,
      caseName: null,
      court: null,
      date: null,
      sourceUrl,
      identityConfidence: "PUBLIC_AMBIGUOUS",
      evidence: [`cap_multi_match n=${matches.length}`, `ids=${matches.map((m) => m.id).join(",")}`],
      volume: parsed.volume,
      page: parsed.page,
      reporterSlug: parsed.capSlug,
    };
  }

  const hit = matches[0]!;
  const official =
    (hit.citations || []).find((c) => c.type === "official" && c.cite)?.cite ||
    (hit.citations || []).find((c) => c.cite)?.cite ||
    null;
  const rawNorm = normalizeCiteKey(String(rawCitation));
  const parsedNorm = normalizeCiteKey(parsed.normalized);
  const officialNorm = official ? normalizeCiteKey(official) : "";
  let confidence: PublicIdentityConfidence = "PUBLIC_EXACT_MATCH";
  if (officialNorm && officialNorm !== rawNorm && officialNorm === parsedNorm) {
    confidence = "PUBLIC_NORMALIZED_MATCH";
  } else if (mode === "first_page" && officialNorm && officialNorm !== parsedNorm) {
    // first_page unique but official cite string differs — still deterministic if page equals first_page
    confidence = pageNum(hit.first_page) === parsed.page ? "PUBLIC_NORMALIZED_MATCH" : "PUBLIC_PARALLEL_MATCH";
  } else if (rawNorm !== parsedNorm) {
    confidence = "PUBLIC_NORMALIZED_MATCH";
  }

  return {
    rawCitation,
    normalizedCitation: parsed.normalized,
    sourceProvider: CAP_STATIC_PROVIDER,
    sourceLabel: CAP_SOURCE_LABEL,
    providerCaseId: String(hit.id),
    canonicalCitation: official || parsed.normalized,
    caseName: hit.name_abbreviation || hit.name || null,
    court: hit.court?.name || hit.court?.name_abbreviation || null,
    date: hit.decision_date || null,
    sourceUrl,
    identityConfidence: confidence,
    evidence: [
      `cap_case_id=${hit.id}`,
      `match_mode=${mode}`,
      `first_page=${hit.first_page}`,
      official ? `official_cite=${official}` : "official_cite_absent",
    ],
    volume: parsed.volume,
    page: parsed.page,
    reporterSlug: parsed.capSlug,
  };
}

export function isCapAutoResolvable(result: CapStaticLookupResult): boolean {
  return (
    result.identityConfidence === "PUBLIC_EXACT_MATCH" ||
    result.identityConfidence === "PUBLIC_NORMALIZED_MATCH" ||
    result.identityConfidence === "PUBLIC_PARALLEL_MATCH"
  );
}
