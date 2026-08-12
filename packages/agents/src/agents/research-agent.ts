import { z } from "zod";
import type { NyayaAgent } from "../agent";
import type { AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type AuthorityHits = { hits: Array<{ authorityId: string; chunkId: string; snippet: string }> };
type ResearchRun = {
  artifactId: string | null;
  grounded: boolean;
  coverageWarnings: string[];
  provider: string;
  model: string;
  synthesis?: { answer?: string | null };
};

/**
 * Legal research over the shared authority corpus.
 *
 * Synthesis, quote validation and coverage warnings all live in @nyayagrid/research; this agent
 * only decides which research calls the step needs and reports what came back.
 */
export const researchAgent: NyayaAgent = {
  id: "research_agent",
  name: "Nyaya Research Agent",
  description:
    "Searches the legal authority corpus and records a grounded research synthesis with citations.",
  supportedIntents: ["research", "multi_step_task", "drafting"],
  requiredCapabilities: ["research.run"],
  allowedTools: [
    "searchLegalAuthorities",
    "saveResearchArtifact",
    "getVerifiedTimeline",
    "retrieveMatterMemory",
  ],
  riskClass: "low",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
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

    const synthesis = await invokeIfAllowed<ResearchRun>(ctx, builder, "saveResearchArtifact", {
      question,
      includeContrary: true,
    });
    if (synthesis) {
      builder.addToolResult("saveResearchArtifact", synthesis);
      for (const warning of synthesis.data?.coverageWarnings ?? []) {
        builder.addLimitation(warning);
      }
      if (synthesis.data && !synthesis.data.grounded) {
        builder.addLimitation(
          "No retrieved authority supported a grounded answer; the gap was recorded rather than filled.",
        );
      }
    }

    return builder.build({
      fallbackSummary: "No research tool was authorized for this step.",
      content: synthesis?.data?.synthesis?.answer ?? null,
      canonicalRef: synthesis?.data?.artifactId
        ? { kind: "research_artifact", researchArtifactId: synthesis.data.artifactId }
        : null,
      provider: synthesis?.data?.provider ?? null,
      model: synthesis?.data?.model ?? null,
    });
  },
};

export const researchAgentOutputSchema = z.object({ summary: z.string() });
