/**
 * Source adapter contract for NyayaGrid legal corpus expansion.
 * Offline/server-side ingestion only — never enables silent Web Research.
 */

import type { ImportAuthorityInput } from "../../ingest";
import type { SourceClass } from "../source-classes";

export type AdapterAuthorityRecord = ImportAuthorityInput & {
  contentHash?: string;
  retrievedAt?: string;
  sourceClass?: SourceClass;
  quarantineReason?: string;
};

export type AdapterDiscoverItem = {
  sourceExternalId: string;
  canonicalUrl?: string;
  titleHint?: string;
  jurisdiction?: string;
};

export type AdapterFetchResult = {
  sourceExternalId: string;
  raw: unknown;
  retrievedAt: string;
  canonicalUrl?: string;
};

export type AdapterParseResult = {
  records: AdapterAuthorityRecord[];
  quarantined: Array<{ sourceExternalId: string; reason: string; raw?: unknown }>;
};

export type SourceAdapterCapabilities = {
  discover: boolean;
  fetch: boolean;
  parse: boolean;
  rateLimited: boolean;
  requiresApiKey: boolean;
};

/**
 * Pluggable primary-law source adapter.
 * Implementations must never mix tenant/matter data into outputs.
 */
export interface LegalSourceAdapter {
  readonly name: string;
  readonly capabilities: SourceAdapterCapabilities;
  discover?(cursor?: string, limit?: number): Promise<{ items: AdapterDiscoverItem[]; nextCursor?: string }>;
  fetch?(items: AdapterDiscoverItem[]): Promise<AdapterFetchResult[]>;
  parse(fetched: AdapterFetchResult[]): Promise<AdapterParseResult>;
  normalize?(record: AdapterAuthorityRecord): AdapterAuthorityRecord;
  validate?(record: AdapterAuthorityRecord): { ok: boolean; reason?: string };
}

export type IngestCheckpoint = {
  adapterName: string;
  cursor: string | null;
  completedExternalIds: string[];
  failedExternalIds: Array<{ id: string; reason: string }>;
  quarantinedExternalIds: Array<{ id: string; reason: string }>;
  importedCount: number;
  skippedCount: number;
  updatedAt: string;
};

export function emptyCheckpoint(adapterName: string): IngestCheckpoint {
  return {
    adapterName,
    cursor: null,
    completedExternalIds: [],
    failedExternalIds: [],
    quarantinedExternalIds: [],
    importedCount: 0,
    skippedCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

/** Strip scripts and obvious injection payloads from untrusted HTML/text. */
export function sanitizeUntrustedLegalText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/javascript:/gi, "")
    .replace(/ignore previous instructions/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}
