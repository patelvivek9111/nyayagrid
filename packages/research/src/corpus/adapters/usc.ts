/**
 * U.S. Code (House OLRC) adapter.
 * Discover returns curated title stubs without inventing statutory text.
 * Fetch pulls viewer HTML only when a concrete section ref is requested.
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

const HOUSE_VIEWER = "https://uscode.house.gov/view.xhtml";

export type UscHouseAdapterOptions = {
  rateLimitMs?: number;
  fetchImpl?: typeof fetch;
  /** Additional/override House OLRC section targets for demand-driven discover. */
  sectionTargets?: Array<{ title: number; section: string; label: string }>;
};

export type UscSectionRef = {
  title: number;
  section: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Normalize common USC citation strings to title + section. */
export function normalizeUscCitation(raw: string): UscSectionRef | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const match =
    /^(\d+)\s*U\.?\s*S\.?\s*C\.?\s*(?:§|sec\.?|section)?\s*([\dA-Za-z.\-]+)/i.exec(cleaned) ??
    /^title\s+(\d+)\s*[,\s]+(?:§|sec\.?|section)?\s*([\dA-Za-z.\-]+)/i.exec(cleaned);
  if (!match) return null;
  return { title: Number(match[1]), section: match[2]! };
}

export function uscViewerUrl(ref: UscSectionRef): string {
  const req = `granuleid:USC-prelim-title${ref.title}-section${ref.section}&num=${ref.section}&edition=prelim`;
  return `${HOUSE_VIEWER}?req=${encodeURIComponent(req)}`;
}

function stripHtml(html: string): string {
  return sanitizeUntrustedLegalText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export const USC_DEFAULT_SECTIONS: Array<{ title: number; section: string; label: string }> = [
  { title: 28, section: "1331", label: "Federal question jurisdiction" },
  { title: 28, section: "1332", label: "Diversity of citizenship" },
  { title: 28, section: "1367", label: "Supplemental jurisdiction" },
  { title: 28, section: "1441", label: "Removal of civil actions" },
  { title: 28, section: "1651", label: "All Writs Act" },
  { title: 28, section: "2201", label: "Creation of remedy (declaratory judgment)" },
  { title: 28, section: "2254", label: "State custody habeas" },
  { title: 29, section: "201", label: "FLSA definitions (stub)" },
  { title: 42, section: "1983", label: "Civil action for deprivation of rights" },
  { title: 42, section: "1988", label: "Proceedings in vindication of civil rights" },
  { title: 5, section: "552", label: "FOIA" },
  { title: 5, section: "706", label: "APA scope of review" },
];

export function createUscHouseAdapter(options: UscHouseAdapterOptions = {}): LegalSourceAdapter {
  const rateLimitMs = options.rateLimitMs ?? 400;
  const fetchImpl = options.fetchImpl ?? fetch;
  const curatedDiscover = options.sectionTargets ?? USC_DEFAULT_SECTIONS;

  const adapter: LegalSourceAdapter = {
    name: "usc_house",
    capabilities: {
      discover: true,
      fetch: true,
      parse: true,
      rateLimited: true,
      requiresApiKey: false,
    },

    async discover(cursor?: string, limit = 25) {
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const slice = curatedDiscover.slice(start, start + limit);
      const items: AdapterDiscoverItem[] = slice.map((row) => ({
        sourceExternalId: `usc-${row.title}-${row.section}`,
        canonicalUrl: uscViewerUrl({ title: row.title, section: row.section }),
        titleHint: `${row.title} U.S.C. § ${row.section} — ${row.label}`,
        jurisdiction: "US",
      }));
      const next = start + slice.length;
      return {
        items,
        nextCursor: next < curatedDiscover.length ? String(next) : undefined,
      };
    },

    async fetch(items: AdapterDiscoverItem[]) {
      const results: AdapterFetchResult[] = [];
      for (const item of items) {
        const fromId = /^usc-(\d+)-(.+)$/.exec(item.sourceExternalId);
        const ref = fromId
          ? { title: Number(fromId[1]), section: fromId[2]! }
          : item.titleHint
            ? normalizeUscCitation(item.titleHint)
            : null;
        if (!ref) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: "unparsed_usc_ref" },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        const url = item.canonicalUrl ?? uscViewerUrl(ref);
        await sleep(rateLimitMs);
        try {
          const res = await fetchImpl(url, {
            headers: { Accept: "text/html,application/xhtml+xml" },
          });
          if (!res.ok) {
            results.push({
              sourceExternalId: item.sourceExternalId,
              raw: { error: `http_${res.status}`, ref, url },
              retrievedAt: new Date().toISOString(),
              canonicalUrl: url,
            });
            continue;
          }
          const html = await res.text();
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { ref, url, html },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: url,
          });
        } catch (error) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: {
              error: error instanceof Error ? error.message : "fetch_failed",
              ref,
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
          ref?: UscSectionRef;
          html?: string;
          url?: string;
        };
        if (raw.error || !raw.ref || !raw.html) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: raw.error
              ? `USC House fetch failed: ${raw.error}`
              : "USC content not retrieved; refusing to invent statutory text.",
            raw: row.raw,
          });
          continue;
        }
        const content = stripHtml(raw.html);
        if (content.length < 20) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "USC viewer returned insufficient text after sanitize.",
            raw: { ref: raw.ref, url: raw.url },
          });
          continue;
        }
        const citation = `${raw.ref.title} U.S.C. § ${raw.ref.section}`;
        records.push({
          title: citation,
          authorityType: "statute",
          content,
          sourceProvider: "usc_house",
          sourceExternalId: row.sourceExternalId,
          citation,
          normalizedCitation: citation,
          jurisdiction: "US",
          authorityState: "US",
          canonicalSourceUrl: row.canonicalUrl ?? raw.url ?? null,
          contentHash: sha256(content),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_OFFICIAL",
          hierarchyPath: [
            { level: "title", ref: String(raw.ref.title) },
            { level: "section", ref: raw.ref.section },
          ],
          sourceMetadata: {
            adapter: "usc_house",
            retrievedAt: row.retrievedAt,
          },
        });
      }

      return { records, quarantined };
    },
  };

  return adapter;
}
