import { z } from "zod";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentProvenanceEntry,
  AgentSourceRef,
  ToolInvocationResult,
} from "../types";
import { ToolNotAllowedError } from "../types";
import { scanForInjection } from "../prompt-injection";

/** Every agent receives the run goal plus its own step objective. */
export const agentInputSchema = z.object({
  goal: z.string().min(1),
  objective: z.string().min(1),
});

export const agentOutputSchema = z.object({
  summary: z.string().min(1),
  content: z.string().nullable().optional(),
  provenance: z.array(
    z.object({
      class: z.enum([
        "MATTER_EVIDENCE",
        "VERIFIED_MATTER_INTELLIGENCE",
        "GRAPH_RELATIONSHIP",
        "MATTER_MEMORY",
        "LEGAL_AUTHORITY",
        "USER_INSTRUCTION",
      ]),
      refs: z.array(z.string()),
      note: z.string().optional(),
    }),
  ),
  sources: z.array(z.record(z.unknown())),
  limitations: z.array(z.string()).optional(),
});

export type AgentInput = z.infer<typeof agentInputSchema>;

/**
 * Accumulates tool results into one agent output.
 *
 * Agents call tools and report; they do not reinterpret domain data. Collecting provenance here
 * keeps every claim in a summary traceable to the tool call and resource ids that produced it.
 */
export class AgentOutputBuilder {
  private readonly summaries: string[] = [];
  private readonly provenance: AgentProvenanceEntry[] = [];
  private readonly sources: AgentSourceRef[] = [];
  private readonly limitations: string[] = [];

  addToolResult(toolName: string, result: ToolInvocationResult<unknown>): this {
    this.summaries.push(`${toolName}: ${result.summary}`);
    if (result.provenanceClass && result.resourceIds.length > 0) {
      this.provenance.push({
        class: result.provenanceClass,
        refs: result.resourceIds.slice(0, 100),
        note: toolName,
      });
    }
    if (!result.ok) {
      this.limitations.push(
        `${toolName} did not complete (${result.errorClassification ?? "unknown"}): ${result.summary}`,
      );
    }
    return this;
  }

  addSources(sources: AgentSourceRef[]): this {
    this.sources.push(...sources);
    return this;
  }

  addLimitation(note: string): this {
    if (note && !this.limitations.includes(note)) this.limitations.push(note);
    return this;
  }

  /** Records that retrieved text tried to issue instructions, without acting on them. */
  scanRetrievedText(label: string, text: string | null | undefined): this {
    if (!text) return this;
    const scan = scanForInjection(label, text);
    for (const note of scan.notes) this.addLimitation(note);
    return this;
  }

  build(params: {
    fallbackSummary: string;
    content?: string | null;
    canonicalRef?: Record<string, unknown> | null;
    provider?: string | null;
    model?: string | null;
    promptVersion?: string | null;
  }): AgentExecutionResult {
    return {
      summary: this.summaries.length > 0 ? this.summaries.join(" ") : params.fallbackSummary,
      content: params.content ?? null,
      provenance: this.provenance,
      sources: this.sources,
      limitations: this.limitations,
      canonicalRef: params.canonicalRef ?? null,
      provider: params.provider ?? null,
      model: params.model ?? null,
      promptVersion: params.promptVersion ?? null,
    };
  }
}

/**
 * Invokes a tool if the step authorized it, otherwise records the gap.
 *
 * A step may legitimately authorize fewer tools than an agent supports, so a missing tool is a
 * scope limitation to report rather than an error to fail on.
 */
export async function invokeIfAllowed<TData = unknown>(
  ctx: AgentExecutionContext,
  builder: AgentOutputBuilder,
  toolName: string,
  input: unknown,
): Promise<ToolInvocationResult<TData> | null> {
  if (!ctx.tools.allowedTools().includes(toolName)) {
    builder.addLimitation(`${toolName} was not authorized for this step and was not called.`);
    return null;
  }
  try {
    return await ctx.tools.invoke<TData>(toolName, input);
  } catch (error) {
    if (error instanceof ToolNotAllowedError) {
      builder.addLimitation(`${toolName} was not authorized for this step and was not called.`);
      return null;
    }
    throw error;
  }
}

export function parseAgentInput(input: unknown): AgentInput {
  return agentInputSchema.parse(input);
}
