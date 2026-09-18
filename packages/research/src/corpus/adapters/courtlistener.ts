/**
 * CourtListener REST adapter (public Free Law Project API).
 * Requires an API token for discover/fetch; without a key returns empty discover + quarantine.
 */

import { createHash } from "node:crypto";
import {
  type AdapterAuthorityRecord,
  type AdapterDiscoverItem,
  type AdapterFetchResult,
  type AdapterParseResult,
  type LegalSourceAdapter,
  sanitizeUntrustedLegalText,
} from "./types";

const DEFAULT_BASE = "https://www.courtlistener.com/api/rest/v4";

/** Jurisdiction code → CourtListener court id (high court where mapped). */
export const COURT_ID_MAP: Record<string, string> = {
  us: "scotus",
  ca: "cal",
  ny: "ny",
  pa: "pa",
  tx: "tex",
  nj: "nj",
  fl: "fla",
  il: "ill",
  ma: "mass",
  va: "va",
  de: "del",
};

export type CourtListenerAdapterOptions = {
  apiKey?: string;
  baseUrl?: string;
  rateLimitMs?: number;
  /** Optional jurisdiction filter (USPS / US); maps via COURT_ID_MAP. */
  jurisdictionCode?: string;
  /** Explicit CourtListener court id (e.g. scotus, ca3, cal). Overrides jurisdiction map. */
  clCourtId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function absoluteUrl(base: string, maybeRelative: string | null | undefined): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

type ClSearchHit = {
  id?: number | string;
  cluster_id?: number | string;
  absolute_url?: string;
  download_url?: string | null;
  case_name?: string;
  caseName?: string;
  citation?: string[] | string;
  date_filed?: string;
  docket_number?: string | null;
  court?: string;
  court_id?: string;
  plain_text?: string;
  html?: string;
  html_with_citations?: string;
  snippet?: string;
};

function pickText(hit: ClSearchHit): string {
  const raw =
    hit.plain_text ||
    hit.html_with_citations ||
    hit.html ||
    hit.snippet ||
    "";
  return sanitizeUntrustedLegalText(String(raw).replace(/<[^>]+>/g, " "));
}

function pickCitation(hit: ClSearchHit): string | null {
  if (Array.isArray(hit.citation) && hit.citation.length > 0) {
    return String(hit.citation[0]);
  }
  if (typeof hit.citation === "string" && hit.citation.trim()) return hit.citation.trim();
  return null;
}

export function createCourtListenerAdapter(
  options: CourtListenerAdapterOptions = {},
): LegalSourceAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const apiKey = options.apiKey?.trim() || undefined;
  const rateLimitMs = options.rateLimitMs ?? 350;
  const courtId =
    options.clCourtId?.trim() ||
    (options.jurisdictionCode
      ? COURT_ID_MAP[options.jurisdictionCode.trim().toLowerCase()]
      : undefined);

  const adapter: LegalSourceAdapter = {
    name: "courtlistener",
    capabilities: {
      discover: true,
      fetch: true,
      parse: true,
      rateLimited: true,
      requiresApiKey: true,
    },

    async discover(cursor?: string, limit = 25) {
      if (!apiKey) {
        return { items: [], nextCursor: undefined };
      }
      const params = new URLSearchParams({
        page_size: String(Math.min(Math.max(limit, 1), 50)),
        type: "o",
        order_by: "dateFiled desc",
      });
      if (courtId) params.set("court", courtId);
      // Empty query with court filter lists recent opinions for that court.
      params.set("q", "*");
      if (cursor) params.set("cursor", cursor);

      await sleep(rateLimitMs);
      let res = await fetch(`${baseUrl}/search/?${params.toString()}`, {
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: "application/json",
        },
      });
      // Bounded 429 handling — respect Retry-After; no retry storm.
      for (let attempt = 0; attempt < 4 && res.status === 429; attempt++) {
        const ra = res.headers.get("retry-after");
        const sec = ra && /^\d+$/.test(ra) ? Math.min(Number(ra), 120) : Math.min(2 ** (attempt + 1), 60);
        await sleep(sec * 1000);
        res = await fetch(`${baseUrl}/search/?${params.toString()}`, {
          headers: {
            Authorization: `Token ${apiKey}`,
            Accept: "application/json",
          },
        });
      }
      if (!res.ok) {
        return { items: [], nextCursor: undefined };
      }
      const body = (await res.json()) as {
        results?: ClSearchHit[];
        next?: string | null;
      };
      const items: AdapterDiscoverItem[] = (body.results ?? []).map((hit) => {
        const nested = (hit as ClSearchHit & { opinions?: Array<{ id?: number | string }> }).opinions;
        const opinionId =
          hit.id ??
          nested?.find((o) => o?.id != null)?.id ??
          hit.cluster_id;
        const id = String(opinionId ?? "");
        return {
          sourceExternalId: id ? `cl-opinion-${id}` : `cl-unknown-${Math.random()}`,
          canonicalUrl: absoluteUrl("https://www.courtlistener.com", hit.absolute_url),
          titleHint: hit.case_name ?? hit.caseName,
          jurisdiction: options.jurisdictionCode?.toUpperCase(),
        };
      });
      let nextCursor: string | undefined;
      if (body.next) {
        try {
          nextCursor = new URL(body.next).searchParams.get("cursor") ?? undefined;
        } catch {
          nextCursor = undefined;
        }
      }
      return { items, nextCursor };
    },

    async fetch(items: AdapterDiscoverItem[]) {
      if (!apiKey) {
        return items.map((item) => ({
          sourceExternalId: item.sourceExternalId,
          raw: { error: "missing_api_key" },
          retrievedAt: new Date().toISOString(),
          canonicalUrl: item.canonicalUrl,
        }));
      }
      const results: AdapterFetchResult[] = [];
      for (const item of items) {
        await sleep(rateLimitMs);
        const numeric = item.sourceExternalId.replace(/^cl-opinion-/, "");
        const res = await fetch(`${baseUrl}/opinions/${numeric}/`, {
          headers: {
            Authorization: `Token ${apiKey}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: `http_${res.status}`, status: res.status },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        const raw = (await res.json()) as ClSearchHit;
        const canonical =
          absoluteUrl("https://www.courtlistener.com", raw.download_url) ??
          absoluteUrl("https://www.courtlistener.com", raw.absolute_url) ??
          item.canonicalUrl;
        results.push({
          sourceExternalId: item.sourceExternalId,
          raw,
          retrievedAt: new Date().toISOString(),
          canonicalUrl: canonical,
        });
      }
      return results;
    },

    async parse(fetched: AdapterFetchResult[]): Promise<AdapterParseResult> {
      const records: AdapterAuthorityRecord[] = [];
      const quarantined: AdapterParseResult["quarantined"] = [];

      for (const row of fetched) {
        const raw = row.raw as ClSearchHit & { error?: string };
        if (!apiKey || raw.error === "missing_api_key") {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "CourtListener API key missing; refusing network ingest and inventing no holdings.",
            raw: row.raw,
          });
          continue;
        }
        if (raw.error) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: `CourtListener fetch failed: ${raw.error}`,
            raw: row.raw,
          });
          continue;
        }

        const content = pickText(raw);
        if (content.length < 20) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "Opinion text too short or absent after sanitize.",
            raw: row.raw,
          });
          continue;
        }

        const title = sanitizeUntrustedLegalText(
          String(raw.case_name ?? raw.caseName ?? "Untitled CourtListener opinion"),
        );
        const citation = pickCitation(raw);
        const docket = raw.docket_number ? String(raw.docket_number) : null;
        if (!citation && !docket) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "Case requires citation or docket number.",
            raw: row.raw,
          });
          continue;
        }

        const canonicalUrl =
          absoluteUrl("https://www.courtlistener.com", raw.download_url) ??
          absoluteUrl("https://www.courtlistener.com", raw.absolute_url) ??
          row.canonicalUrl;

        records.push({
          title: title.length >= 3 ? title : "CourtListener opinion",
          authorityType: "case",
          content,
          sourceProvider: "courtlistener",
          sourceExternalId: row.sourceExternalId,
          citation,
          docketNumber: docket,
          decisionDate: raw.date_filed ?? null,
          court: raw.court ? String(raw.court) : null,
          courtId: raw.court_id ? String(raw.court_id) : courtId ?? null,
          jurisdiction: options.jurisdictionCode?.toUpperCase() ?? null,
          authorityState:
            options.jurisdictionCode?.toUpperCase() === "US"
              ? "US"
              : options.jurisdictionCode?.toUpperCase() ?? null,
          canonicalSourceUrl: canonicalUrl ?? null,
          contentHash: sha256(content),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
          sourceMetadata: {
            adapter: "courtlistener",
            retrievedAt: row.retrievedAt,
          },
        });
      }

      return { records, quarantined };
    },
  };

  return adapter;
}
