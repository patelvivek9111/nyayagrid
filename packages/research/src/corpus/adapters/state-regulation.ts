/**
 * Config-driven state administrative-code adapter family.
 * Mirrors state_statute: fetch/parse curated or prefetched HTML; no mass scrapers.
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

export type StateRegulationPlatformFamily =
  | "legislative_reference_bureau"
  | "sos_portal"
  | "lis_revisor"
  | "jcar_html"
  | "custom_html";

export type StateRegulationSourceConfig = {
  stateCode: string;
  baseUrl: string;
  platformFamily: StateRegulationPlatformFamily;
  citationPattern?: string;
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

/** Wave-1 tractable official portals (excludes Lexis/Westlaw browse wrappers). */
export const WAVE1_STATE_REGULATION_CONFIGS: Record<string, StateRegulationSourceConfig> = {
  PA: {
    stateCode: "PA",
    baseUrl: "https://www.pacodeandbulletin.gov/",
    platformFamily: "legislative_reference_bureau",
    citationPattern: String.raw`\d+\s+Pa\.\s*Code\s*§\s*[\d.]+`,
  },
  FL: {
    stateCode: "FL",
    baseUrl: "https://www.flrules.org/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`Fla\.\s*Admin\.\s*Code\s*R\.\s*[\dA-Za-z.-]+`,
  },
  VA: {
    stateCode: "VA",
    baseUrl: "https://law.lis.virginia.gov/admincode/",
    platformFamily: "lis_revisor",
    citationPattern: String.raw`\d+VAC[\d.-]+`,
  },
  DE: {
    stateCode: "DE",
    baseUrl: "https://regulations.delaware.gov/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`\d+\s+DE\s+Admin\.\s*Code\s+[\d.]+`,
  },
  IL: {
    stateCode: "IL",
    baseUrl: "https://www.ilga.gov/commission/jcar/admincode/",
    platformFamily: "jcar_html",
    citationPattern: String.raw`Ill\.\s*Admin\.\s*Code\s+tit\.\s*\d+\s*§\s*[\d.]+`,
  },
  OH: {
    stateCode: "OH",
    baseUrl: "https://codes.ohio.gov/ohio-administrative-code/",
    platformFamily: "custom_html",
    citationPattern: String.raw`Ohio\s+Admin\.\s*Code\s+[\d\-.:]+`,
  },
  WA: {
    stateCode: "WA",
    baseUrl: "https://app.leg.wa.gov/WAC/",
    platformFamily: "lis_revisor",
    citationPattern: String.raw`WAC\s+[\d\-]+`,
  },
  CO: {
    stateCode: "CO",
    baseUrl: "https://www.sos.state.co.us/CCR/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`\d+\s+CCR\s+[\d\-]+`,
  },
  MI: {
    stateCode: "MI",
    baseUrl: "https://www.michigan.gov/lara/",
    platformFamily: "custom_html",
    citationPattern: String.raw`Mich\.\s*Admin\.\s*Code\s+R\s+[\d.]+`,
  },
  MD: {
    stateCode: "MD",
    baseUrl: "https://dsd.maryland.gov/Pages/COMARHome.aspx",
    platformFamily: "custom_html",
    citationPattern: String.raw`COMAR\s+[\d.]+`,
  },
  TX: {
    stateCode: "TX",
    baseUrl: "https://www.sos.texas.gov/tac/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`\d+\s+Tex\.\s*Admin\.\s*Code\s*§\s*[\d.]+`,
  },
  NC: {
    stateCode: "NC",
    baseUrl: "https://www.oah.nc.gov/",
    platformFamily: "custom_html",
    citationPattern: String.raw`\d+\s+NCAC\s+[\d.]+`,
  },
  /** Wave 2H — additional official public admin-code hubs (config + curated import). */
  MN: {
    stateCode: "MN",
    baseUrl: "https://www.revisor.mn.gov/rules/",
    platformFamily: "lis_revisor",
    citationPattern: String.raw`Minn\.?\s*R\.?\s*[\d.]+`,
  },
  WI: {
    stateCode: "WI",
    baseUrl: "https://docs.legis.wisconsin.gov/code/admin_code/",
    platformFamily: "lis_revisor",
    citationPattern: String.raw`Wis\.?\s*Admin\.?\s*Code\s+[A-Z]+\s*§\s*[\d.]+`,
  },
  GA: {
    stateCode: "GA",
    baseUrl: "https://rules.sos.ga.gov/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`Ga\.?\s*Comp\.?\s*R\.?\s*&?\s*Regs\.?\s*[\d.\-]+`,
  },
  IN: {
    stateCode: "IN",
    baseUrl: "http://iac.iga.in.gov/",
    platformFamily: "lis_revisor",
    citationPattern: String.raw`\d+\s+IAC\s+[\d.\-]+`,
  },
  OR: {
    stateCode: "OR",
    baseUrl: "https://secure.sos.state.or.us/oard/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`Or\.?\s*Admin\.?\s*R\.?\s*[\d.\-]+`,
  },
  /** Wave 2I — additional official public admin-code hubs. */
  MA: {
    stateCode: "MA",
    baseUrl: "https://www.mass.gov/code-of-massachusetts-regulations-cmr",
    platformFamily: "custom_html",
    citationPattern: String.raw`\d+\s+CMR\s+[\d.]+`,
  },
  AZ: {
    stateCode: "AZ",
    baseUrl: "https://apps.azsos.gov/public_services/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`A\.?\s*A\.?\s*C\.?\s*R[\d\-]+`,
  },
  RI: {
    stateCode: "RI",
    baseUrl: "https://rules.sos.ri.gov/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`\d+-RICR-[\d\-]+`,
  },
  WV: {
    stateCode: "WV",
    baseUrl: "https://apps.sos.wv.gov/adlaw/csr/",
    platformFamily: "sos_portal",
    citationPattern: String.raw`W\.?\s*Va\.?\s*Code\s+R\.?\s*§?\s*[\d\-]+`,
  },
};

export function createStateRegulationAdapter(
  config: StateRegulationSourceConfig,
): LegalSourceAdapter {
  const stateCode = config.stateCode.trim().toUpperCase();
  const rateLimitMs = config.rateLimitMs ?? 750;
  const citationRe = config.citationPattern
    ? new RegExp(config.citationPattern, "i")
    : null;

  const adapter: LegalSourceAdapter = {
    name: `state_regulation_${stateCode.toLowerCase()}`,
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
        sourceExternalId: `${stateCode.toLowerCase()}-reg-${row.id}`,
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
            signal: AbortSignal.timeout(30_000),
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
              platformFamily: config.platformFamily,
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
        };
        if (raw.error) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: `State regulation fetch failed: ${raw.error}`,
            raw: row.raw,
          });
          continue;
        }

        const htmlOrText = raw.html ?? raw.text ?? "";
        if (!htmlOrText.trim()) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "No pre-fetched HTML/text; adapter does not invent regulation text.",
            raw: row.raw,
          });
          continue;
        }

        const content = raw.html
          ? htmlToText(raw.html)
          : sanitizeUntrustedLegalText(raw.text ?? "");
        if (content.length < 20) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "Regulation text too short after sanitize.",
            raw: row.raw,
          });
          continue;
        }

        const title = raw.html
          ? extractTitleFromHtml(htmlOrText, raw.titleHint ?? `${stateCode} regulation`)
          : sanitizeUntrustedLegalText(raw.titleHint ?? `${stateCode} regulation`);

        let citation: string | null = raw.titleHint?.trim() || null;
        if (citationRe && citation && !citationRe.test(citation)) {
          const fromBody = citationRe.exec(content);
          citation = fromBody?.[0] ?? citation;
        }

        const record: AdapterAuthorityRecord = {
          title: title.length >= 3 ? title : `${stateCode} regulation`,
          authorityType: "regulation",
          content,
          sourceProvider: "state_regulation",
          sourceExternalId: row.sourceExternalId,
          citation,
          jurisdiction: stateCode,
          authorityState: stateCode,
          canonicalSourceUrl: row.canonicalUrl ?? null,
          contentHash: sha256(content),
          retrievedAt: row.retrievedAt,
          sourceClass: "PRIMARY_OFFICIAL",
          currentnessStatus: "current_as_of_source_date",
          sourceMetadata: {
            adapter: "state_regulation",
            stateCode,
            platformFamily: config.platformFamily,
            baseUrl: config.baseUrl,
            retrievedAt: row.retrievedAt,
            retrievalMethod: "official_regulation_html",
            note: "Config-driven family adapter; curated discoverPaths only — not a 50-state scrape.",
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

    normalize(record) {
      return {
        ...record,
        authorityState: stateCode,
        jurisdiction: record.jurisdiction ?? stateCode,
      };
    },

    validate(record) {
      if (record.authorityType !== "regulation") {
        return { ok: false, reason: "state_regulation adapter only emits regulation authorities." };
      }
      if (!record.content || record.content.trim().length < 20) {
        return { ok: false, reason: "content_too_short" };
      }
      return { ok: true };
    },
  };

  return adapter;
}

export async function parsePrefetchedStateRegulation(params: {
  config: StateRegulationSourceConfig;
  sourceExternalId: string;
  html: string;
  canonicalUrl: string;
  titleHint?: string;
}): Promise<AdapterParseResult> {
  const adapter = createStateRegulationAdapter(params.config);
  return adapter.parse([
    {
      sourceExternalId: params.sourceExternalId,
      retrievedAt: new Date().toISOString(),
      canonicalUrl: params.canonicalUrl,
      raw: {
        html: params.html,
        titleHint: params.titleHint,
        stateCode: params.config.stateCode,
        platformFamily: params.config.platformFamily,
      },
    },
  ]);
}
