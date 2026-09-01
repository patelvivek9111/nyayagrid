export type BenchVerdict = "pass" | "needs_work" | "fail";

export type BenchExpectation = {
  taskId: string;
  expectationType: string;
  canonical: string | string[];
  supportingDocs: string[];
  notes: string;
  severity: "critical" | "major" | "minor";
};

export type PersistedCitation = {
  chunkId?: string;
  documentId: string;
  documentVersionId: string;
  originalFilename?: string | null;
  title?: string | null;
  page?: number | null;
  quote: string;
};

export type PersistedAnswer = {
  dataset: "v1" | "v2";
  scenarioId: string;
  taskId: string;
  category: string;
  prompt: string;
  answer: string;
  evidenceState: string;
  citations: PersistedCitation[];
  assumptions: string[];
  unresolvedQuestions: string[];
  retrievedChunkIds: string[];
  provider: string;
  model: string;
  promptVersion: string | null;
  artifactId: string | null;
  conversationId: string | null;
  latencyMs: number;
  extras?: Record<string, unknown>;
  persistedAt: string;
};

export type GradeResult = {
  taskId: string;
  verdict: BenchVerdict;
  expectationType: string;
  severity: "critical" | "major" | "minor";
  detail: string;
  needlesRequired: string[];
  needlesFound: string[];
  graderVersion?: string;
  graderKind?:
    | "case_qa"
    | "compare"
    | "contradiction"
    | "timeline"
    | "memory"
    | "analysis"
    | "evidence_matrix"
    | "draft"
    | "graph"
    | "research"
    | "agent"
    | "full_system";
  failureTaxonomy?: string;
  criticalFailure?: boolean;
  checks?: Record<string, boolean>;
  metrics?: Record<string, number>;
};
