import type { NyayaAgent } from "../agent";
import type { AgentActionProposalInput, AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./agent-run-shared";

type ChunkHits = {
  chunks: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};

function draftTypeFromObjective(objective: string): string {
  const lower = objective.toLowerCase();
  if (lower.includes("motion")) return "motion";
  if (lower.includes("letter")) return "letter";
  if (lower.includes("brief")) return "brief";
  if (lower.includes("memo")) return "memo";
  if (lower.includes("agreement") || lower.includes("contract")) return "agreement";
  return "general";
}

/**
 * Produces draft *previews* and CREATE_DRAFT approval proposals.
 *
 * Phase 4: does not auto-persist drafts. Persistence requires human approval via
 * agent_approvals (or conversational confirmation that reuses the same table).
 */
export const draftAgent: NyayaAgent = {
  id: "draft_agent",
  name: "Nyaya Draft Agent",
  description:
    "Prepares matter draft previews grounded in retrieved sources; persistence requires approval.",
  supportedIntents: ["drafting", "multi_step_task"],
  requiredCapabilities: ["drafts.create"],
  allowedTools: [
    "retrieveMatterChunks",
    "getVerifiedTimeline",
    "retrieveMatterMemory",
    "createDraft",
    "reviseDraft",
  ],
  riskClass: "high",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
    const actionProposals: AgentActionProposalInput[] = [];

    const chunks = await invokeIfAllowed<ChunkHits>(ctx, builder, "retrieveMatterChunks", {
      query: goal,
      limit: Math.min(12, ctx.budgets.maxRetrievedContext),
    });
    const documentIds: string[] = [];
    const previewParts: string[] = [];
    if (chunks) {
      builder.addToolResult("retrieveMatterChunks", chunks);
      for (const chunk of chunks.data?.chunks ?? []) {
        builder.scanRetrievedText(`document ${chunk.documentId}`, chunk.quote);
        if (!documentIds.includes(chunk.documentId)) documentIds.push(chunk.documentId);
        previewParts.push(chunk.quote.slice(0, 500));
      }
      builder.addSources(
        (chunks.data?.chunks ?? []).map((chunk) => ({
          documentId: chunk.documentId,
          documentVersionId: chunk.documentVersionId,
          chunkId: chunk.chunkId,
        })),
      );
    }

    const draftType = draftTypeFromObjective(objective);
    const title = objective.slice(0, 200);
    const previewText =
      previewParts.length > 0
        ? `DRAFT PREVIEW (${draftType})\n\n${previewParts.join("\n\n").slice(0, 8000)}`
        : `DRAFT PREVIEW (${draftType})\n\nNo retrieved passages were available to ground a draft body.`;

    actionProposals.push({
      actionType: "CREATE_DRAFT",
      proposedData: {
        title,
        draftType,
        instructions: goal,
        content: previewText,
        documentIds: documentIds.slice(0, 25),
        generate: false,
        requiresConfirmation: true,
      },
      rationale:
        "Draft preview prepared from matter sources. Approve to persist as a Drafts work product.",
      riskLevel: "high",
    });

    builder.addLimitation(
      "Draft was not saved automatically. Approve the CREATE_DRAFT proposal (or confirm in chat) to persist.",
    );

    return {
      ...builder.build({
        fallbackSummary: "Draft preview prepared; awaiting approval to save.",
        content: previewText,
        canonicalRef: null,
      }),
      actionProposals,
    };
  },
};
