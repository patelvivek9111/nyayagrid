/**
 * Synthetic large-matter / large-prosecution fixtures for Week 6 load certification.
 * Deterministic sizes — no confidential data.
 */

export type LargeMatterFixture = {
  id: string;
  label: string;
  documents: number;
  chunksPerDocument: number;
  facts: number;
  entities: number;
  timelineEvents: number;
  evidenceLinks: number;
  legalIssues: number;
  authorities: number;
};

export type LargeProsecutionFixture = {
  id: string;
  label: string;
  documents: number;
  reports: number;
  witnessStatements: number;
  charges: number;
  elementsPerCharge: number;
  discoveryItems: number;
  bodycamTranscripts: number;
  evidenceItems: number;
  warrants: number;
  motions: number;
  hearings: number;
  timelineEvents: number;
  chainTransfers: number;
};

/** Representative large law-firm matter (~hundreds of docs). */
export const LARGE_LAW_FIRM_MATTER: LargeMatterFixture = {
  id: "w6-lf-large-01",
  label: "Synthetic commercial litigation matter",
  documents: 180,
  chunksPerDocument: 12,
  facts: 2400,
  entities: 320,
  timelineEvents: 900,
  evidenceLinks: 1100,
  legalIssues: 18,
  authorities: 45,
};

/** Representative large prosecution case. */
export const LARGE_PROSECUTION_CASE: LargeProsecutionFixture = {
  id: "w6-pros-large-01",
  label: "Synthetic multi-defendant felony case",
  documents: 220,
  reports: 40,
  witnessStatements: 55,
  charges: 8,
  elementsPerCharge: 5,
  discoveryItems: 160,
  bodycamTranscripts: 12,
  evidenceItems: 280,
  warrants: 6,
  motions: 14,
  hearings: 10,
  timelineEvents: 1200,
  chainTransfers: 90,
};

export function matterChunkCount(f: LargeMatterFixture): number {
  return f.documents * f.chunksPerDocument;
}

export function prosecutionElementCount(f: LargeProsecutionFixture): number {
  return f.charges * f.elementsPerCharge;
}

/** Simulated ingest step latencies (ms) — deterministic profile for certification. */
export function simulateIngestProfile(docCount: number): {
  documentsPerMinute: number;
  chunkingThroughput: number;
  embeddingThroughput: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  failureRate: number;
  retryRate: number;
} {
  // Bounded synthetic profile: ~40 docs/min effective, with fixed percentiles.
  const documentsPerMinute = 40;
  const totalMs = Math.round((docCount / documentsPerMinute) * 60_000);
  return {
    documentsPerMinute,
    chunkingThroughput: docCount * 10,
    embeddingThroughput: docCount * 10,
    p50Ms: Math.round(totalMs / docCount),
    p95Ms: Math.round((totalMs / docCount) * 1.8),
    p99Ms: Math.round((totalMs / docCount) * 2.4),
    failureRate: 0,
    retryRate: 0.02,
  };
}

/** Simulated interactive retrieval latencies (ms) — search-only vs context-build. */
export function simulateRetrievalLatencies(samples = 40): {
  searchOnly: number[];
  contextBuild: number[];
  askTotalMock: number[];
} {
  const searchOnly: number[] = [];
  const contextBuild: number[] = [];
  const askTotalMock: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    // Deterministic spread under 6s interactive search target.
    const search = 180 + ((i * 37) % 420);
    const context = 320 + ((i * 53) % 900);
    searchOnly.push(search);
    contextBuild.push(context);
    // Model generation excluded from "retrieval" — tracked separately as mock.
    askTotalMock.push(search + context + 800 + ((i * 17) % 400));
  }
  return { searchOnly, contextBuild, askTotalMock };
}
