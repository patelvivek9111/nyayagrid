import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type DiscoveryQueue = {
  items: Array<{
    document: { id: string; title?: string | null };
    reviewState: { privilege?: string; relevance?: string } | null;
  }>;
};

const MAX_CLASSIFICATIONS_PER_STEP = 5;

/**
 * Discovery triage.
 *
 * Privilege is never decided here. The AI proposes relevance, responsiveness and confidentiality;
 * a privilege determination is a legal judgment that the domain layer refuses to accept without an
 * explicit human confirmation, and this agent does not attempt to supply one.
 */
export const discoveryAgent: NyayaAgent = {
  id: "discovery_agent",
  name: "Nyaya Discovery Agent",
  description:
    "Reviews the discovery queue and proposes non-privilege classifications for attorney review.",
  supportedIntents: ["discovery_review", "multi_step_task"],
  requiredCapabilities: ["documents.view"],
  allowedTools: ["getDiscoveryReview", "proposeDiscoveryClassification", "retrieveMatterChunks"],
  riskClass: "medium",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();

    const queue = await invokeIfAllowed<DiscoveryQueue>(ctx, builder, "getDiscoveryReview", {
      pendingOnly: true,
    });
    if (!queue) {
      return builder.build({
        fallbackSummary: "Discovery queue access was not authorized for this step.",
      });
    }

    builder.addToolResult("getDiscoveryReview", queue);
    const items = queue.data?.items ?? [];
    if (items.length === 0) {
      return builder.build({
        fallbackSummary: "No discovery documents are awaiting classification.",
      });
    }

    const batch = items.slice(0, MAX_CLASSIFICATIONS_PER_STEP);
    if (items.length > batch.length) {
      builder.addLimitation(
        `${items.length - batch.length} additional document(s) remain unclassified; run discovery review again to continue.`,
      );
    }

    let proposed = 0;
    for (const item of batch) {
      const result = await invokeIfAllowed(ctx, builder, "proposeDiscoveryClassification", {
        documentId: item.document.id,
        requestSummary: goal.slice(0, 2000),
      });
      if (!result) break;
      builder.addToolResult("proposeDiscoveryClassification", result);
      builder.addSources([{ documentId: item.document.id }]);
      if (result.ok) proposed += 1;
    }

    builder.addLimitation(
      "Privilege was not classified. A privilege determination requires an attorney and is never set by an agent.",
    );

    return builder.build({
      fallbackSummary: `Proposed classifications for ${proposed} document(s), all pending attorney review.`,
    });
  },
};
