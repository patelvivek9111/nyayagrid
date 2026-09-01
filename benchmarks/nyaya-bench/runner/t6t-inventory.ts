import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";
import { listUsStates, normalizeStateCode } from "@nyayagrid/jurisdiction";
import {
  CERTIFICATION_DATABASE_FALLBACK,
  US_PRIMARY_CORPUS_PROVIDER,
  intendedCertificationTarget,
  redactDatabaseUrl,
  summarizeCorpusCoverage,
} from "@nyayagrid/research";

loadBenchEnv();

const connection = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;

const sql = postgres(connection, { max: 1 });

type AuthorityRow = {
  id: string;
  authority_type: string;
  jurisdiction: string | null;
  court: string | null;
  court_id: string | null;
  authority_state: string | null;
  federal_circuit: string | null;
  court_level: string | null;
  decision_date: string | Date | null;
  effective_date: string | Date | null;
  source_provider: string | null;
  metadata: Record<string, unknown> | null;
};

function asState(row: AuthorityRow): string | null {
  return (
    (row.authority_state ? normalizeStateCode(row.authority_state) : null) ??
    (row.jurisdiction ? normalizeStateCode(row.jurisdiction) : null)
  );
}

const [server] = await sql<{
  current_database: string;
  current_schema: string;
  search_path: string;
}[]>`
  SELECT
    current_database() AS current_database,
    current_schema() AS current_schema,
    current_setting('search_path') AS search_path
`;

const rows = await sql<AuthorityRow[]>`
  SELECT
    id,
    authority_type::text AS authority_type,
    jurisdiction,
    court,
    court_id,
    authority_state,
    federal_circuit,
    court_level,
    decision_date,
    effective_date,
    source_provider,
    metadata
  FROM legal_authorities
`;

const coverage = summarizeCorpusCoverage(
  rows.map((row) => ({
    sourceProvider: row.source_provider,
    authorityType: row.authority_type,
    authorityState: row.authority_state,
    courtId: row.court_id,
    metadata: row.metadata,
  })),
);

const realRows = rows.filter((row) => row.source_provider === US_PRIMARY_CORPUS_PROVIDER);
const syntheticOrOther = rows.filter((row) => row.source_provider !== US_PRIMARY_CORPUS_PROVIDER);

const states = [...listUsStates().map((s) => s.code)];
const byState = Object.fromEntries(
  states.map((code) => {
    const authorities = realRows.filter((row) => asState(row) === code);
    const normalized = authorities.filter((row) => row.court_id || row.authority_state || row.court_level);
    const withEffective = authorities.filter((row) => row.effective_date);
    return [
      code,
      {
        state: code,
        authorityCount: authorities.length,
        realPrimaryCount: authorities.length,
        statuteCount: authorities.filter((row) => row.authority_type === "statute").length,
        caseCount: authorities.filter((row) => row.authority_type === "case").length,
        regulationCount: authorities.filter((row) => row.authority_type === "regulation").length,
        stateHighCount: authorities.filter((row) => row.court_level === "state_high").length,
        stateAppellateCount: authorities.filter((row) => row.court_level === "state_appellate").length,
        stateTrialCount: authorities.filter((row) => row.court_level === "state_trial").length,
        federalDistrictCount: authorities.filter((row) => row.court_level === "district").length,
        circuitCount: authorities.filter((row) => row.court_level === "circuit").length,
        normalizedMetadataPercent:
          authorities.length === 0 ? 0 : Math.round((normalized.length / authorities.length) * 1000) / 10,
        effectiveDateCoveragePercent:
          authorities.length === 0 ? 0 : Math.round((withEffective.length / authorities.length) * 1000) / 10,
        sampleJurisdictions: [
          ...new Set(authorities.map((row) => row.jurisdiction).filter(Boolean)),
        ].slice(0, 8),
      },
    ];
  }),
);

const unmappedReal = realRows.filter((row) => !asState(row));
const unmappedSynthetic = syntheticOrOther.filter((row) => !asState(row));
const unmappedJurisdictions: Record<string, number> = {};
for (const row of unmappedSynthetic) {
  const key = row.jurisdiction ?? "(null)";
  unmappedJurisdictions[key] = (unmappedJurisdictions[key] ?? 0) + 1;
}

const environment = {
  APP_ENV: process.env.APP_ENV ?? null,
  NODE_ENV: process.env.NODE_ENV ?? null,
  cwd: process.cwd(),
  database: redactDatabaseUrl(connection),
  schema: server?.current_schema ?? null,
  searchPath: server?.search_path ?? null,
  currentDatabase: server?.current_database ?? null,
  intendedCertification: intendedCertificationTarget(),
};

const inventory = {
  generatedAt: new Date().toISOString(),
  environment,
  totalAuthorities: coverage.totalAuthorities,
  realPrimaryAuthorities: coverage.realPrimaryAuthorities,
  syntheticAuthorities: coverage.syntheticAuthorities,
  otherAuthorities: coverage.otherAuthorities,
  typeCounts: coverage.typeCounts,
  realTypeCounts: coverage.realTypeCounts,
  sourceProviders: coverage.sourceProviders,
  unmappedCount: unmappedSynthetic.length + unmappedReal.length,
  unmappedRealCount: unmappedReal.length,
  unmappedJurisdictions,
  statesWithRealAuthorities: coverage.realStatesWithAuthorities.length,
  realStatuteCount: coverage.realStatuteCount,
  realCaseCount: coverage.realCaseCount,
  realRegulationCount: coverage.realRegulationCount,
  states: byState,
};

mkdirSync(BASELINES_ROOT, { recursive: true });
writeFileSync(join(BASELINES_ROOT, "BASELINE_6T_CORPUS_INVENTORY.json"), JSON.stringify(inventory, null, 2));
console.log(
  JSON.stringify(
    {
      environment,
      totalAuthorities: coverage.totalAuthorities,
      realPrimaryAuthorities: coverage.realPrimaryAuthorities,
      syntheticAuthorities: coverage.syntheticAuthorities,
      typeCounts: coverage.typeCounts,
      realTypeCounts: coverage.realTypeCounts,
      sourceProviders: coverage.sourceProviders,
      unmappedCount: inventory.unmappedCount,
      statesWithRealAuthorities: coverage.realStatesWithAuthorities.length,
      realStates: coverage.realStatesWithAuthorities,
      inventoryPath: join(dirname(fileURLToPath(import.meta.url)), "..", "baselines", "BASELINE_6T_CORPUS_INVENTORY.json"),
    },
    null,
    2,
  ),
);

await sql.end();
