import type { ZodType } from "zod";
import type { Capability } from "@nyayagrid/validation";
import {
  AuthorizationError,
  requireCapability,
  requireMatterAccess,
  assertSameOrganization,
  type MatterAccess,
} from "@nyayagrid/permissions";
import type {
  AgentProvenanceClass,
  AgentRiskLevel,
  AgentRuntime,
  ToolInvocationResult,
} from "../types";
import { ProhibitedToolError } from "../types";

/**
 * Tools NyayaGrid will never expose to an agent. These are not "unimplemented" — they are
 * permanently refused. Registering or invoking one of these names throws, so no plan, prompt,
 * or injected document text can route work toward an irreversible external action.
 */
export const PROHIBITED_TOOL_NAMES = [
  "sendEmail",
  "fileCourt",
  "makePayment",
  "deleteEvidence",
  "approvePrivilege",
  "contactExternal",
] as const;

export type ProhibitedToolName = (typeof PROHIBITED_TOOL_NAMES)[number];

const PROHIBITED_SET = new Set<string>(PROHIBITED_TOOL_NAMES);

export function isProhibitedTool(name: string): boolean {
  return PROHIBITED_SET.has(name);
}

export function assertToolNotProhibited(name: string): void {
  if (isProhibitedTool(name)) {
    throw new ProhibitedToolError(name);
  }
}

/** Runtime handles plus the run/step identity used for tool-call audit rows. */
export type ToolContext = AgentRuntime & {
  runId?: string | null;
  stepRecordId?: string | null;
};

export type AgentTool<TInput = unknown, TData = unknown> = {
  name: string;
  description: string;
  risk: AgentRiskLevel;
  /** Capability re-checked against live membership immediately before the domain call. */
  capability: Capability;
  /** Matter access level required. Ignored when `requiresMatter` is false. */
  minAccess: MatterAccess;
  requiresMatter: boolean;
  /** Provenance class that results from this tool support, when it produces citable material. */
  provenanceClass?: AgentProvenanceClass;
  inputSchema: ZodType<TInput>;
  execute(ctx: ToolContext, input: TInput): Promise<ToolInvocationResult<TData>>;
};

export type AnyAgentTool = AgentTool<never, unknown>;

export type ToolAuthorization = {
  capability: Capability;
  minAccess: MatterAccess | null;
  matterId: string | null;
  organizationId: string;
  roleKey: string | null;
};

export type ToolInvocationRecord<TData = unknown> = ToolInvocationResult<TData> & {
  toolName: string;
  risk: AgentRiskLevel;
  durationMs: number;
  authorizationScope: ToolAuthorization;
};

export type ToolRegistry = {
  register(tool: AgentTool<never, unknown>): void;
  get(name: string): AgentTool<never, unknown> | undefined;
  require(name: string): AgentTool<never, unknown>;
  has(name: string): boolean;
  names(): string[];
  list(): AgentTool<never, unknown>[];
  /**
   * Validates input, re-checks authorization against live membership, then calls the domain
   * package. Authorization failures surface as AuthorizationError with a `denied` record.
   */
  invoke<TData = unknown>(
    ctx: ToolContext,
    name: string,
    input: unknown,
  ): Promise<ToolInvocationRecord<TData>>;
};

function classifyError(error: unknown): string {
  if (error instanceof AuthorizationError) return "authorization";
  if (error instanceof Error) {
    if (error.name === "ZodError") return "invalid_input";
    if (/not found/i.test(error.message)) return "not_found";
    return "domain_error";
  }
  return "unknown";
}

/**
 * Re-verifies the caller can do this, right now, in this matter.
 *
 * The check runs per tool call rather than once per run: a run can outlive a membership change,
 * and a plan step must never inherit authority from an earlier step's successful check.
 */
async function authorizeToolCall(
  tool: AgentTool<never, unknown>,
  ctx: ToolContext,
): Promise<ToolAuthorization> {
  if (tool.requiresMatter) {
    const matterId = ctx.matterId;
    if (!matterId) {
      throw new AuthorizationError(`Tool ${tool.name} requires a matter scope`);
    }
    const { matter, membership } = await requireMatterAccess(ctx.db, {
      userId: ctx.userId,
      matterId,
      minAccess: tool.minAccess,
      capability: tool.capability,
    });
    await assertSameOrganization(ctx.organizationId, matter.organizationId);
    return {
      capability: tool.capability,
      minAccess: tool.minAccess,
      matterId,
      organizationId: ctx.organizationId,
      roleKey: membership.roleKey,
    };
  }

  const membership = await requireCapability(ctx.db, {
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    capability: tool.capability,
  });
  return {
    capability: tool.capability,
    minAccess: null,
    matterId: null,
    organizationId: ctx.organizationId,
    roleKey: membership.roleKey,
  };
}

export function createToolRegistry(tools: AgentTool<never, unknown>[] = []): ToolRegistry {
  const byName = new Map<string, AgentTool<never, unknown>>();

  const registry: ToolRegistry = {
    register(tool) {
      assertToolNotProhibited(tool.name);
      if (byName.has(tool.name)) {
        throw new Error(`Duplicate tool registered: ${tool.name}`);
      }
      byName.set(tool.name, tool);
    },
    get: (name) => byName.get(name),
    require(name) {
      assertToolNotProhibited(name);
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool;
    },
    has: (name) => byName.has(name),
    names: () => [...byName.keys()],
    list: () => [...byName.values()],
    async invoke<TData>(
      ctx: ToolContext,
      name: string,
      input: unknown,
    ): Promise<ToolInvocationRecord<TData>> {
      assertToolNotProhibited(name);
      const tool = registry.require(name);
      const startedAt = Date.now();

      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          toolName: name,
          risk: tool.risk,
          ok: false,
          summary: `Invalid input for tool ${name}`,
          data: undefined as TData,
          resourceIds: [],
          errorClassification: "invalid_input",
          durationMs: Date.now() - startedAt,
          authorizationScope: {
            capability: tool.capability,
            minAccess: tool.requiresMatter ? tool.minAccess : null,
            matterId: ctx.matterId ?? null,
            organizationId: ctx.organizationId,
            roleKey: null,
          },
        };
      }

      const authorizationScope = await authorizeToolCall(tool, ctx);

      try {
        const result = (await tool.execute(
          ctx,
          parsed.data as never,
        )) as ToolInvocationResult<TData>;
        return {
          ...result,
          toolName: name,
          risk: tool.risk,
          durationMs: Date.now() - startedAt,
          authorizationScope,
        };
      } catch (error) {
        if (error instanceof AuthorizationError) throw error;
        return {
          toolName: name,
          risk: tool.risk,
          ok: false,
          summary: error instanceof Error ? error.message : `Tool ${name} failed`,
          data: undefined as TData,
          resourceIds: [],
          errorClassification: classifyError(error),
          durationMs: Date.now() - startedAt,
          authorizationScope,
        };
      }
    },
  };

  for (const tool of tools) registry.register(tool);
  return registry;
}

/** Convenience helper so each tool returns a consistently shaped success payload. */
export function toolOk<TData>(params: {
  summary: string;
  data: TData;
  resourceIds?: string[];
  provenanceClass?: AgentProvenanceClass;
}): ToolInvocationResult<TData> {
  return {
    ok: true,
    summary: params.summary,
    data: params.data,
    resourceIds: params.resourceIds ?? [],
    ...(params.provenanceClass ? { provenanceClass: params.provenanceClass } : {}),
  };
}

export function toolFailed<TData = null>(params: {
  summary: string;
  errorClassification: string;
  data?: TData;
}): ToolInvocationResult<TData | null> {
  return {
    ok: false,
    summary: params.summary,
    data: params.data ?? null,
    resourceIds: [],
    errorClassification: params.errorClassification,
  };
}

export function requireMatterId(ctx: ToolContext, toolName: string): string {
  if (!ctx.matterId) {
    throw new AuthorizationError(`Tool ${toolName} requires a matter scope`);
  }
  return ctx.matterId;
}
