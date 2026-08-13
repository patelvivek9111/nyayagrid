export type JobName =
  | "document.malware_scan"
  | "document.extract_text"
  | "document.embed"
  | "matter.extract_timeline_events"
  | "matter.extract_matter_facts"
  | "matter.extract_entities"
  | "matter.extract_deadline_candidates"
  | "matter.refresh_summary"
  | "matter.extract_intelligence"
  | "matter.materialize_verified_graph"
  | "matter.extract_relationship_candidates"
  | "matter.refresh_memory_embeddings"
  | "matter.propose_matter_memory"
  | "matter.reconcile_superseded_memory"
  | "matter.analyze_contract"
  | "matter.compare_documents"
  | "matter.analyze_deposition"
  | "matter.detect_contradictions"
  | "matter.classify_discovery_document"
  | "matter.detect_near_duplicates"
  | "matter.refresh_evidence_matrix"
  | "research.ingest_authority"
  | "research.index_authority"
  | "research.run_query"
  | "agent.execute_run"
  | "agent.continue_run"
  | "student.ingest_case"
  | "guide.ingest_document"
  | "ping";

export type JobPayload = {
  organizationId?: string;
  matterId?: string;
  documentId?: string;
  documentVersionId?: string;
  userId?: string;
  runId?: string;
  idempotencyKey: string;
  [key: string]: unknown;
};

export type JobResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};

/**
 * Domain job handlers — independent of Inngest transport.
 */
export type JobHandler = (payload: JobPayload) => Promise<JobResult>;

export interface JobDispatcher {
  readonly name: string;
  dispatch(jobName: JobName, payload: JobPayload): Promise<{ id: string }>;
}

export class InMemoryJobDispatcher implements JobDispatcher {
  readonly name = "memory";
  readonly processed: Array<{ jobName: JobName; payload: JobPayload }> = [];
  private readonly seen = new Set<string>();

  constructor(private readonly handlers: Partial<Record<JobName, JobHandler>> = {}) {}

  async dispatch(jobName: JobName, payload: JobPayload): Promise<{ id: string }> {
    if (this.seen.has(payload.idempotencyKey)) {
      return { id: payload.idempotencyKey };
    }
    this.seen.add(payload.idempotencyKey);
    this.processed.push({ jobName, payload });
    const handler = this.handlers[jobName];
    if (handler) {
      await handler(payload);
    }
    return { id: payload.idempotencyKey };
  }
}

export async function handlePing(payload: JobPayload): Promise<JobResult> {
  return {
    ok: true,
    message: "pong",
    data: { idempotencyKey: payload.idempotencyKey },
  };
}

export const domainHandlers: Partial<Record<JobName, JobHandler>> = {
  ping: handlePing,
};
