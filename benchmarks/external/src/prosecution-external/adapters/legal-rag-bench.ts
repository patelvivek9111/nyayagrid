import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NormalizedTaskSchema, type NormalizedTask } from "../../schema/normalized-task.js";
import type { BenchmarkAdapter } from "../../adapters/types.js";
import { LEGAL_RAG_JURISDICTION, LEGAL_RAG_RESULT_LABEL } from "../constants.js";

function parseJsonl(content: string): Record<string, unknown>[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

export function normalizeLegalRagBenchQa(
  row: Record<string, unknown>,
  index: number,
): NormalizedTask {
  const id =
    (typeof row.id === "string" && row.id) ||
    (typeof row.question_id === "string" && row.question_id) ||
    `q-${index}`;
  const question = typeof row.question === "string" ? row.question : "";
  const answer = typeof row.answer === "string" ? row.answer : null;
  const relevant =
    (typeof row.relevant_passage_id === "string" && row.relevant_passage_id) ||
    (typeof row.relevant_passage === "string" && row.relevant_passage) ||
    null;
  return NormalizedTaskSchema.parse({
    benchmarkId: "legal-rag-bench",
    taskId: `legal-rag-bench::qa::${id}`,
    split: "test",
    jurisdiction: LEGAL_RAG_JURISDICTION,
    practiceArea: "criminal_procedure_rag",
    taskType: "CRIMINAL_RAG_QA",
    input: row,
    conversation: [{ role: "user", content: question }],
    expectedAnswer: answer,
    goldEvidence: relevant
      ? [{ documentId: relevant, text: null, start: null, end: null, label: "relevant_passage" }]
      : null,
    metadata: {
      upstreamSource: "isaacus/legal-rag-bench",
      license: "CC-BY-NC-SA-4.0",
      licenseClassification: "RESEARCH_ONLY",
      resultLabel: LEGAL_RAG_RESULT_LABEL,
      usSubstantiveScore: false,
      originalLabel: answer,
      originalSourceIdentifier: id,
      relevantPassageId: relevant,
      stratum: "qa",
      evaluationIsolation: "EVAL_ONLY_NOT_PRODUCTION_CORPUS",
    },
    contaminationRisk: "PUBLIC_MEDIUM",
  });
}

export const LegalRagBenchAdapter: BenchmarkAdapter = {
  benchmarkId: "legal-rag-bench",
  async load(sourcePath: string): Promise<NormalizedTask[]> {
    if (!existsSync(sourcePath)) {
      throw new Error(`Legal RAG Bench mount missing: ${sourcePath}`);
    }
    const qaPath = existsSync(path.join(sourcePath, "qa.jsonl"))
      ? path.join(sourcePath, "qa.jsonl")
      : path.join(sourcePath, "qa", "test.jsonl");
    if (!existsSync(qaPath)) {
      throw new Error(`Legal RAG Bench qa.jsonl not found under ${sourcePath}`);
    }
    return parseJsonl(readFileSync(qaPath, "utf8")).map((row, i) =>
      normalizeLegalRagBenchQa(row, i),
    );
  },
};

export function loadLegalRagCorpusIds(sourcePath: string): string[] {
  const corpusPath = path.join(sourcePath, "corpus.jsonl");
  if (!existsSync(corpusPath)) return [];
  return parseJsonl(readFileSync(corpusPath, "utf8")).map((row, i) =>
    typeof row.id === "string" ? row.id : `passage-${i}`,
  );
}
