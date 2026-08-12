import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type ChunkHits = {
  chunks: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};
type DepositionAnalysis = {
  skipped: boolean;
  run: { id: string };
  findings: Array<{ id: string }>;
  rejectedNoSource?: number;
};

const TRANSCRIPT_HINTS = ["deposition", "transcript", "examination", "testimony"];

/** Deposition preparation. Findings must cite transcript sources or the domain layer drops them. */
export const depositionAgent: NyayaAgent = {
  id: "deposition_agent",
  name: "Nyaya Deposition Agent",
  description:
    "Analyzes deposition transcripts for preparation findings tied to specific transcript passages.",
  supportedIntents: ["deposition_prep", "multi_step_task"],
  requiredCapabilities: ["documents.view"],
  allowedTools: ["retrieveMatterChunks", "analyzeDeposition", "getVerifiedTimeline"],
  riskClass: "low",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();

    const chunks = await invokeIfAllowed<ChunkHits>(ctx, builder, "retrieveMatterChunks", {
      query: `${TRANSCRIPT_HINTS.join(" ")} ${objective} ${goal}`.slice(0, 1000),
      limit: Math.min(12, ctx.budgets.maxRetrievedContext),
    });
    if (!chunks) {
      return builder.build({
        fallbackSummary:
          "Retrieval was not authorized for this step; no transcript was identified.",
      });
    }

    builder.addToolResult("retrieveMatterChunks", chunks);
    const hits = chunks.data?.chunks ?? [];
    for (const chunk of hits) {
      builder.scanRetrievedText(`transcript ${chunk.documentId}`, chunk.quote);
    }
    builder.addSources(
      hits.map((chunk) => ({
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        chunkId: chunk.chunkId,
      })),
    );

    const target = hits[0];
    if (!target) {
      builder.addLimitation("No transcript passage matched the request, so no analysis was run.");
      return builder.build({ fallbackSummary: "No deposition transcript was found to analyze." });
    }

    const analysis = await invokeIfAllowed<DepositionAnalysis>(ctx, builder, "analyzeDeposition", {
      documentId: target.documentId,
      documentVersionId: target.documentVersionId,
    });
    if (analysis) {
      builder.addToolResult("analyzeDeposition", analysis);
      if ((analysis.data?.rejectedNoSource ?? 0) > 0) {
        builder.addLimitation(
          `${analysis.data?.rejectedNoSource} proposed finding(s) were discarded for lacking a transcript source.`,
        );
      }
      builder.addLimitation(
        "Preparation findings are AI-generated and require attorney review before use in an examination.",
      );
    }

    return builder.build({
      fallbackSummary: "Deposition analysis completed.",
      canonicalRef: analysis?.data?.run?.id
        ? { kind: "analysis_run", analysisRunId: analysis.data.run.id }
        : null,
    });
  },
};
