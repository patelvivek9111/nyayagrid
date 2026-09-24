/**
 * eCFR adapter — section-level fetches from the public versioner API.
 * Does not pull entire titles (too heavy); discover uses titles metadata.
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

const ECFR_BASE = "https://www.ecfr.gov/api/versioner/v1";

export type EcfrAdapterOptions = {
  rateLimitMs?: number;
  /** Curated title/part/section targets for discover when not listing remotely. */
  sectionTargets?: Array<{ title: number; part: string; section: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** eCFR full/ endpoints reject dates newer than titles.meta.date — resolve that first. */
let cachedEcfrAsOfDate: string | null = null;

export async function resolveEcfrAsOfDate(): Promise<string> {
  if (cachedEcfrAsOfDate) return cachedEcfrAsOfDate;
  try {
    const res = await fetch(`${ECFR_BASE}/titles.json`, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
    });
    if (res.ok) {
      const body = (await res.json()) as { meta?: { date?: string } };
      if (body.meta?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.meta.date)) {
        cachedEcfrAsOfDate = body.meta.date;
        return cachedEcfrAsOfDate;
      }
    }
  } catch {
    // Fall through to today; callers may still 404 and quarantine honestly.
  }
  cachedEcfrAsOfDate = todayIsoDate();
  return cachedEcfrAsOfDate;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sectionExternalId(title: number, part: string, section: string): string {
  return `ecfr-t${title}-p${part}-s${section}`;
}

function extractTextFromSectionJson(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  if (typeof obj.html === "string" && obj.html.length > 0) {
    return obj.html.replace(/<[^>]+>/g, " ");
  }
  if (typeof obj.full_text_excerpt === "string") return obj.full_text_excerpt;
  if (typeof obj.text === "string") return obj.text;
  const content = obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((node) => {
        if (typeof node === "string") return node;
        if (node && typeof node === "object" && "text" in node) {
          return String((node as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

/** Fetch a single eCFR section via the public renderer API (bounded; not whole-title). */
export async function fetchEcfrSection(
  title: number,
  part: string,
  section: string,
  date?: string,
): Promise<{ ok: true; json: unknown; url: string; date: string } | { ok: false; status: number; url: string; date: string }> {
  const asOf = date ?? (await resolveEcfrAsOfDate());
  const url = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/${asOf}/title-${title}?section=${encodeURIComponent(section)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "text/html, application/xhtml+xml, */*",
    },
  });
  if (!res.ok) return { ok: false, status: res.status, url, date: asOf };
  const html = await res.text();
  return {
    ok: true,
    json: {
      format: "ecfr_renderer_enhanced_html",
      title,
      part,
      section,
      asOf,
      html,
    },
    url,
    date: asOf,
  };
}

export function createEcfrAdapter(options: EcfrAdapterOptions = {}): LegalSourceAdapter {
  const rateLimitMs = options.rateLimitMs ?? 400;
  const defaultTargets = options.sectionTargets ?? [
    { title: 28, part: "0", section: "0.1" },
    { title: 29, part: "541", section: "541.0" },
    { title: 29, part: "1630", section: "1630.2" },
    { title: 42, part: "400", section: "400.200" },
    { title: 45, part: "164", section: "164.502" },
    { title: 8, part: "214", section: "214.1" },
  ];

  const adapter: LegalSourceAdapter = {
    name: "ecfr",
    capabilities: {
      discover: true,
      fetch: true,
      parse: true,
      rateLimited: true,
      requiresApiKey: false,
    },

    async discover(cursor?: string, limit = 25) {
      // Prefer curated section stubs; resolve eCFR as-of date for provenance.
      if (!cursor) {
        try {
          await sleep(rateLimitMs);
          await resolveEcfrAsOfDate();
        } catch {
          // Titles listing is optional for discover.
        }
      }
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const slice = defaultTargets.slice(start, start + limit);
      const items: AdapterDiscoverItem[] = slice.map((t) => ({
        sourceExternalId: sectionExternalId(t.title, t.part, t.section),
        canonicalUrl: `https://www.ecfr.gov/current/title-${t.title}/part-${t.part}/section-${t.section}`,
        titleHint: `${t.title} C.F.R. § ${t.section}`,
        jurisdiction: "US",
      }));
      const next = start + slice.length;
      return {
        items,
        nextCursor: next < defaultTargets.length ? String(next) : undefined,
      };
    },

    async fetch(items: AdapterDiscoverItem[]) {
      const date = await resolveEcfrAsOfDate();
      const results: AdapterFetchResult[] = [];
      for (const item of items) {
        const match = /^ecfr-t(\d+)-p(.+)-s(.+)$/.exec(item.sourceExternalId);
        if (!match) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: "invalid_external_id" },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        const title = Number(match[1]);
        const part = match[2]!;
        const section = match[3]!;
        await sleep(rateLimitMs);
        const fetched = await fetchEcfrSection(title, part, section, date);
        if (!fetched.ok) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: `http_${fetched.status}`, url: fetched.url, date: fetched.date },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        results.push({
          sourceExternalId: item.sourceExternalId,
          raw: { title, part, section, date: fetched.date, payload: fetched.json },
          retrievedAt: new Date().toISOString(),
          canonicalUrl: item.canonicalUrl ?? fetched.url,
        });
      }
      return results;
    },

    async parse(fetched: AdapterFetchResult[]): Promise<AdapterParseResult> {
      const records: AdapterAuthorityRecord[] = [];
      const quarantined: AdapterParseResult["quarantined"] = [];

      for (const row of fetched) {
        const raw = row.raw as {
          error?: string;
          title?: number;
          part?: string;
          section?: string;
          date?: string;
          payload?: unknown;
        };
        if (raw.error || !raw.payload || raw.title == null || !raw.part || !raw.section) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: raw.error
              ? `eCFR fetch failed: ${raw.error}`
              : "eCFR payload missing title/part/section.",
            raw: row.raw,
          });
          continue;
        }
        const text = sanitizeUntrustedLegalText(extractTextFromSectionJson(raw.payload));
        if (text.length < 20) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "eCFR section text empty or too short after sanitize; not inventing regulation text.",
            raw: row.raw,
          });
          continue;
        }
        const citation = `${raw.title} C.F.R. § ${raw.section}`;
        records.push({
          title: citation,
          authorityType: "regulation",
          content: text,
          sourceProvider: "ecfr",
          sourceExternalId: row.sourceExternalId,
          citation,
          normalizedCitation: citation,
          jurisdiction: "US",
          authorityState: "US",
          canonicalSourceUrl: row.canonicalUrl ?? null,
          effectiveDate: raw.date ?? null,
          contentHash: sha256(text),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_OFFICIAL",
          hierarchyPath: [
            { level: "title", ref: String(raw.title) },
            { level: "part", ref: raw.part },
            { level: "section", ref: raw.section },
          ],
          sourceMetadata: {
            adapter: "ecfr",
            asOfDate: raw.date,
            retrievedAt: row.retrievedAt,
          },
        });
      }

      return { records, quarantined };
    },
  };

  return adapter;
}
