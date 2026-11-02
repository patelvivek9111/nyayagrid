import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inventoryLegalBenchTasks } from "../adapters/legalbench.js";
import { encodeCacheFsPath } from "../fetch/cache-path.js";
import { downloadToFile, recordAsset, writeJson } from "../fetch/download.js";
import type { IntegrityManifestEntry } from "../integrity/manifest.js";
import { getCacheDir, getRegistryDir } from "../paths.js";

const PRBENCH_REV = "01947c6ef913df518e6e52626a7b29f132b12d4f";
const LEGALBENCH_REV = "b46bf4ffae90524b2b72aaa30e7745fe9db64481";
const LEGALBENCH_RAG_DATA_REV = "2b9c248bc8179ef0908fd6ba01d50b156facd48b";
const LEGALBENCH_RAG_CODE_REV = "431bc8f2488a81569ab7259fa633dcc50ab77f9a";

type FetchOptions = {
  fullCorpus: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): FetchOptions {
  return {
    fullCorpus: argv.includes("--full-corpus"),
    force: argv.includes("--force"),
  };
}

async function fetchPrbench(cacheRoot: string, force: boolean): Promise<IntegrityManifestEntry[]> {
  const base = path.join(cacheRoot, "prbench", PRBENCH_REV, "data");
  mkdirSync(base, { recursive: true });
  const files = ["legal-00000-of-00001.parquet", "legal_hard-00000-of-00001.parquet"] as const;
  const assets: IntegrityManifestEntry[] = [];
  for (const file of files) {
    const url = `https://huggingface.co/datasets/ScaleAI/PRBench/resolve/${PRBENCH_REV}/data/${file}`;
    const dest = path.join(base, file);
    const result = await downloadToFile(url, dest, { force });
    console.log(`PRBench ${file}: ${result.bytes} bytes${result.skipped ? " (cached)" : ""}`);
    assets.push(
      await recordAsset({
        relativePath: path.relative(cacheRoot, dest),
        absolutePath: dest,
        source: "https://huggingface.co/datasets/ScaleAI/PRBench",
        revision: PRBENCH_REV,
      }),
    );
  }
  await writeJson(path.join(cacheRoot, "prbench", PRBENCH_REV, "SOURCE.json"), {
    benchmark_id: "prbench",
    revision: PRBENCH_REV,
    downloadedAt: new Date().toISOString(),
    expectedPublished: { legal: 500, legal_hard: 250 },
  });
  return assets;
}

function extractLegalBenchTasksWithPython(zipPath: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const script = `
import zipfile, os, sys
from pathlib import Path
zip_path = Path(r'''${zipPath.replace(/'/g, "\\'")}''')
out = Path(r'''${outDir.replace(/'/g, "\\'")}''')
prefix = 'legalbench-${LEGALBENCH_REV}/'
kept = 0
with zipfile.ZipFile(zip_path) as z:
    for info in z.infolist():
        name = info.filename
        if not name.startswith(prefix):
            continue
        rel = name[len(prefix):]
        if not rel.startswith('tasks/'):
            continue
        if info.is_dir():
            continue
        base = os.path.basename(rel)
        if base.endswith('.md') or base.endswith('.markdown'):
            continue
        parts = Path(rel).parts
        if '..' in parts:
            raise SystemExit('traversal')
        target = out / rel
        target_s = '\\\\\\\\?\\\\' + str(target)
        os.makedirs('\\\\\\\\?\\\\' + str(target.parent), exist_ok=True)
        with z.open(info) as src, open(target_s, 'wb') as dst:
            dst.write(src.read())
        kept += 1
print(kept)
`;
  const result = spawnSync("python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`LegalBench extract failed: ${result.stderr || result.stdout}`);
  }
  console.log(`LegalBench extracted files: ${(result.stdout || "").trim()}`);
}

async function fetchLegalBench(
  cacheRoot: string,
  force: boolean,
): Promise<IntegrityManifestEntry[]> {
  const base = path.join(cacheRoot, "legalbench", LEGALBENCH_REV);
  mkdirSync(base, { recursive: true });
  const zipPath = path.join(base, "legalbench.zip");
  const url = `https://github.com/HazyResearch/legalbench/archive/${LEGALBENCH_REV}.zip`;
  const dl = await downloadToFile(url, zipPath, { force });
  console.log(`LegalBench zip: ${dl.bytes} bytes${dl.skipped ? " (cached)" : ""}`);
  const assets: IntegrityManifestEntry[] = [
    await recordAsset({
      relativePath: path.relative(cacheRoot, zipPath),
      absolutePath: zipPath,
      source: "https://github.com/HazyResearch/legalbench",
      revision: LEGALBENCH_REV,
    }),
  ];

  // Prefer short cache path on Windows to avoid MAX_PATH failures.
  const extractRoot = path.join(cacheRoot, "lb");
  const tasksMarker = path.join(extractRoot, "tasks");
  if (force || !existsSync(tasksMarker)) {
    extractLegalBenchTasksWithPython(zipPath, extractRoot);
  }
  const inventory = inventoryLegalBenchTasks(tasksMarker);
  const inventoryPath = path.join(base, "task-inventory.json");
  await writeJson(inventoryPath, {
    revision: LEGALBENCH_REV,
    taskCount: inventory.length,
    extractedTo: extractRoot,
    tasks: inventory,
  });
  console.log(`LegalBench task dirs: ${inventory.length}`);
  assets.push(
    await recordAsset({
      relativePath: path.relative(cacheRoot, inventoryPath),
      absolutePath: inventoryPath,
      source: "https://github.com/HazyResearch/legalbench",
      revision: LEGALBENCH_REV,
    }),
  );
  await writeJson(path.join(base, "SOURCE.json"), {
    benchmark_id: "legalbench",
    revision: LEGALBENCH_REV,
    downloadedAt: new Date().toISOString(),
    extractPath: extractRoot,
  });
  return assets;
}

async function fetchLegalBenchRag(
  cacheRoot: string,
  options: FetchOptions,
): Promise<IntegrityManifestEntry[]> {
  const base = path.join(cacheRoot, "legalbench-rag", LEGALBENCH_RAG_DATA_REV);
  mkdirSync(path.join(base, "benchmarks"), { recursive: true });
  const assets: IntegrityManifestEntry[] = [];
  const shaUrl = `https://huggingface.co/datasets/awinml/legalbench-rag/resolve/${LEGALBENCH_RAG_DATA_REV}/SHA256SUMS`;
  const shaPath = path.join(base, "SHA256SUMS");
  await downloadToFile(shaUrl, shaPath, { force: options.force });
  assets.push(
    await recordAsset({
      relativePath: path.relative(cacheRoot, shaPath),
      absolutePath: shaPath,
      source: "https://huggingface.co/datasets/awinml/legalbench-rag",
      revision: LEGALBENCH_RAG_DATA_REV,
    }),
  );

  const checksums = new Map<string, string>();
  for (const line of readFileSync(shaPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s+\*?(.*)$/i);
    if (m?.[1] && m[2]) checksums.set(m[2].trim().replace(/^\.\//, ""), m[1]);
  }

  for (const file of ["contractnli.json", "cuad.json", "maud.json", "privacy_qa.json"]) {
    const rel = `benchmarks/${file}`;
    const dest = path.join(base, rel);
    const url = `https://huggingface.co/datasets/awinml/legalbench-rag/resolve/${LEGALBENCH_RAG_DATA_REV}/${rel}`;
    const dl = await downloadToFile(url, dest, { force: options.force });
    const asset = await recordAsset({
      relativePath: path.relative(cacheRoot, dest),
      absolutePath: dest,
      source: "https://huggingface.co/datasets/awinml/legalbench-rag",
      revision: LEGALBENCH_RAG_DATA_REV,
    });
    const expected = checksums.get(rel);
    if (expected && expected !== asset.sha256) {
      throw new Error(`Checksum mismatch for ${rel}: expected ${expected} got ${asset.sha256}`);
    }
    console.log(
      `LegalBench-RAG ${file}: ${dl.bytes} bytes checksum=${expected ? "OK" : "not-in-sums"}`,
    );
    assets.push(asset);
  }

  // Default: privacy_qa corpus only (small). Full corpus is opt-in.
  const corpusFiles = [
    "23andMe.txt",
    "Fiverr.txt",
    "Groupon.txt",
    "Keep.txt",
    "Viber Messenger.txt",
    "Wordscapes.txt",
  ];
  for (const file of corpusFiles) {
    const rel = `corpus/privacy_qa/${file}`;
    const fsRel = encodeCacheFsPath(rel);
    const dest = path.join(base, ...fsRel.split("/"));
    const enc = encodeURIComponent(file);
    const url = `https://huggingface.co/datasets/awinml/legalbench-rag/resolve/${LEGALBENCH_RAG_DATA_REV}/corpus/privacy_qa/${enc}`;
    try {
      await downloadToFile(url, dest, { force: options.force });
      const asset = await recordAsset({
        relativePath: path.posix.join(path.relative(cacheRoot, base).replace(/\\/g, "/"), rel),
        absolutePath: dest,
        source: "https://huggingface.co/datasets/awinml/legalbench-rag",
        revision: LEGALBENCH_RAG_DATA_REV,
      });
      const expected = checksums.get(rel);
      if (expected && expected !== asset.sha256) {
        throw new Error(`Checksum mismatch for ${rel}`);
      }
      assets.push(asset);
    } catch (err) {
      console.warn(`Skipping corpus file ${file}: ${String(err)}`);
    }
  }

  if (options.fullCorpus) {
    console.log(
      "NOTE: --full-corpus requested; downloading remaining corpus entries from SHA256SUMS (large).",
    );
    for (const [rel, expected] of checksums) {
      if (!rel.startsWith("corpus/")) {
        continue;
      }
      // Windows-illegal chars in upstream names (`|`, `:`, …) are encoded on disk.
      const fsRel = encodeCacheFsPath(rel);
      const dest = path.join(base, ...fsRel.split("/"));
      if (!options.force && existsSync(dest)) {
        continue;
      }
      const url = `https://huggingface.co/datasets/awinml/legalbench-rag/resolve/${LEGALBENCH_RAG_DATA_REV}/${rel
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      await downloadToFile(url, dest, { force: options.force });
      const asset = await recordAsset({
        // Logical upstream path (decoded) for human-readable manifests.
        relativePath: path.posix.join(path.relative(cacheRoot, base).replace(/\\/g, "/"), rel),
        absolutePath: dest,
        source: "https://huggingface.co/datasets/awinml/legalbench-rag",
        revision: LEGALBENCH_RAG_DATA_REV,
      });
      if (asset.sha256 !== expected) {
        throw new Error(`Checksum mismatch for ${rel}`);
      }
      assets.push(asset);
    }
  }

  await writeJson(path.join(base, "SOURCE.json"), {
    benchmark_id: "legalbench-rag",
    data_revision: LEGALBENCH_RAG_DATA_REV,
    code_repo: "zeroentropy-ai/legalbenchrag",
    code_revision: LEGALBENCH_RAG_CODE_REV,
    data_mirror: "awinml/legalbench-rag",
    downloadedAt: new Date().toISOString(),
    fullCorpus: options.fullCorpus,
  });
  return assets;
}

const LEGALCITEBENCH_REV = "f9e3dc676f29aeef8028e8851660ccf2aeefe19f";
const LEGALCITEBENCH_FILES = [
  "cat1_citation_retrieval.jsonl",
  "cat2_citation_completion.jsonl",
  "cat3_citation_error_detection.jsonl",
  "cat4_1_case_matching.jsonl",
  "cat4_2_case_verification.jsonl",
] as const;

async function fetchLegalCiteBench(
  cacheRoot: string,
  force: boolean,
): Promise<IntegrityManifestEntry[]> {
  const base = path.join(cacheRoot, "legalcitebench", LEGALCITEBENCH_REV);
  const dataDir = path.join(base, "data");
  mkdirSync(dataDir, { recursive: true });
  const assets: IntegrityManifestEntry[] = [];
  for (const file of LEGALCITEBENCH_FILES) {
    const url = `https://huggingface.co/datasets/legalcitebench/LegalCiteBench/resolve/${LEGALCITEBENCH_REV}/data/${file}`;
    const dest = path.join(dataDir, file);
    const result = await downloadToFile(url, dest, { force });
    console.log(
      `LegalCiteBench ${file}: ${result.bytes} bytes${result.skipped ? " (cached)" : ""}`,
    );
    assets.push(
      await recordAsset({
        relativePath: path.relative(cacheRoot, dest),
        absolutePath: dest,
        source: "https://huggingface.co/datasets/legalcitebench/LegalCiteBench",
        revision: LEGALCITEBENCH_REV,
      }),
    );
  }
  await writeJson(path.join(base, "SOURCE.json"), {
    benchmark_id: "legalcitebench",
    revision: LEGALCITEBENCH_REV,
    dataset_url: "https://huggingface.co/datasets/legalcitebench/LegalCiteBench",
    upstream_repo: "Sijia711/LegalCiteBench",
    github_license_file: "MIT",
    huggingface_card_license: "cc0-1.0",
    downloadedAt: new Date().toISOString(),
    files: LEGALCITEBENCH_FILES.map((f) => `data/${f}`),
  });
  return assets;
}

function upsertSourceRevision(
  sources: Array<Record<string, unknown>>,
  benchmarkId: string,
  patch: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const idx = sources.findIndex((s) => s.benchmark_id === benchmarkId);
  if (idx < 0) return [...sources, { benchmark_id: benchmarkId, ...patch }];
  return sources.map((s, i) => (i === idx ? { ...s, ...patch } : s));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cacheRoot = getCacheDir();
  mkdirSync(cacheRoot, { recursive: true });
  console.log(`external-bench fetch → ${cacheRoot}`);

  const assets: IntegrityManifestEntry[] = [];
  assets.push(...(await fetchPrbench(cacheRoot, options.force)));
  assets.push(...(await fetchLegalBench(cacheRoot, options.force)));
  assets.push(...(await fetchLegalBenchRag(cacheRoot, options)));
  assets.push(...(await fetchLegalCiteBench(cacheRoot, options.force)));

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: assets,
  };
  const manifestPath = path.join(cacheRoot, "integrity-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Patch revisions into the existing sources registry — do not drop external_mount entries.
  const sourcesPath = path.join(getRegistryDir(), "sources.json");
  const existing = existsSync(sourcesPath)
    ? (JSON.parse(readFileSync(sourcesPath, "utf8")) as {
        schema_version?: number;
        sources: Array<Record<string, unknown>>;
      })
    : { schema_version: 1, sources: [] };
  let sources = existing.sources ?? [];
  sources = upsertSourceRevision(sources, "prbench", {
    revision: PRBENCH_REV,
    pin_policy: "git_sha",
  });
  sources = upsertSourceRevision(sources, "legalbench", {
    revision: LEGALBENCH_REV,
    pin_policy: "git_sha",
  });
  sources = upsertSourceRevision(sources, "legalbench-rag", {
    revision: LEGALBENCH_RAG_DATA_REV,
    code_revision: LEGALBENCH_RAG_CODE_REV,
    pin_policy: "hf_sha",
  });
  sources = upsertSourceRevision(sources, "legalcitebench", {
    revision: LEGALCITEBENCH_REV,
    dataset_url: "https://huggingface.co/datasets/legalcitebench/LegalCiteBench",
    upstream_repo: "Sijia711/LegalCiteBench",
    default_format: "jsonl",
    pin_policy: "hf_sha",
    expected_published_counts: { instances: 23646 },
    notes:
      "GitHub LICENSE is MIT; HF dataset card declares cc0-1.0. Cache under benchmarks/external/cache; do not vendor into git.",
  });
  writeFileSync(
    sourcesPath,
    `${JSON.stringify({ schema_version: existing.schema_version ?? 1, sources }, null, 2)}\n`,
    "utf8",
  );

  console.log(`Wrote integrity manifest with ${assets.length} assets`);
  console.log("FETCH_OK");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
