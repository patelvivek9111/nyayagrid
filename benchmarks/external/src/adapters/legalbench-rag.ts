import { readFileSync } from "node:fs";
import { NormalizedTaskSchema, type NormalizedTask } from "../schema/normalized-task.js";
import type { BenchmarkAdapter } from "./types.js";

export type LegalBenchRagSnippet = {
  file_path: string;
  span: [number, number];
};

export type LegalBenchRagCase = {
  query: string;
  snippets: LegalBenchRagSnippet[];
  tags?: unknown;
};

export type LegalBenchRagBenchmarkFile = {
  test_cases?: LegalBenchRagCase[];
  tests?: LegalBenchRagCase[];
  queries?: LegalBenchRagCase[];
} & Record<string, unknown>;

function extractCases(parsed: unknown): LegalBenchRagCase[] {
  if (Array.isArray(parsed)) {
    return parsed as LegalBenchRagCase[];
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LegalBench-RAG file is not an object or array");
  }
  const obj = parsed as LegalBenchRagBenchmarkFile;
  const candidates = [obj.test_cases, obj.tests, obj.queries];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as LegalBenchRagCase[];
  }
  // Some releases nest under a single source key
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (
        first &&
        typeof first === "object" &&
        "query" in (first as object) &&
        "snippets" in (first as object)
      ) {
        return value as LegalBenchRagCase[];
      }
    }
  }
  throw new Error("LegalBench-RAG: could not locate test cases array");
}

export function normalizeLegalBenchRagCase(
  sourceName: string,
  testCase: LegalBenchRagCase,
  index: number,
): NormalizedTask {
  if (typeof testCase.query !== "string" || testCase.query.length === 0) {
    throw new Error(`LegalBench-RAG case ${index} missing query`);
  }
  if (!Array.isArray(testCase.snippets) || testCase.snippets.length === 0) {
    throw new Error(`LegalBench-RAG case ${index} missing snippets`);
  }
  const goldEvidence = testCase.snippets.map((s, si) => {
    if (!s || typeof s.file_path !== "string") {
      throw new Error(`LegalBench-RAG case ${index} snippet ${si} bad file_path`);
    }
    if (
      !Array.isArray(s.span) ||
      s.span.length !== 2 ||
      typeof s.span[0] !== "number" ||
      typeof s.span[1] !== "number"
    ) {
      throw new Error(`LegalBench-RAG case ${index} snippet ${si} bad span`);
    }
    return {
      documentId: s.file_path,
      start: s.span[0],
      end: s.span[1],
      text: null,
      label: null,
    };
  });
  return NormalizedTaskSchema.parse({
    benchmarkId: "legalbench-rag",
    taskId: `${sourceName}::${index}`,
    split: sourceName,
    jurisdiction: null,
    practiceArea: sourceName,
    difficulty: null,
    taskType: "span_retrieval",
    input: { query: testCase.query, tags: testCase.tags ?? null },
    conversation: [{ role: "user", content: testCase.query }],
    supportingDocuments: null,
    expectedAnswer: null,
    rubric: null,
    goldEvidence,
    metadata: {
      upstreamSource: sourceName,
      snippetCount: testCase.snippets.length,
      spanConvention: "half_open_[start,end)",
    },
    contaminationRisk: "PUBLIC_HIGH",
  });
}

export function loadLegalBenchRagBenchmarkFile(
  filePath: string,
  sourceName?: string,
): NormalizedTask[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const cases = extractCases(parsed);
  const name =
    sourceName ??
    filePath
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.json$/i, "") ??
    "unknown";
  return cases.map((c, i) => normalizeLegalBenchRagCase(name, c, i));
}

export const LegalBenchRagAdapter: BenchmarkAdapter = {
  benchmarkId: "legalbench-rag",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    return loadLegalBenchRagBenchmarkFile(sourcePath);
  },
};
