import { z } from "zod";
import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type Neighborhood = {
  center: { id: string; displayName: string };
  neighbors: Array<{ id: string; displayName: string }>;
  edges: Array<{ id: string; relationshipType: string }>;
};
type Verified = { entities: Array<{ id: string; displayName?: string; name?: string }> };

const graphAgentInputSchema = agentInputSchema.extend({
  /** Graph expansion starts from a specific node; the caller selects which one. */
  nodeId: z.string().uuid().optional(),
  relationshipTypes: z.array(z.string().max(80)).max(20).optional(),
});

/**
 * Reads approved graph relationships around one entity.
 *
 * Only approved edges are returned, and the agent never proposes new ones: a relationship
 * assertion between parties in a matter is reviewed through the graph review workflow, not
 * created as a side effect of answering a question.
 */
export const graphAgent: NyayaAgent = {
  id: "graph_agent",
  name: "Nyaya Graph Agent",
  description:
    "Loads approved matter relationships around a selected entity node, with their supporting sources.",
  supportedIntents: ["timeline_analysis", "evidence_analysis", "multi_step_task"],
  requiredCapabilities: ["matters.view"],
  allowedTools: ["getMatterGraphNeighborhood", "getVerifiedTimeline"],
  riskClass: "low",
  inputSchema: graphAgentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const parsed = graphAgentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();

    if (!parsed.nodeId) {
      const verified = await invokeIfAllowed<Verified>(ctx, builder, "getVerifiedTimeline", {});
      if (verified) builder.addToolResult("getVerifiedTimeline", verified);
      builder.addLimitation(
        "Graph expansion needs a specific entity node to start from; none was selected, so only verified matter context was loaded.",
      );
      return builder.build({
        fallbackSummary: "No entity node was selected, so no graph neighborhood was expanded.",
      });
    }

    const neighborhood = await invokeIfAllowed<Neighborhood | null>(
      ctx,
      builder,
      "getMatterGraphNeighborhood",
      {
        nodeId: parsed.nodeId,
        ...(parsed.relationshipTypes ? { relationshipTypes: parsed.relationshipTypes } : {}),
      },
    );
    if (!neighborhood) {
      return builder.build({
        fallbackSummary: "Graph access was not authorized for this step.",
      });
    }

    builder.addToolResult("getMatterGraphNeighborhood", neighborhood);
    if (!neighborhood.data) {
      builder.addLimitation("The requested entity node does not exist in this matter.");
    } else if (neighborhood.data.edges.length === 0) {
      builder.addLimitation(
        "The entity has no approved relationships yet; proposed relationships are excluded until reviewed.",
      );
    }

    return builder.build({
      fallbackSummary: "Graph neighborhood loaded.",
      canonicalRef: neighborhood.data
        ? {
            kind: "graph_neighborhood",
            graphNodeIds: [
              neighborhood.data.center.id,
              ...neighborhood.data.neighbors.map((node) => node.id),
            ],
          }
        : null,
    });
  },
};
