import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type Verified = {
  events: Array<{ id: string; eventDate?: string | null; description?: string }>;
  facts: unknown[];
  deadlines: Array<{ id: string; dueAt?: Date | string | null }>;
};
type MatterHits = {
  hits: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};

/**
 * Reads the matter chronology.
 *
 * Only approved timeline events are loaded. Unreviewed proposals are excluded because an
 * unapproved event is a suggestion, and presenting it inside a chronology would imply the
 * attorney had accepted it.
 */
export const timelineAgent: NyayaAgent = {
  id: "timeline_agent",
  name: "Nyaya Timeline Agent",
  description:
    "Loads the approved matter chronology, facts and deadlines, and relates them to matter documents.",
  supportedIntents: ["timeline_analysis", "deposition_prep", "multi_step_task"],
  requiredCapabilities: ["matters.view"],
  allowedTools: ["getVerifiedTimeline", "searchMatterDocuments", "retrieveMatterMemory"],
  riskClass: "low",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();

    const verified = await invokeIfAllowed<Verified>(ctx, builder, "getVerifiedTimeline", {});
    if (!verified) {
      return builder.build({
        fallbackSummary: "Verified timeline access was not authorized for this step.",
      });
    }

    builder.addToolResult("getVerifiedTimeline", verified);
    const events = verified.data?.events ?? [];
    if (events.length === 0) {
      builder.addLimitation(
        "No approved timeline events exist for this matter, so the chronology is empty. Approve proposed events to populate it.",
      );
    }

    const search = await invokeIfAllowed<MatterHits>(ctx, builder, "searchMatterDocuments", {
      query: `${objective} ${goal}`.slice(0, 1000),
      limit: Math.min(8, ctx.budgets.maxRetrievedContext),
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

    if ((verified.data?.deadlines ?? []).length > 0) {
      builder.addLimitation(
        "Deadline dates are drawn from approved records and still require independent verification against the governing rules.",
      );
    }

    return builder.build({
      fallbackSummary: `Loaded ${events.length} approved timeline event(s).`,
      canonicalRef:
        events.length > 0 ? { kind: "timeline", timelineEventIds: events.map((e) => e.id) } : null,
    });
  },
};
