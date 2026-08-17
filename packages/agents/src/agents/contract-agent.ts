import { CLOSEST_MATCH_LIMITATION, wantsContractCompare } from "@nyayagrid/ai";
import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type ChunkHits = {
  chunks: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};
type ContractAnalysis = {
  skipped: boolean;
  analysis: { id: string; documentId: string };
};
type DocumentComparison = {
  comparison: { id: string };
  changes: unknown[];
};

/** Clause-level contract review and version compare. Findings are proposals. */
export const contractAgent: NyayaAgent = {
  id: "contract_agent",
  name: "Nyaya Contract Agent",
  description:
    "Analyzes contract clauses or compares document versions and reports items needing attorney attention.",
  supportedIntents: ["contract_review", "multi_step_task"],
  requiredCapabilities: ["documents.view"],
  allowedTools: ["retrieveMatterChunks", "analyzeContract", "compareDocuments"],
  riskClass: "low",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
    const compareRequested = wantsContractCompare(`${objective} ${goal}`);

    const chunks = await invokeIfAllowed<ChunkHits>(ctx, builder, "retrieveMatterChunks", {
      query: `${objective} ${goal}`.slice(0, 1000),
      limit: Math.min(10, ctx.budgets.maxRetrievedContext),
    });
    if (!chunks) {
      return builder.build({
        fallbackSummary: "Retrieval was not authorized for this step; no contract was identified.",
      });
    }

    builder.addToolResult("retrieveMatterChunks", chunks);
    const hits = chunks.data?.chunks ?? [];
    for (const chunk of hits) {
      builder.scanRetrievedText(`document ${chunk.documentId}`, chunk.quote);
    }
    builder.addSources(
      hits.map((chunk) => ({
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        chunkId: chunk.chunkId,
      })),
    );

    const uniqueVersions: Array<{ documentId: string; documentVersionId: string }> = [];
    const seenVersions = new Set<string>();
    for (const hit of hits) {
      if (seenVersions.has(hit.documentVersionId)) continue;
      seenVersions.add(hit.documentVersionId);
      uniqueVersions.push({
        documentId: hit.documentId,
        documentVersionId: hit.documentVersionId,
      });
    }

    if (compareRequested) {
      if (uniqueVersions.length < 2) {
        builder.addLimitation(
          "Compare was requested but retrieval did not surface two distinct document versions. Specify both version IDs, or upload the second version.",
        );
      } else {
        const [versionA, versionB] = uniqueVersions;
        const comparison = await invokeIfAllowed<DocumentComparison>(
          ctx,
          builder,
          "compareDocuments",
          {
            documentAId: versionA!.documentId,
            versionAId: versionA!.documentVersionId,
            documentBId: versionB!.documentId,
            versionBId: versionB!.documentVersionId,
            includeAiSummary: true,
          },
        );
        if (comparison) {
          builder.addToolResult("compareDocuments", comparison);
          builder.addLimitation(
            "Comparison changes are deterministic diffs; any AI summary of materiality still requires attorney confirmation.",
          );
          return builder.build({
            fallbackSummary: "Contract comparison completed.",
            canonicalRef: comparison.data?.comparison?.id
              ? { kind: "document_comparison", documentComparisonId: comparison.data.comparison.id }
              : null,
          });
        }
      }
    }

    const target = hits[0];
    if (!target) {
      builder.addLimitation(
        "No matter document matched the contract review request, so no analysis was run.",
      );
      return builder.build({ fallbackSummary: "No contract document was found to analyze." });
    }

    if (hits.some((chunk) => chunk.documentId !== target.documentId)) {
      builder.addLimitation(CLOSEST_MATCH_LIMITATION);
    }

    const analysis = await invokeIfAllowed<ContractAnalysis>(ctx, builder, "analyzeContract", {
      documentId: target.documentId,
      documentVersionId: target.documentVersionId,
    });
    if (analysis) {
      builder.addToolResult("analyzeContract", analysis);
      builder.addLimitation(
        "Clause findings are AI proposals and require attorney confirmation before they are relied on.",
      );
    }

    return builder.build({
      fallbackSummary: "Contract review completed.",
      canonicalRef: analysis?.data?.analysis?.id
        ? { kind: "document_analysis", documentAnalysisId: analysis.data.analysis.id }
        : null,
    });
  },
};
