import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type ChunkHits = {
  chunks: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};
type MatterHits = {
  hits: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};
type EvidenceIntelligence = { documents: Array<{ document: { id: string } }> };
type Contradictions = { findings: Array<{ id: string }> };
type Verified = { events: unknown[]; facts: unknown[] };

/** Gathers and cross-checks matter evidence. Contradiction candidates always require review. */
export const evidenceAgent: NyayaAgent = {
  id: "evidence_agent",
  name: "Nyaya Evidence Agent",
  description:
    "Retrieves matter evidence, loads the evidence matrix, and surfaces contradiction candidates for review.",
  supportedIntents: ["evidence_analysis", "simple_qa", "drafting", "multi_step_task"],
  requiredCapabilities: ["documents.view"],
  allowedTools: [
    "searchMatterDocuments",
    "retrieveMatterChunks",
    "getEvidenceMatrix",
    "detectContradictions",
    "getVerifiedTimeline",
    "retrieveMatterMemory",
  ],
  riskClass: "low",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
    const query = `${objective} ${goal}`.slice(0, 1000);
    const limit = Math.min(12, ctx.budgets.maxRetrievedContext);

    const search = await invokeIfAllowed<MatterHits>(ctx, builder, "searchMatterDocuments", {
      query,
      limit,
    });
    if (search) {
      builder.addToolResult("searchMatterDocuments", search);
      for (const hit of search.data?.hits ?? []) {
        builder.scanRetrievedText(`document ${hit.documentId}`, hit.quote);
      }
      builder.addSources(
        (search.data?.hits ?? []).map((hit) => ({
          documentId: hit.documentId,
          documentVersionId: hit.documentVersionId,
          chunkId: hit.chunkId,
        })),
      );
    }

    const chunks = await invokeIfAllowed<ChunkHits>(ctx, builder, "retrieveMatterChunks", {
      query,
      limit,
    });
    if (chunks) {
      builder.addToolResult("retrieveMatterChunks", chunks);
      for (const chunk of chunks.data?.chunks ?? []) {
        builder.scanRetrievedText(`document ${chunk.documentId}`, chunk.quote);
      }
    }

    const verified = await invokeIfAllowed<Verified>(ctx, builder, "getVerifiedTimeline", {});
    if (verified) builder.addToolResult("getVerifiedTimeline", verified);

    const matrix = await invokeIfAllowed<EvidenceIntelligence>(
      ctx,
      builder,
      "getEvidenceMatrix",
      {},
    );
    if (matrix) builder.addToolResult("getEvidenceMatrix", matrix);

    const contradictions = await invokeIfAllowed<Contradictions>(
      ctx,
      builder,
      "detectContradictions",
      {},
    );
    if (contradictions) {
      builder.addToolResult("detectContradictions", contradictions);
      if ((contradictions.data?.findings ?? []).length > 0) {
        builder.addLimitation(
          "Contradiction candidates are unreviewed AI findings and are not established inconsistencies until an attorney confirms them.",
        );
      }
    }

    return builder.build({
      fallbackSummary: "No evidence tool was authorized for this step.",
    });
  },
};
