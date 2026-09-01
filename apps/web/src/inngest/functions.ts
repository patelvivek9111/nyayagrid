import { inngest } from "./client";
import { domainHandlers, type JobPayload } from "@nyayagrid/jobs";
import { DOCUMENT_INGEST_RUNTIME } from "@nyayagrid/documents";
import {
  handleDocumentIngestEvent,
  handleDocumentIntelligenceEvent,
  markIngestFailedAfterRetries,
} from "@/server/document-ingest";

export const pingJob = inngest.createFunction(
  { id: "nyayagrid-ping", retries: 1 },
  { event: "nyayagrid/ping" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers.ping;
    if (!handler) {
      return { ok: false, message: "ping handler missing" };
    }
    return handler(payload);
  },
);

export const documentMalwareScanJob = inngest.createFunction(
  {
    id: "nyayagrid-document-malware-scan",
    retries: DOCUMENT_INGEST_RUNTIME.ingestRetries,
    concurrency: [
      { limit: DOCUMENT_INGEST_RUNTIME.ingestConcurrencyGlobal },
      {
        key: "event.data.organizationId",
        limit: DOCUMENT_INGEST_RUNTIME.ingestConcurrencyPerOrganization,
      },
    ],
    onFailure: async ({ event, error }) => {
      const payload = (event.data.event?.data ?? event.data) as JobPayload;
      await markIngestFailedAfterRetries(
        payload,
        error instanceof Error ? error.message : "Document ingest failed after retries",
      );
    },
  },
  { event: "nyayagrid/document.malware_scan" },
  async ({ event, attempt }) => {
    const payload = event.data as JobPayload;
    return handleDocumentIngestEvent({ payload, attempt });
  },
);

export const matterIntelligenceExtractJob = inngest.createFunction(
  {
    id: "nyayagrid-matter-extract-intelligence",
    retries: DOCUMENT_INGEST_RUNTIME.intelligenceRetries,
    concurrency: [
      { limit: DOCUMENT_INGEST_RUNTIME.intelligenceConcurrencyGlobal },
      {
        key: "event.data.organizationId",
        limit: DOCUMENT_INGEST_RUNTIME.intelligenceConcurrencyPerOrganization,
      },
    ],
  },
  { event: "nyayagrid/matter.extract_intelligence" },
  async ({ event, attempt }) => {
    const payload = event.data as JobPayload;
    return handleDocumentIntelligenceEvent({ payload, attempt });
  },
);

export const matterGraphMaterializeJob = inngest.createFunction(
  { id: "nyayagrid-matter-materialize-graph", retries: 2 },
  { event: "nyayagrid/matter.materialize_verified_graph" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.materialize_verified_graph"];
    if (!handler) {
      return {
        ok: true,
        message: "Graph materialization event received; domain API invokes materialize directly.",
        data: { matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const matterAnalyzeContractJob = inngest.createFunction(
  { id: "nyayagrid-matter-analyze-contract", retries: 2 },
  { event: "nyayagrid/matter.analyze_contract" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.analyze_contract"];
    if (!handler) {
      return {
        ok: true,
        message: "Contract analysis event received; domain API invokes analyzeContract directly.",
        data: { matterId: payload.matterId, documentVersionId: payload.documentVersionId },
      };
    }
    return handler(payload);
  },
);

export const matterCompareDocumentsJob = inngest.createFunction(
  { id: "nyayagrid-matter-compare-documents", retries: 2 },
  { event: "nyayagrid/matter.compare_documents" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.compare_documents"];
    if (!handler) {
      return {
        ok: true,
        message:
          "Document comparison event received; domain API invokes compareDocuments directly.",
        data: { matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const matterAnalyzeDepositionJob = inngest.createFunction(
  { id: "nyayagrid-matter-analyze-deposition", retries: 2 },
  { event: "nyayagrid/matter.analyze_deposition" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.analyze_deposition"];
    if (!handler) {
      return {
        ok: true,
        message:
          "Deposition analysis event received; domain API invokes analyzeDeposition directly.",
        data: { matterId: payload.matterId, documentVersionId: payload.documentVersionId },
      };
    }
    return handler(payload);
  },
);

export const matterDetectContradictionsJob = inngest.createFunction(
  { id: "nyayagrid-matter-detect-contradictions", retries: 2 },
  { event: "nyayagrid/matter.detect_contradictions" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.detect_contradictions"];
    if (!handler) {
      return {
        ok: true,
        message: "Contradiction detection event received.",
        data: { matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const matterClassifyDiscoveryJob = inngest.createFunction(
  { id: "nyayagrid-matter-classify-discovery", retries: 2 },
  { event: "nyayagrid/matter.classify_discovery_document" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.classify_discovery_document"];
    if (!handler) {
      return {
        ok: true,
        message: "Discovery classification event received.",
        data: { matterId: payload.matterId, documentId: payload.documentId },
      };
    }
    return handler(payload);
  },
);

export const matterDetectNearDuplicatesJob = inngest.createFunction(
  { id: "nyayagrid-matter-detect-near-duplicates", retries: 2 },
  { event: "nyayagrid/matter.detect_near_duplicates" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["matter.detect_near_duplicates"];
    if (!handler) {
      return {
        ok: true,
        message: "Near-duplicate detection event received.",
        data: { matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const researchIngestAuthorityJob = inngest.createFunction(
  { id: "nyayagrid-research-ingest-authority", retries: 2 },
  { event: "nyayagrid/research.ingest_authority" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["research.ingest_authority"];
    if (!handler) {
      return {
        ok: true,
        message: "Authority ingestion event received; domain API invokes importAuthority directly.",
        data: { sourceExternalId: payload.sourceExternalId },
      };
    }
    return handler(payload);
  },
);

export const researchIndexAuthorityJob = inngest.createFunction(
  { id: "nyayagrid-research-index-authority", retries: 2 },
  { event: "nyayagrid/research.index_authority" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["research.index_authority"];
    if (!handler) {
      return {
        ok: true,
        message: "Authority indexing event received; chunk embeddings are written during import.",
        data: { authorityId: payload.authorityId },
      };
    }
    return handler(payload);
  },
);

export const researchRunQueryJob = inngest.createFunction(
  { id: "nyayagrid-research-run-query", retries: 1 },
  { event: "nyayagrid/research.run_query" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["research.run_query"];
    if (!handler) {
      return {
        ok: true,
        message: "Research query event received; domain API invokes runResearchQuery directly.",
        data: { sessionId: payload.sessionId },
      };
    }
    return handler(payload);
  },
);

export const agentExecuteRunJob = inngest.createFunction(
  { id: "nyayagrid-agent-execute-run", retries: 2 },
  { event: "nyayagrid/agent.execute_run" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["agent.execute_run"];
    if (!handler) {
      return {
        ok: true,
        message: "Agent run execution event received; domain API invokes executeAgentRun directly.",
        data: { runId: payload.runId, matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const agentContinueRunJob = inngest.createFunction(
  { id: "nyayagrid-agent-continue-run", retries: 2 },
  { event: "nyayagrid/agent.continue_run" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["agent.continue_run"];
    if (!handler) {
      return {
        ok: true,
        message:
          "Agent run continuation event received; domain API invokes executeAgentRun directly to resume after approval.",
        data: { runId: payload.runId, matterId: payload.matterId },
      };
    }
    return handler(payload);
  },
);

export const studentIngestCaseJob = inngest.createFunction(
  { id: "nyayagrid-student-ingest-case", retries: 2 },
  { event: "nyayagrid/student.ingest_case" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["student.ingest_case"];
    if (!handler) {
      return {
        ok: true,
        message:
          "Student case ingestion event received; domain API invokes ingestStudentCase directly.",
        data: { userId: payload.userId, caseId: payload.caseId },
      };
    }
    return handler(payload);
  },
);

export const guideIngestDocumentJob = inngest.createFunction(
  { id: "nyayagrid-guide-ingest-document", retries: 2 },
  { event: "nyayagrid/guide.ingest_document" },
  async ({ event }) => {
    const payload = event.data as JobPayload;
    const handler = domainHandlers["guide.ingest_document"];
    if (!handler) {
      return {
        ok: true,
        message:
          "Guide document ingestion event received; domain API invokes ingestGuideDocument directly.",
        data: { userId: payload.userId, documentId: payload.documentId },
      };
    }
    return handler(payload);
  },
);

export const functions = [
  pingJob,
  documentMalwareScanJob,
  matterIntelligenceExtractJob,
  matterGraphMaterializeJob,
  matterAnalyzeContractJob,
  matterCompareDocumentsJob,
  matterAnalyzeDepositionJob,
  matterDetectContradictionsJob,
  matterClassifyDiscoveryJob,
  matterDetectNearDuplicatesJob,
  researchIngestAuthorityJob,
  researchIndexAuthorityJob,
  researchRunQueryJob,
  agentExecuteRunJob,
  agentContinueRunJob,
  studentIngestCaseJob,
  guideIngestDocumentJob,
];
