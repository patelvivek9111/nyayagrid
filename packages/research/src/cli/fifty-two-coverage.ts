/**
 * Emit 52-jurisdiction (US + 50 states + DC) coverage report from
 * live bundle matrix + jurisdiction source registry.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundleCoverageMatrix } from "../corpus/coverage-matrix";
import { listJurisdictionSources } from "../corpus/jurisdiction-sources";

async function main() {
  const matrix = await buildBundleCoverageMatrix();
  const registry = listJurisdictionSources();
  const byCode = new Map(matrix.states.map((s) => [s.jurisdiction, s]));
  byCode.set("US", matrix.federal);

  const rows = registry.map((src) => {
    const cov = byCode.get(src.code);
    return {
      code: src.code,
      displayName: src.displayName,
      type: src.type,
      corpusStatus: cov?.coverageClass ?? src.coverageStatus,
      authorityCount: cov?.authorityCount ?? 0,
      statutes: cov?.statutesPresent ?? false,
      casesHigh: cov?.highCourtCasesPresent ?? false,
      casesAppellate: cov?.intermediateAppellateCasesPresent ?? false,
      regulations: cov?.regulationsPresent ?? false,
      courtRules: cov?.courtRulesPresent ?? false,
      constitution: cov?.constitutionPresent ?? false,
      importerStatus: src.importerStatus,
      statuteSource: src.officialLegislatureUrl,
      caseSource: src.officialJudiciaryUrl,
      regulationSource: src.officialRegulationUrl,
      ruleSource: src.officialCourtRulesUrl,
      caseAdapters: src.caseSourceAdapters,
      statuteAdapters: src.statuteSourceAdapters,
      courtMapping: Boolean(src.highestCourtName),
      highestCourt: src.highestCourtName,
      notes: [...(cov?.notes ?? []), ...src.notes].slice(0, 6),
    };
  });

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../corpus/reports");
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "fifty-two-jurisdiction-coverage.json");
  const payload = {
    generatedAt: new Date().toISOString(),
    phase: matrix.phase,
    parserVersion: matrix.parserVersion,
    bundleAuthorityCount: matrix.bundleAuthorityCount,
    entryCount: rows.length,
    summary: {
      limited: rows.filter((r) => r.corpusStatus === "limited_corpus").length,
      seed: rows.filter((r) => r.corpusStatus === "seed_corpus").length,
      noCorpus: rows.filter((r) => r.corpusStatus === "no_corpus").length,
      broader: rows.filter((r) => r.corpusStatus === "broader_corpus").length,
      withRegulations: rows.filter((r) => r.regulations).length,
      withCourtRules: rows.filter((r) => r.courtRules).length,
    },
    honestClaims: matrix.honestClaims,
    jurisdictions: rows,
  };
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  const lines = [
    `# 52-jurisdiction primary-law coverage`,
    ``,
    `Generated: ${payload.generatedAt}`,
    `Authorities in bundles: ${payload.bundleAuthorityCount}`,
    `Entries: ${payload.entryCount} (US + 50 states + DC)`,
    ``,
    `| Code | Status | n | Stat | High | App | Reg | Rules | Importer |`,
    `|---|---|---:|---|---|---|---|---|---|`,
    ...rows.map(
      (r) =>
        `| ${r.code} | ${r.corpusStatus} | ${r.authorityCount} | ${r.statutes ? "Y" : "-"} | ${r.casesHigh ? "Y" : "-"} | ${r.casesAppellate ? "Y" : "-"} | ${r.regulations ? "Y" : "-"} | ${r.courtRules ? "Y" : "-"} | ${r.importerStatus} |`,
    ),
    ``,
    `Not exhaustive. Not Westlaw/Lexis equivalent. No Shepard's/KeyCite.`,
    ``,
  ];
  await writeFile(join(outDir, "fifty-two-jurisdiction-coverage.md"), lines.join("\n"), "utf-8");
  console.log(JSON.stringify({ jsonPath, entryCount: rows.length, summary: payload.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
