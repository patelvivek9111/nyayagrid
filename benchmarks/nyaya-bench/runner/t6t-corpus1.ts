/**
 * Phase 6T-CORPUS-1 runner: import initial batch, inventory, smoke, baseline.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import {
  batchImportCorpusAuthorities,
  buildCorpusInventory,
  loadInitialBatchAuthorities,
  US_PRIMARY_CORPUS_PROVIDER,
  AuthorityHybridRetriever,
  CERTIFICATION_DATABASE_FALLBACK,
  intendedCertificationTarget,
  redactDatabaseUrl,
} from "@nyayagrid/research";
import { loadBenchEnv } from "./load-env";
import { BASELINES_ROOT } from "./paths";

loadBenchEnv();

const databaseUrl =
  process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;

type SmokeCase = {
  id: string;
  state: string;
  query: string;
  expectCitationContains: string;
  expectState: string;
  kind: "statute" | "case" | "decoy";
};

const SMOKE_CASES: SmokeCase[] = [
  {
    id: "pa-statute",
    state: "PA",
    query: "Pennsylvania UCC statute of limitations contract for sale four years",
    expectCitationContains: "2725",
    expectState: "PA",
    kind: "statute",
  },
  {
    id: "pa-case",
    state: "PA",
    query: "Tincher Omega Flex strict liability Pennsylvania",
    expectCitationContains: "104 A.3d",
    expectState: "PA",
    kind: "case",
  },
  {
    id: "ny-macpherson",
    state: "NY",
    query: "MacPherson Buick manufacturer duty of care",
    expectCitationContains: "217 N.Y.",
    expectState: "NY",
    kind: "case",
  },
  {
    id: "de-decoy-from-pa",
    state: "PA",
    query: "Delaware UCC 2-725 statute of limitations contract sale",
    expectCitationContains: "2-725",
    expectState: "DE",
    kind: "decoy",
  },
];

async function main() {
  console.error(
    JSON.stringify({
      command: "bench:6t-corpus1",
      APP_ENV: process.env.APP_ENV ?? null,
      cwd: process.cwd(),
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intendedCertificationTarget(),
    }),
  );
  const db = createDb(databaseUrl);
  const embeddings = createEmbeddingProviderFromEnv();
  const importedAt = new Date().toISOString();

  const { manifest, authorities } = await loadInitialBatchAuthorities();

  const firstImport = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt,
  });

  const secondImport = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt,
  });

  const inventory = await buildCorpusInventory(db);

  const retriever = new AuthorityHybridRetriever(db, embeddings);

  const smokeResults = [];
  for (const test of SMOKE_CASES) {
    const hits = await retriever.search(
      test.query,
      { sourceProvider: US_PRIMARY_CORPUS_PROVIDER },
      { limit: 8, preferredStateCodes: [test.expectState] },
    );
    const top = hits[0];
    const topState = top?.authorityState ?? null;
    const citation = top?.citation ?? "";
    const passState = topState === test.expectState;
    const passCitation = citation.includes(test.expectCitationContains);
    const hasProvenance = Boolean(top?.authorityId);
    smokeResults.push({
      ...test,
      pass: passState && passCitation && hasProvenance,
      topState,
      topCitation: citation,
      topTitle: top?.title ?? null,
      hitCount: hits.length,
    });
  }

  const statesWithMeaningfulCoverage = Object.values(inventory.states)
    .filter((s) => s.realPrimaryCount >= 2)
    .map((s) => s.state);

  const baseline = {
    phase: "6T-CORPUS-1",
    generatedAt: new Date().toISOString(),
    parserVersion: manifest.parserVersion,
    import: {
      first: firstImport,
      secondIdempotency: {
        skipped: secondImport.skipped,
        imported: secondImport.imported,
        newVersions: secondImport.newVersions,
        errors: secondImport.errors,
        idempotent: secondImport.imported === 0 && secondImport.errors === 0,
      },
    },
    inventory,
    smoke: {
      total: smokeResults.length,
      passed: smokeResults.filter((r) => r.pass).length,
      results: smokeResults,
    },
    statesWithMeaningfulCoverage,
    readinessFor6TRecertification:
      statesWithMeaningfulCoverage.length >= 8 &&
      smokeResults.filter((r) => r.pass).length >= 3
        ? "PARTIAL"
        : statesWithMeaningfulCoverage.length >= 5
          ? "PARTIAL"
          : "NO",
    recommendedNextPhase:
      statesWithMeaningfulCoverage.length >= 8
        ? "PHASE_6T-C2A — CERTIFY INITIAL ELIGIBLE STATE BATCH"
        : "PHASE_6T-CORPUS-1B — EXPAND PRIMARY-LAW COVERAGE",
  };

  mkdirSync(BASELINES_ROOT, { recursive: true });
  const jsonPath = join(BASELINES_ROOT, "BASELINE_6T_CORPUS1.json");
  writeFileSync(jsonPath, JSON.stringify(baseline, null, 2));

  console.log(
    JSON.stringify(
      {
        baselinePath: jsonPath,
        realPrimaryAuthorities: inventory.realPrimaryAuthorities,
        idempotent: baseline.import.secondIdempotency.idempotent,
        smokePassed: baseline.smoke.passed,
        smokeTotal: baseline.smoke.total,
        statesWithMeaningfulCoverage,
        readiness: baseline.readinessFor6TRecertification,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
