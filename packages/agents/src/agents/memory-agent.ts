import type { NyayaAgent } from "../agent";
import type { AgentActionProposalInput, AgentExecutionResult } from "../types";
import { AgentOutputBuilder, agentInputSchema, agentOutputSchema, invokeIfAllowed } from "./shared";

type MemoryProposals = { proposals: Array<{ id: string; title: string; content: string }> };
type TaskProposal = {
  proposal: {
    actionType: "CREATE_TASK";
    proposedData: Record<string, unknown>;
    rationale?: string;
    riskLevel: "high";
  };
  created: boolean;
};

/**
 * Captures durable matter context and proposes follow-up work.
 *
 * Memory entries are written with status `proposed`, so they do not influence any answer until an
 * attorney approves them. Task proposals are returned as approval requests and never inserted
 * here — creating work on a matter is a decision, not a side effect of a run.
 */
export const memoryAgent: NyayaAgent = {
  id: "memory_agent",
  name: "Nyaya Memory Agent",
  description:
    "Proposes matter memory entries and follow-up tasks for attorney approval. Writes nothing that takes effect without review.",
  supportedIntents: ["multi_step_task", "contract_review", "timeline_analysis"],
  requiredCapabilities: ["matters.edit"],
  allowedTools: [
    "retrieveMatterMemory",
    "proposeMemory",
    "createTaskProposal",
    "getVerifiedTimeline",
  ],
  riskClass: "high",
  inputSchema: agentInputSchema,
  outputSchema: agentOutputSchema,

  async execute(ctx, input): Promise<AgentExecutionResult> {
    const { goal, objective } = agentInputSchema.parse(input);
    const builder = new AgentOutputBuilder();
    const actionProposals: AgentActionProposalInput[] = [];

    const existing = await invokeIfAllowed<{ memories: Array<{ id: string }> }>(
      ctx,
      builder,
      "retrieveMatterMemory",
      { question: goal.slice(0, 1000) },
    );
    if (existing) builder.addToolResult("retrieveMatterMemory", existing);

    const proposedMemories = await invokeIfAllowed<MemoryProposals>(ctx, builder, "proposeMemory", {
      question: goal.slice(0, 1000),
      hint: objective.slice(0, 1000),
    });
    if (proposedMemories) {
      builder.addToolResult("proposeMemory", proposedMemories);
      for (const memory of proposedMemories.data?.proposals ?? []) {
        actionProposals.push({
          actionType: "SAVE_MEMORY",
          riskLevel: "medium",
          rationale: `Approving activates the proposed memory "${memory.title}" for use in future answers.`,
          proposedData: { memoryId: memory.id, title: memory.title, content: memory.content },
          provenance: [{ class: "MATTER_MEMORY", refs: [memory.id] }],
        });
      }
      builder.addLimitation(
        "Proposed memory entries stay inactive until approved and do not affect answers in the meantime.",
      );
    }

    const task = await invokeIfAllowed<TaskProposal>(ctx, builder, "createTaskProposal", {
      title: objective.slice(0, 200),
      description: `Follow-up identified while working on: ${goal.slice(0, 1000)}`,
      rationale: "Follow-up work identified during the agent run.",
    });
    if (task?.data?.proposal) {
      builder.addToolResult("createTaskProposal", task);
      actionProposals.push({
        actionType: "CREATE_TASK",
        riskLevel: "high",
        rationale: task.data.proposal.rationale ?? "Proposed follow-up work.",
        proposedData: task.data.proposal.proposedData,
      });
      builder.addLimitation(
        "No task was created. The proposed task is written only if you approve it.",
      );
    }

    const result = builder.build({
      fallbackSummary: `Prepared ${actionProposals.length} proposal(s) for your review.`,
    });
    return { ...result, actionProposals };
  },
};
