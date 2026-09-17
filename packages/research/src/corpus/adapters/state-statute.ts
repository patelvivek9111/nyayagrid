/**
 * Config-driven state statute adapter.
 * Does not scrape all 50 legislature sites; normalize/validate/parse pre-fetched HTML/text.
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

export type StateStatuteSourceConfig = {
  stateCode: string;
  baseUrl: string;
  citationPattern?: string;
  /** Optional curated discover stubs (external id + path relative to baseUrl). */
  discoverPaths?: Array<{ id: string; path: string; titleHint?: string }>;
  rateLimitMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function joinUrl(base: string, path: string): string {
  try {
    return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }
}

function extractTitleFromHtml(html: string, fallback: string): string {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1?.[1]) {
    const t = sanitizeUntrustedLegalText(h1[1].replace(/<[^>]+>/g, " "));
    if (t.length >= 3) return t;
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) {
    const t = sanitizeUntrustedLegalText(title[1].replace(/<[^>]+>/g, " "));
    if (t.length >= 3) return t;
  }
  return fallback;
}

function htmlToText(html: string): string {
  return sanitizeUntrustedLegalText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export function createStateStatuteAdapter(config: StateStatuteSourceConfig): LegalSourceAdapter {
  const stateCode = config.stateCode.trim().toUpperCase();
  const rateLimitMs = config.rateLimitMs ?? 500;
  const citationRe = config.citationPattern
    ? new RegExp(config.citationPattern, "i")
    : null;

  const adapter: LegalSourceAdapter = {
    name: `state_statute_${stateCode.toLowerCase()}`,
    capabilities: {
      discover: true,
      fetch: true,
      parse: true,
      rateLimited: true,
      requiresApiKey: false,
    },

    async discover(cursor?: string, limit = 25) {
      const paths = config.discoverPaths ?? [];
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const slice = paths.slice(start, start + limit);
      const items: AdapterDiscoverItem[] = slice.map((row) => ({
        sourceExternalId: `${stateCode.toLowerCase()}-statute-${row.id}`,
        canonicalUrl: joinUrl(config.baseUrl, row.path),
        titleHint: row.titleHint,
        jurisdiction: stateCode,
      }));
      const next = start + slice.length;
      return {
        items,
        nextCursor: next < paths.length ? String(next) : undefined,
      };
    },

    async fetch(items: AdapterDiscoverItem[]) {
      const results: AdapterFetchResult[] = [];
      for (const item of items) {
        if (!item.canonicalUrl) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: "missing_url" },
            retrievedAt: new Date().toISOString(),
          });
          continue;
        }
        await sleep(rateLimitMs);
        try {
          const res = await fetch(item.canonicalUrl, {
            headers: { Accept: "text/html,text/plain,*/*" },
          });
          if (!res.ok) {
            results.push({
              sourceExternalId: item.sourceExternalId,
              raw: { error: `http_${res.status}` },
              retrievedAt: new Date().toISOString(),
              canonicalUrl: item.canonicalUrl,
            });
            continue;
          }
          const body = await res.text();
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: {
              html: body,
              titleHint: item.titleHint,
              stateCode,
            },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
        } catch (error) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: {
              error: error instanceof Error ? error.message : "fetch_failed",
            },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
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
          html?: string;
          text?: string;
          titleHint?: string;
          stateCode?: string;
        };
        if (raw.error) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: `State statute fetch failed: ${raw.error}`,
            raw: row.raw,
          });
          continue;
        }

        const htmlOrText = raw.html ?? raw.text ?? "";
        if (!htmlOrText.trim()) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "No pre-fetched HTML/text to parse; adapter does not invent statute text.",
            raw: row.raw,
          });
          continue;
        }

        const content = raw.html ? htmlToText(raw.html) : sanitizeUntrustedLegalText(raw.text ?? "");
        if (content.length < 20) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "Statute text too short after sanitize.",
            raw: row.raw,
          });
          continue;
        }

        const title = raw.html
          ? extractTitleFromHtml(raw.html, raw.titleHint ?? `${stateCode} statute`)
          : sanitizeUntrustedLegalText(raw.titleHint ?? `${stateCode} statute`);

        let citation: string | null = raw.titleHint?.trim() || null;
        if (citationRe && citation && !citationRe.test(citation)) {
          const fromBody = citationRe.exec(content);
          citation = fromBody?.[0] ?? citation;
        }

        const record: AdapterAuthorityRecord = {
          title: title.length >= 3 ? title : `${stateCode} statute`,
          authorityType: "statute",
          content,
          sourceProvider: "state_statute",
          sourceExternalId: row.sourceExternalId,
          citation,
          jurisdiction: stateCode,
          authorityState: stateCode,
          canonicalSourceUrl: row.canonicalUrl ?? null,
          contentHash: sha256(content),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_OFFICIAL",
          sourceMetadata: {
            adapter: "state_statute",
            stateCode,
            baseUrl: config.baseUrl,
            retrievedAt: row.retrievedAt,
            note: "Parsed from provided/fetched HTML; not a complete 50-state scrape.",
          },
        };

        const normalized = adapter.normalize?.(record) ?? record;
        const validation = adapter.validate?.(normalized) ?? { ok: true };
        if (!validation.ok) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: validation.reason ?? "validation_failed",
            raw: row.raw,
          });
          continue;
        }
        records.push(normalized);
      }

      return { records, quarantined };
    },

    normalize(record: AdapterAuthorityRecord): AdapterAuthorityRecord {
      return {
        ...record,
        authorityState: stateCode,
        jurisdiction: record.jurisdiction ?? stateCode,
        title: sanitizeUntrustedLegalText(record.title),
        content: sanitizeUntrustedLegalText(record.content),
        citation: record.citation ? sanitizeUntrustedLegalText(record.citation) : record.citation,
      };
    },

    validate(record: AdapterAuthorityRecord) {
      if (record.authorityType !== "statute") {
        return { ok: false, reason: "state_statute adapter only emits statute authorities." };
      }
      if ((record.authorityState ?? "").toUpperCase() !== stateCode) {
        return { ok: false, reason: `authorityState must be ${stateCode}.` };
      }
      if (record.content.trim().length < 20) {
        return { ok: false, reason: "content too short." };
      }
      return { ok: true };
    },
  };

  return adapter;
}

/** Parse already-fetched HTML/text without network I/O. */
export async function parsePrefetchedStateStatute(params: {
  config: StateStatuteSourceConfig;
  sourceExternalId: string;
  htmlOrText: string;
  canonicalUrl?: string;
  titleHint?: string;
  isHtml?: boolean;
}): Promise<AdapterParseResult> {
  const adapter = createStateStatuteAdapter(params.config);
  const fetched: AdapterFetchResult = {
    sourceExternalId: params.sourceExternalId,
    retrievedAt: new Date().toISOString(),
    canonicalUrl: params.canonicalUrl,
    raw: params.isHtml === false
      ? { text: params.htmlOrText, titleHint: params.titleHint, stateCode: params.config.stateCode }
      : { html: params.htmlOrText, titleHint: params.titleHint, stateCode: params.config.stateCode },
  };
  return adapter.parse([fetched]);
}
