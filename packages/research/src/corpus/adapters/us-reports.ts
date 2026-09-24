/**
 * Library of Congress U.S. Reports adapter (non-CourtListener).
 *
 * Constructs a loc.gov item URL from volume+page and fetches JSON/HTML.
 * Refuses to invent opinion text or case names when the source does not
 * return primary content.
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

export type UsReportsTarget = {
  volume: number;
  page: number;
  inbound?: number;
};

export type UsReportsAdapterOptions = {
  rateLimitMs?: number;
  fetchImpl?: typeof fetch;
  targets?: UsReportsTarget[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** loc.gov item slug used by the U.S. Reports collection (volume 3-digit, page 4-digit). */
export function locUsReportsItemId(volume: number, page: number): string {
  return `usrep${String(volume).padStart(3, "0")}${String(page).padStart(4, "0")}`;
}

export function locUsReportsItemUrl(volume: number, page: number): string {
  return `https://www.loc.gov/item/${locUsReportsItemId(volume, page)}/?fo=json`;
}

export function usReportsCitation(volume: number, page: number): string {
  return `${volume} U.S. ${page}`;
}

export function parseUsReportsTarget(raw: string): UsReportsTarget | null {
  const match = /\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/.exec(raw.replace(/\s+/g, " "));
  if (!match) return null;
  return { volume: Number(match[1]), page: Number(match[2]) };
}

function extractLocText(raw: unknown): { title: string | null; text: string; date: string | null; url: string | null } {
  if (!raw || typeof raw !== "object") return { title: null, text: "", date: null, url: null };
  const obj = raw as Record<string, unknown>;
  const item = (obj.item && typeof obj.item === "object" ? obj.item : obj) as Record<string, unknown>;
  const title = typeof item.title === "string" ? item.title : typeof obj.title === "string" ? obj.title : null;
  const date =
    typeof item.date === "string"
      ? item.date
      : typeof item.item_date === "string"
        ? item.item_date
        : null;
  const url =
    typeof item.url === "string"
      ? item.url
      : typeof obj.url === "string"
        ? obj.url
        : null;
  const fullText =
    (typeof item.full_text === "string" && item.full_text) ||
    (typeof obj.full_text === "string" && obj.full_text) ||
    (typeof item.ocr_text === "string" && item.ocr_text) ||
    "";
  return { title, text: sanitizeUntrustedLegalText(fullText), date, url };
}

export function createUsReportsLocAdapter(options: UsReportsAdapterOptions = {}): LegalSourceAdapter {
  const rateLimitMs = options.rateLimitMs ?? 400;
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = options.targets ?? [];

  const adapter: LegalSourceAdapter = {
    name: "us_reports_loc",
    capabilities: {
      discover: true,
      fetch: true,
      parse: true,
      rateLimited: true,
      requiresApiKey: false,
    },

    async discover(cursor?: string, limit = 25) {
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const slice = targets.slice(start, start + limit);
      const items: AdapterDiscoverItem[] = slice.map((row) => ({
        sourceExternalId: locUsReportsItemId(row.volume, row.page),
        canonicalUrl: locUsReportsItemUrl(row.volume, row.page),
        titleHint: usReportsCitation(row.volume, row.page),
        jurisdiction: "US",
      }));
      const next = start + slice.length;
      return {
        items,
        nextCursor: next < targets.length ? String(next) : undefined,
      };
    },

    async fetch(items: AdapterDiscoverItem[]) {
      const results: AdapterFetchResult[] = [];
      for (const item of items) {
        const parsed = parseUsReportsTarget(item.titleHint || "") || (() => {
          const m = /^usrep(\d{3})(\d{4})$/.exec(item.sourceExternalId);
          return m ? { volume: Number(m[1]), page: Number(m[2]) } : null;
        })();
        if (!parsed) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: "unparsed_us_reports_ref" },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        const url = item.canonicalUrl ?? locUsReportsItemUrl(parsed.volume, parsed.page);
        await sleep(rateLimitMs);
        try {
          const res = await fetchImpl(url, {
            headers: { Accept: "application/json, text/html", "User-Agent": "NyayaGridCorpus/queue2" },
          });
          if (!res.ok) {
            results.push({
              sourceExternalId: item.sourceExternalId,
              raw: { error: `http_${res.status}`, volume: parsed.volume, page: parsed.page, url },
              retrievedAt: new Date().toISOString(),
              canonicalUrl: url,
            });
            continue;
          }
          const contentType = res.headers.get("content-type") || "";
          const body = contentType.includes("json") ? await res.json() : { html: await res.text() };
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { volume: parsed.volume, page: parsed.page, url, body },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: url,
          });
        } catch (error) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: {
              error: error instanceof Error ? error.message : "fetch_failed",
              volume: parsed.volume,
              page: parsed.page,
              url,
            },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: url,
          });
        }
      }
      return results;
    },

    async parse(fetched: AdapterFetchResult[]): Promise<AdapterParseResult> {
      const records: AdapterAuthorityRecord[] = [];
      const quarantined: AdapterParseResult["quarantined"] = [];
      for (const row of fetched) {
        const raw = row.raw as {
          error?: string;
          volume?: number;
          page?: number;
          url?: string;
          body?: unknown;
        };
        if (raw.error || raw.volume == null || raw.page == null) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: raw.error
              ? `LOC U.S. Reports fetch failed: ${raw.error}`
              : "U.S. Reports target not parsed; refusing to invent opinion text.",
            raw: row.raw,
          });
          continue;
        }
        const extracted = extractLocText(raw.body);
        if (extracted.text.length < 80) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason:
              "LOC item did not return primary opinion text. External limitation: U.S. Reports machine text not safely available at this URL; do not substitute a secondary summary.",
            raw: { volume: raw.volume, page: raw.page, url: raw.url, title: extracted.title },
          });
          continue;
        }
        const citation = usReportsCitation(raw.volume, raw.page);
        const title = extracted.title && extracted.title.trim().length >= 3 ? extracted.title.trim() : citation;
        records.push({
          title,
          authorityType: "case",
          content: extracted.text,
          sourceProvider: "loc_us_reports",
          sourceExternalId: row.sourceExternalId,
          citation,
          normalizedCitation: citation,
          jurisdiction: "US",
          authorityState: "US",
          court: "Supreme Court of the United States",
          courtId: "scotus",
          courtLevel: "scotus",
          decisionDate: extracted.date,
          canonicalSourceUrl: row.canonicalUrl ?? extracted.url ?? raw.url ?? null,
          contentHash: sha256(extracted.text),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_OFFICIAL",
          sourceMetadata: {
            adapter: "us_reports_loc",
            retrievedAt: row.retrievedAt,
            locItemId: row.sourceExternalId,
          },
        });
      }
      return { records, quarantined };
    },
  };

  return adapter;
}
