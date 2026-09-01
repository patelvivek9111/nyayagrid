import { relative, resolve, sep } from "node:path";

const FORBIDDEN_DIR_NAMES = new Set([
  "hidden_ground_truth",
  "review_packets",
  "ground_truth",
  "answer_key",
  "answer-keys",
]);

function pathSegments(filePath: string): string[] {
  return filePath
    .split(/[/\\]/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

export function isForbiddenBenchmarkPath(filePath: string): boolean {
  return pathSegments(filePath).some((part) => FORBIDDEN_DIR_NAMES.has(part));
}

/**
 * Only `scenarios/<id>/documents/` files may be uploaded or indexed.
 * Keys, review packets, and anything else under the dataset root are refused.
 */
export function assertIngestibleDocumentPath(datasetRoot: string, filePath: string): string {
  const root = resolve(datasetRoot);
  const absolute = resolve(filePath);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Benchmark ingest path is outside the dataset root: ${filePath}`);
  }
  const parts = pathSegments(rel);
  if (parts.some((part) => FORBIDDEN_DIR_NAMES.has(part))) {
    throw new Error(
      `Refusing to ingest hidden ground truth or review material: ${rel.split(sep).join("/")}`,
    );
  }
  const scenariosIndex = parts.indexOf("scenarios");
  const documentsIndex = parts.indexOf("documents");
  if (scenariosIndex !== 0 || documentsIndex < 2 || documentsIndex !== parts.length - 2) {
    throw new Error(
      `Benchmark ingest is limited to scenarios/<id>/documents/*; got ${rel.split(sep).join("/")}`,
    );
  }
  if (!/\.(pdf|txt|docx)$/i.test(parts[parts.length - 1] ?? "")) {
    throw new Error(`Benchmark ingest refuses non-document files: ${rel.split(sep).join("/")}`);
  }
  return absolute;
}
