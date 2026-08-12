import type { ZodType } from "zod";
import type { AgentExecutionContext, AgentExecutionResult, AgentRiskLevel } from "./types";
import { UnknownAgentTypeError } from "./types";

/**
 * A specialized NyayaGrid agent.
 *
 * Agents are deliberately thin: they own an objective and a tool allow-list, and they reach the
 * database only through `ctx.tools`. Retrieval, research, drafting, timeline, graph, memory,
 * contract, deposition, and discovery logic all stay in their existing packages — an agent
 * composes those capabilities, it never reimplements them.
 */
export interface NyayaAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedIntents: string[];
  readonly requiredCapabilities: string[];
  readonly allowedTools: string[];
  readonly riskClass: AgentRiskLevel;
  inputSchema: ZodType;
  outputSchema: ZodType;
  execute(ctx: AgentExecutionContext, input: unknown): Promise<AgentExecutionResult>;
}

export type AgentRegistry = {
  get(agentType: string): NyayaAgent | undefined;
  require(agentType: string): NyayaAgent;
  has(agentType: string): boolean;
  list(): NyayaAgent[];
  agentTypes(): string[];
};

export function createAgentRegistry(agents: NyayaAgent[]): AgentRegistry {
  const byId = new Map<string, NyayaAgent>();
  for (const agent of agents) {
    if (byId.has(agent.id)) {
      throw new Error(`Duplicate agent id registered: ${agent.id}`);
    }
    byId.set(agent.id, agent);
  }

  return {
    get: (agentType) => byId.get(agentType),
    require: (agentType) => {
      const agent = byId.get(agentType);
      if (!agent) throw new UnknownAgentTypeError(agentType);
      return agent;
    },
    has: (agentType) => byId.has(agentType),
    list: () => [...byId.values()],
    agentTypes: () => [...byId.keys()],
  };
}
