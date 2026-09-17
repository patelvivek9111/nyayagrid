#!/usr/bin/env node
/**
 * Emit machine-readable corpus coverage matrix + 50-state roadmap from seed bundles.
 *
 * Usage:
 *   npm run research:corpus-coverage -w @nyayagrid/research
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBundleCoverageMatrix,
  buildFiftyStateRoadmap,
} from "../corpus/coverage-matrix";

async function main() {
  const matrix = await buildBundleCoverageMatrix();
  const roadmap = buildFiftyStateRoadmap(matrix);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../corpus/reports");
  await mkdir(outDir, { recursive: true });
  const matrixPath = join(outDir, "coverage-matrix.json");
  const roadmapPath = join(outDir, "fifty-state-roadmap.json");
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf-8");
  await writeFile(roadmapPath, `${JSON.stringify(roadmap, null, 2)}\n`, "utf-8");

  const human = [
    `# NyayaGrid legal corpus coverage (seed bundles)`,
    ``,
    `Generated: ${matrix.generatedAt}`,
    `Phase: ${matrix.phase} / parser ${matrix.parserVersion}`,
    `Bundle authorities: ${matrix.bundleAuthorityCount}`,
    ``,
    `## Federal (US)`,
    `- class: ${matrix.federal.coverageClass}`,
    `- count: ${matrix.federal.authorityCount}`,
    `- statutes: ${matrix.federal.statutesPresent}`,
    `- SCOTUS cases: ${matrix.federal.highCourtCasesPresent}`,
    `- circuit: ${matrix.federal.intermediateAppellateCasesPresent}`,
    `- district: ${matrix.federal.trialCasesPresent}`,
    `- regulations/CFR: ${matrix.federal.regulationsPresent}`,
    `- constitution: ${matrix.federal.constitutionPresent}`,
    ``,
    `## States`,
    ...matrix.states
      .filter((s) => s.coverageClass !== "no_corpus")
      .map(
        (s) =>
          `- ${s.jurisdiction}: ${s.coverageClass} (n=${s.authorityCount}; statutes=${s.statutesPresent}; high=${s.highCourtCasesPresent}; app=${s.intermediateAppellateCasesPresent})`,
      ),
    ``,
    `No-corpus states: ${matrix.summary.statesNoCorpus}`,
    ``,
    `## Honest claims`,
    ...matrix.honestClaims.map((c) => `- ${c}`),
    ``,
    `## Roadmap waves`,
    ...roadmap.waves.map(
      (w) => `- ${w.id} [${w.status}]: ${w.name} — ${w.jurisdictions.join(", ")}`,
    ),
    ``,
  ].join("\n");
  await writeFile(join(outDir, "coverage-matrix.txt"), human, "utf-8");

  console.log(
    JSON.stringify(
      {
        matrixPath,
        roadmapPath,
        bundleAuthorityCount: matrix.bundleAuthorityCount,
        federalClass: matrix.federal.coverageClass,
        statesWithCorpus: matrix.summary.statesWithCorpus,
        statesNoCorpus: matrix.summary.statesNoCorpus,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
