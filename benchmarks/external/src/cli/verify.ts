import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPrbenchParquet } from "../adapters/prbench.js";
import { inventoryLegalBenchTasks } from "../adapters/legalbench.js";
import { loadLegalBenchRagBenchmarkFile } from "../adapters/legalbench-rag.js";
import { loadIntegrityManifest, verifyIntegrityManifest } from "../integrity/manifest.js";
import { getCacheDir, getFixturesDir, getRegistryDir } from "../paths.js";

async function verifyFixtures(): Promise<void> {
  const fixtures = getFixturesDir();
  const manifestPath = path.join(fixtures, "integrity-manifest.json");
  const manifest = loadIntegrityManifest(manifestPath);
  const result = verifyIntegrityManifest(manifest, fixtures);
  if (!result.ok) {
    throw new Error(`Fixture integrity failed: ${JSON.stringify(result)}`);
  }
  const licenses = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "licenses.json"), "utf8"),
  ) as unknown[];
  if (!Array.isArray(licenses) || licenses.length < 3) {
    throw new Error("License registry incomplete");
  }
  console.log("FIXTURES_VERIFY_OK");
}

async function verifyCache(): Promise<void> {
  const cache = getCacheDir();
  const manifestPath = path.join(cache, "integrity-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      "Cache integrity-manifest.json missing — run bench:external:fetch first (or --fixtures)",
    );
  }
  const manifest = loadIntegrityManifest(manifestPath);
  const result = verifyIntegrityManifest(manifest, cache);
  if (!result.ok) {
    throw new Error(`Cache integrity failed: ${JSON.stringify(result)}`);
  }

  const prLegal = path.join(
    cache,
    "prbench/01947c6ef913df518e6e52626a7b29f132b12d4f/data/legal-00000-of-00001.parquet",
  );
  const prHard = path.join(
    cache,
    "prbench/01947c6ef913df518e6e52626a7b29f132b12d4f/data/legal_hard-00000-of-00001.parquet",
  );
  if (existsSync(prLegal) && existsSync(prHard)) {
    const legal = await loadPrbenchParquet(prLegal);
    const hard = await loadPrbenchParquet(prHard);
    console.log(
      `PRBench counts: legal=${legal.length} (published 500) legal_hard=${hard.length} (published 250) revision=01947c6ef913df518e6e52626a7b29f132b12d4f`,
    );
    if (legal.length !== 500 || hard.length !== 250) {
      console.warn(
        "PRBench_COUNT_MISMATCH: upstream differs from published expectation; not forcing counts.",
      );
    }
  }

  const lbTasks = path.join(cache, "lb/tasks");
  if (existsSync(lbTasks)) {
    const inv = inventoryLegalBenchTasks(lbTasks);
    console.log(`LegalBench tasks: ${inv.length}`);
  }

  const ragPrivacy = path.join(
    cache,
    "legalbench-rag/2b9c248bc8179ef0908fd6ba01d50b156facd48b/benchmarks/privacy_qa.json",
  );
  if (existsSync(ragPrivacy)) {
    const tasks = loadLegalBenchRagBenchmarkFile(ragPrivacy, "privacy_qa");
    console.log(`LegalBench-RAG privacy_qa questions: ${tasks.length}`);
  }

  const licenses = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "licenses.json"), "utf8"),
  ) as unknown[];
  if (!Array.isArray(licenses)) throw new Error("licenses.json invalid");
  console.log(`License registry entries: ${licenses.length}`);
  console.log("CACHE_VERIFY_OK");
}

async function main(): Promise<void> {
  const fixturesOnly = process.argv.includes("--fixtures");
  if (fixturesOnly) {
    await verifyFixtures();
    return;
  }
  if (process.argv.includes("--all")) {
    await verifyFixtures();
  }
  await verifyCache();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
