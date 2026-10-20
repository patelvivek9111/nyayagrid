import { z } from "zod";
import type { NyayaAgent } from "../agent";
import type { AgentActionProposalInput, AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./agent-run-shared";

type AuthorityHits = { hits: Array<{ authorityId: string; chunkId: string; snippet: string }> };

/**
 * Legal research over the shared authority corpus (read path).
 *
 * Phase 4: does not auto-persist research artifacts. Search/read may run; save requires
 * an explicit approval proposal (OTHER / research save intent).
 */
export const researchAgent: NyayaAgent = {
  id: "research_agent",
  name: "Nyaya Research Agent",
  description:
    "Searches the legal authority corpus and returns grounded hits; artifact save requires approval.",
  supportedIntents: ["research", "multi_step_task", "drafting"],
  requiredCapabilities: ["research.run"],
  allowedTools: [
    "searchLegalAuthorities",
    "saveResearchArtifact",
    "getVerifiedTimeline",
    "retrieveMatterMemory",
  ],
  riskClass: "medium",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
    const actionProposals: AgentActionProposalInput[] = [];
    const question = objective.length > goal.length ? goal : objective;

    const search = await invokeIfAllowed<AuthorityHits>(ctx, builder, "searchLegalAuthorities", {
      query: question,
      limit: Math.min(10, ctx.budgets.maxRetrievedContext),
    });
    if (search) {
      builder.addToolResult("searchLegalAuthorities", search);
      for (const hit of search.data?.hits ?? []) {
        builder.scanRetrievedText(`authority ${hit.authorityId}`, hit.snippet);
      }
      builder.addSources(
        (search.data?.hits ?? []).map((hit) => ({
          authorityId: hit.authorityId,
          authorityChunkId: hit.chunkId,
        })),
      );
    }

    const hitCount = search?.data?.hits?.length ?? 0;
    actionProposals.push({
      actionType: "OTHER",
      proposedData: {
        kind: "SAVE_RESEARCH_ARTIFACT",
        question,
        includeContrary: true,
        authorityIds: (search?.data?.hits ?? []).map((h) => h.authorityId),
        treatmentVerified: false,
        requiresConfirmation: true,
      },
      rationale:
        "Research read completed from local/indexed authorities. Approve to persist a research artifact (no CourtListener fetch).",
      riskLevel: "high",
    });

    builder.addLimitation(
      "Research artifact was not saved automatically. Approve the save proposal (or confirm in chat) to persist.",
    );
    builder.addLimitation(
      "Authority treatment remains NOT VERIFIED unless treatmentVerified=true on the record.",
    );
    if (hitCount === 0) {
      builder.addLimitation(
        "No retrieved authority supported a grounded answer; the gap was recorded rather than filled.",
      );
    }

    return {
      ...builder.build({
        fallbackSummary:
          hitCount > 0
            ? `Research read found ${hitCount} authority hit(s); save awaits approval.`
            : "Research read found no grounded authority hits; save awaits approval if desired.",
        content: null,
        canonicalRef: null,
      }),
      actionProposals,
    };
  },
};

export const researchAgentOutputSchema = z.object({ summary: z.string() });
