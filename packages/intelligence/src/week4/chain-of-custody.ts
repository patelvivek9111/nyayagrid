import type { SourceProvenance } from "../legal/types";

export type CustodyTransfer = {
  actor: string;
  timestamp: string;
  from: string | null;
  to: string;
  location?: string | null;
  source: SourceProvenance;
  notes?: string | null;
};

export type CustodyFinding =
  | { code: "CHAIN_GAP"; message: string; index: number }
  | { code: "SEQUENCE_INCONSISTENCY"; message: string; index: number }
  | { code: "MISSING_RECORD"; message: string; index: number }
  | { code: "UNKNOWN"; message: string; index: number };

export function normalizeCustody(raw: unknown): CustodyTransfer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): CustodyTransfer | null => {
      if (typeof entry === "string") {
        return {
          actor: "unknown",
          timestamp: "date unknown",
          from: null,
          to: entry,
          source: { extractionOrigin: "import", humanEntered: false, sourceSpan: entry },
          notes: entry,
        };
      }
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const to = typeof row.to === "string" ? row.to : typeof row.holder === "string" ? row.holder : null;
      if (!to) return null;
      return {
        actor: typeof row.actor === "string" ? row.actor : "unknown",
        timestamp: typeof row.timestamp === "string" ? row.timestamp : "date unknown",
        from: typeof row.from === "string" ? row.from : null,
        to,
        location: typeof row.location === "string" ? row.location : null,
        source:
          (row.source as SourceProvenance | undefined) ??
          ({ extractionOrigin: "import", humanEntered: false, sourceSpan: to } as SourceProvenance),
        notes: typeof row.notes === "string" ? row.notes : null,
      };
    })
    .filter((entry): entry is CustodyTransfer => Boolean(entry));
}

export function validateChainOfCustody(transfers: CustodyTransfer[]): CustodyFinding[] {
  const findings: CustodyFinding[] = [];
  if (transfers.length === 0) {
    findings.push({ code: "MISSING_RECORD", message: "No custody transfers were recorded.", index: -1 });
    return findings;
  }
  for (let index = 0; index < transfers.length; index += 1) {
    const current = transfers[index]!;
    if (!current.source?.documentId && !current.source?.sourceSpan && !current.source?.humanEntered) {
      findings.push({ code: "MISSING_RECORD", message: "Custody transfer lacks source provenance.", index });
    }
    if (current.actor === "unknown") {
      findings.push({ code: "UNKNOWN", message: "Custody holder or actor is unknown.", index });
    }
    if (index === 0) continue;
    const previous = transfers[index - 1]!;
    if (current.from && previous.to && current.from !== previous.to) {
      findings.push({
        code: "CHAIN_GAP",
        message: `Transfer from ${current.from} does not continue from prior holder ${previous.to}.`,
        index,
      });
    }
    if (
      current.timestamp !== "date unknown" &&
      previous.timestamp !== "date unknown" &&
      current.timestamp < previous.timestamp
    ) {
      findings.push({
        code: "SEQUENCE_INCONSISTENCY",
        message: "A later custody transfer is dated before an earlier transfer.",
        index,
      });
    }
  }
  return findings;
}
