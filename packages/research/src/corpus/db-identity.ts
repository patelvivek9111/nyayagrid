import { isRealPrimarySourceProvider, isSyntheticBenchSource, US_PRIMARY_CORPUS_PROVIDER } from "./source-classes";

/** Host-side default for the persistent local certification database (Docker maps 5433→5432). */
export const CERTIFICATION_DATABASE_FALLBACK =
  "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

export type RedactedDatabaseTarget = {
  protocol: string;
  host: string;
  port: string;
  database: string;
  hasUser: boolean;
  hasPassword: boolean;
};

export function redactDatabaseUrl(url: string): RedactedDatabaseTarget {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "(default)",
    database: parsed.pathname.replace(/^\//, "").split("?")[0] ?? "",
    hasUser: Boolean(parsed.username),
    hasPassword: Boolean(parsed.password),
  };
}

export type AuthorityIdentityRow = {
  sourceProvider: string | null;
  authorityType: string;
  authorityState: string | null;
  courtId: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CorpusCoverageSummary = {
  totalAuthorities: number;
  realPrimaryAuthorities: number;
  syntheticAuthorities: number;
  otherAuthorities: number;
  realTypeCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  sourceProviders: Record<string, number>;
  byAuthorityState: Record<string, number>;
  realStatesWithAuthorities: string[];
  realStatuteCount: number;
  realCaseCount: number;
  realRegulationCount: number;
  realNormalizedStateCount: number;
  realNormalizedCourtIdCount: number;
};

export function summarizeCorpusCoverage(rows: AuthorityIdentityRow[]): CorpusCoverageSummary {
  const typeCounts: Record<string, number> = {};
  const realTypeCounts: Record<string, number> = {};
  const sourceProviders: Record<string, number> = {};
  const byAuthorityState: Record<string, number> = {};
  const realStateSet = new Set<string>();
  let realPrimaryAuthorities = 0;
  let syntheticAuthorities = 0;
  let realStatuteCount = 0;
  let realCaseCount = 0;
  let realRegulationCount = 0;
  let realNormalizedStateCount = 0;
  let realNormalizedCourtIdCount = 0;

  for (const row of rows) {
    const provider = row.sourceProvider ?? "(null)";
    typeCounts[row.authorityType] = (typeCounts[row.authorityType] ?? 0) + 1;
    sourceProviders[provider] = (sourceProviders[provider] ?? 0) + 1;
    const stateKey = row.authorityState ?? "(null)";
    byAuthorityState[stateKey] = (byAuthorityState[stateKey] ?? 0) + 1;

    const synthetic = isSyntheticBenchSource(provider, row.metadata);
    const real = isRealPrimarySourceProvider(provider);
    if (real) {
      realPrimaryAuthorities += 1;
      realTypeCounts[row.authorityType] = (realTypeCounts[row.authorityType] ?? 0) + 1;
      if (row.authorityType === "statute") realStatuteCount += 1;
      if (row.authorityType === "case") realCaseCount += 1;
      if (row.authorityType === "regulation") realRegulationCount += 1;
      if (row.authorityState) {
        realNormalizedStateCount += 1;
        realStateSet.add(row.authorityState);
      }
      if (row.courtId) realNormalizedCourtIdCount += 1;
    } else if (synthetic) {
      syntheticAuthorities += 1;
    }
  }

  return {
    totalAuthorities: rows.length,
    realPrimaryAuthorities,
    syntheticAuthorities,
    otherAuthorities: rows.length - realPrimaryAuthorities - syntheticAuthorities,
    realTypeCounts,
    typeCounts,
    sourceProviders,
    byAuthorityState,
    realStatesWithAuthorities: [...realStateSet].sort(),
    realStatuteCount,
    realCaseCount,
    realRegulationCount,
    realNormalizedStateCount,
    realNormalizedCourtIdCount,
  };
}

export function intendedCertificationTarget(): {
  label: string;
  host: string;
  port: string;
  database: string;
  appEnv: string;
  realSourceProvider: string;
} {
  return {
    label: "persistent-local-docker-nyayagrid",
    host: "localhost",
    port: "5433",
    database: "nyayagrid",
    appEnv: "development",
    realSourceProvider: US_PRIMARY_CORPUS_PROVIDER,
  };
}
