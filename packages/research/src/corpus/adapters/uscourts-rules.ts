/**
 * uscourts.gov Federal Rules adapter (non-CourtListener).
 * Discover is curated; fetch pulls official HTML and refuses to invent rule text.
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

export type FederalRuleKind = "civ" | "evid" | "app" | "crim";

export type FederalRuleTarget = {
  kind: FederalRuleKind;
  rule: string;
  slug: string;
};

export type UscourtsRulesAdapterOptions = {
  rateLimitMs?: number;
  fetchImpl?: typeof fetch;
  targets?: FederalRuleTarget[];
};

const KIND_META: Record<FederalRuleKind, { reporter: string; path: string; label: string }> = {
  civ: {
    reporter: "Fed. R. Civ. P.",
    path: "rules-civil-procedure",
    label: "Federal Rules of Civil Procedure",
  },
  evid: {
    reporter: "Fed. R. Evid.",
    path: "rules-evidence",
    label: "Federal Rules of Evidence",
  },
  app: {
    reporter: "Fed. R. App. P.",
    path: "rules-appellate-procedure",
    label: "Federal Rules of Appellate Procedure",
  },
  crim: {
    reporter: "Fed. R. Crim. P.",
    path: "rules-criminal-procedure",
    label: "Federal Rules of Criminal Procedure",
  },
};

export const DEFAULT_FEDERAL_RULE_TARGETS: FederalRuleTarget[] = [
  { kind: "civ", rule: "4", slug: "rule-4-summons" },
  { kind: "civ", rule: "12", slug: "rule-12-defenses-and-objections-when-and-how-presented-motions" },
  { kind: "civ", rule: "56", slug: "rule-56-summary-judgment" },
  { kind: "evid", rule: "401", slug: "rule-401-test-relevant-evidence" },
  { kind: "evid", rule: "702", slug: "rule-702-testimony-expert-witnesses" },
  { kind: "app", rule: "32.1", slug: "rule-321-citing-judicial-dispositions" },
  { kind: "crim", rule: "11", slug: "rule-11-pleas" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function federalRuleCitation(kind: FederalRuleKind, rule: string): string {
  return `${KIND_META[kind].reporter} ${rule}`;
}

export function uscourtsRuleUrl(target: FederalRuleTarget): string {
  return `https://www.uscourts.gov/forms-rules/current-rules/${KIND_META[target.kind].path}/${target.slug}`;
}

function stripHtml(html: string): string {
  return sanitizeUntrustedLegalText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export function createUscourtsRulesAdapter(options: UscourtsRulesAdapterOptions = {}): LegalSourceAdapter {
  const rateLimitMs = options.rateLimitMs ?? 400;
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = options.targets ?? DEFAULT_FEDERAL_RULE_TARGETS;

  const adapter: LegalSourceAdapter = {
    name: "uscourts_rules",
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
        sourceExternalId: `uscourts-${row.kind}-${row.rule}`,
        canonicalUrl: uscourtsRuleUrl(row),
        titleHint: federalRuleCitation(row.kind, row.rule),
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
        const match = /^uscourts-(civ|evid|app|crim)-(.+)$/.exec(item.sourceExternalId);
        const target = match
          ? targets.find((t) => t.kind === match[1] && t.rule === match[2]) || {
              kind: match[1] as FederalRuleKind,
              rule: match[2]!,
              slug: item.canonicalUrl?.split("/").pop() || "",
            }
          : null;
        if (!target) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { error: "unparsed_federal_rule_ref" },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: item.canonicalUrl,
          });
          continue;
        }
        const url = item.canonicalUrl ?? uscourtsRuleUrl(target);
        await sleep(rateLimitMs);
        try {
          const res = await fetchImpl(url, {
            headers: { Accept: "text/html", "User-Agent": "NyayaGridCorpus/queue2" },
          });
          if (!res.ok) {
            results.push({
              sourceExternalId: item.sourceExternalId,
              raw: { error: `http_${res.status}`, target, url },
              retrievedAt: new Date().toISOString(),
              canonicalUrl: url,
            });
            continue;
          }
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: { target, url, html: await res.text() },
            retrievedAt: new Date().toISOString(),
            canonicalUrl: url,
          });
        } catch (error) {
          results.push({
            sourceExternalId: item.sourceExternalId,
            raw: {
              error: error instanceof Error ? error.message : "fetch_failed",
              target,
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
          target?: FederalRuleTarget;
          url?: string;
          html?: string;
        };
        if (raw.error || !raw.target || !raw.html) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: raw.error
              ? `uscourts.gov fetch failed: ${raw.error}`
              : "Federal rule HTML not retrieved; refusing to invent rule text.",
            raw: row.raw,
          });
          continue;
        }
        const content = stripHtml(raw.html);
        if (content.length < 40) {
          quarantined.push({
            sourceExternalId: row.sourceExternalId,
            reason: "uscourts.gov returned insufficient rule text after sanitize.",
            raw: { target: raw.target, url: raw.url },
          });
          continue;
        }
        const citation = federalRuleCitation(raw.target.kind, raw.target.rule);
        const meta = KIND_META[raw.target.kind];
        records.push({
          title: `${citation} — ${meta.label}`,
          authorityType: "rule",
          content,
          sourceProvider: "uscourts_rules",
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
            { level: "rules", ref: meta.reporter, label: meta.label },
            { level: "rule", ref: raw.target.rule },
          ],
          sourceMetadata: {
            adapter: "uscourts_rules",
            retrievedAt: row.retrievedAt,
          },
        });
      }
      return { records, quarantined };
    },
  };

  return adapter;
}
