import { createAgentRegistry, type AgentRegistry, type NyayaAgent } from "../agent";
import { researchAgent } from "./research-agent";
import { draftAgent } from "./draft-agent";
import { contractAgent } from "./contract-agent";
import { evidenceAgent } from "./evidence-agent";
import { discoveryAgent } from "./discovery-agent";
import { depositionAgent } from "./deposition-agent";
import { timelineAgent } from "./timeline-agent";
import { graphAgent } from "./graph-agent";
import { memoryAgent } from "./memory-agent";

export {
  researchAgent,
  draftAgent,
  contractAgent,
  evidenceAgent,
  discoveryAgent,
  depositionAgent,
  timelineAgent,
  graphAgent,
  memoryAgent,
};

export const DEFAULT_AGENTS: NyayaAgent[] = [
  researchAgent,
  draftAgent,
  contractAgent,
  evidenceAgent,
  discoveryAgent,
  depositionAgent,
  timelineAgent,
  graphAgent,
  memoryAgent,
];

export function createDefaultAgentRegistry(extraAgents: NyayaAgent[] = []): AgentRegistry {
  return createAgentRegistry([...DEFAULT_AGENTS, ...extraAgents]);
}

export * from "./shared";
