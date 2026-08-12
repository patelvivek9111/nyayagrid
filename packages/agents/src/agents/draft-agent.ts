import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type ChunkHits = {
  chunks: Array<{ chunkId: string; documentId: string; documentVersionId: string; quote: string }>;
};
type GeneratedDraft = {
  draft: { id: string; title: string };
  version: { id: string; versionNumber: number; content?: string };
  assertionCounts?: Record<string, number>;
  authorityWarnings?: string[];
  assumptions?: string[];
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
 * Produces matter drafts.
 *
 * A draft is internal, versioned work product: it is never transmitted anywhere, which is why
 * generation runs as a medium-risk proposal instead of blocking on an approval. Any external use
 * still requires an attorney, and the draft body carries the disclaimers @nyayagrid/intelligence
 * attaches when authority coverage is incomplete.
 */
export const draftAgent: NyayaAgent = {
  id: "draft_agent",
  name: "Nyaya Draft Agent",
  description:
    "Generates and revises matter drafts grounded in retrieved matter sources and saved authorities.",
  supportedIntents: ["drafting", "multi_step_task"],
  requiredCapabilities: ["drafts.create"],
  allowedTools: [
    "retrieveMatterChunks",
    "getVerifiedTimeline",
    "retrieveMatterMemory",
    "createDraft",
    "reviseDraft",
  ],
  riskClass: "medium",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();

    const chunks = await invokeIfAllowed<ChunkHits>(ctx, builder, "retrieveMatterChunks", {
      query: goal,
      limit: Math.min(12, ctx.budgets.maxRetrievedContext),
    });
    const documentIds: string[] = [];
    if (chunks) {
      builder.addToolResult("retrieveMatterChunks", chunks);
      for (const chunk of chunks.data?.chunks ?? []) {
        builder.scanRetrievedText(`document ${chunk.documentId}`, chunk.quote);
        if (!documentIds.includes(chunk.documentId)) documentIds.push(chunk.documentId);
      }
      builder.addSources(
        (chunks.data?.chunks ?? []).map((chunk) => ({
          documentId: chunk.documentId,
          documentVersionId: chunk.documentVersionId,
          chunkId: chunk.chunkId,
        })),
      );
    }

    const created = await invokeIfAllowed<GeneratedDraft>(ctx, builder, "createDraft", {
      title: objective.slice(0, 200),
      draftType: draftTypeFromObjective(objective),
      instructions: goal,
      ...(documentIds.length > 0 ? { documentIds: documentIds.slice(0, 25) } : {}),
      generate: true,
    });

    if (!created) {
      return builder.build({
        fallbackSummary: "Draft creation was not authorized for this step; no draft was created.",
      });
    }

    builder.addToolResult("createDraft", created);
    for (const warning of created.data?.authorityWarnings ?? []) builder.addLimitation(warning);
    for (const assumption of created.data?.assumptions ?? []) {
      builder.addLimitation(`Draft assumption requiring verification: ${assumption}`);
    }
    builder.addLimitation(
      "The draft is internal work product and requires attorney review before any external use.",
    );

    return builder.build({
      fallbackSummary: "Draft generated.",
      content: created.data?.version?.content ?? null,
      canonicalRef: created.data?.draft?.id
        ? {
            kind: "draft",
            draftId: created.data.draft.id,
            draftVersionId: created.data.version?.id,
          }
        : null,
    });
  },
};
