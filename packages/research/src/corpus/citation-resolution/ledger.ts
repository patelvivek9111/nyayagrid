/**
 * Corpus-owned reversible resolution ledger (JSONL).
 * Does not use shared product migrations. Original raw citations are never overwritten.
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RESOLVER_VERSION, type CitationResolutionRecord, type ResolutionMethod } from "./types.js";

export function createResolutionRecord(input: {
  rawCitation: string;
  normalizedCitation: string | null;
  targetKey: string;
  fromAuthorityId?: string | null;
  citationEdgeId?: string | null;
  toAuthorityId: string;
  method: ResolutionMethod;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
  externalIdentity?: CitationResolutionRecord["externalIdentity"];
  state?: "AUTHORITY_RESOLVED" | "CORPUS_COMPLETE";
}): CitationResolutionRecord {
  return {
    id: randomUUID(),
    rawCitation: input.rawCitation,
    normalizedCitation: input.normalizedCitation,
    targetKey: input.targetKey,
    fromAuthorityId: input.fromAuthorityId ?? null,
    citationEdgeId: input.citationEdgeId ?? null,
    toAuthorityId: input.toAuthorityId,
    externalIdentity: input.externalIdentity ?? null,
    method: input.method,
    confidence: input.confidence,
    state: input.state ?? "AUTHORITY_RESOLVED",
    evidence: input.evidence,
    resolverVersion: RESOLVER_VERSION,
    createdAt: new Date().toISOString(),
    supersededAt: null,
    supersededBy: null,
    active: true,
  };
}

export function supersedeRecord(
  previous: CitationResolutionRecord,
  nextId: string,
): CitationResolutionRecord {
  return {
    ...previous,
    active: false,
    supersededAt: new Date().toISOString(),
    supersededBy: nextId,
  };
}

export function appendLedger(path: string, records: CitationResolutionRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
  appendFileSync(path, lines, "utf8");
}

export function loadLedger(path: string): CitationResolutionRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: CitationResolutionRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CitationResolutionRecord);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

export function activeRecordsByEdge(ledger: CitationResolutionRecord[]): Map<string, CitationResolutionRecord> {
  const map = new Map<string, CitationResolutionRecord>();
  for (const r of ledger) {
    if (!r.active || !r.citationEdgeId) continue;
    map.set(r.citationEdgeId, r);
  }
  return map;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, readFileSync(tmp, "utf8"), "utf8");
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}
