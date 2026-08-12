import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const authorizedUsers = new Set<string>();

class TestAuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

vi.mock("@nyayagrid/permissions", () => ({
  AuthorizationError: TestAuthorizationError,
  requireMatterAccess: vi.fn(async (_db: unknown, params: { userId: string; matterId: string }) => {
    if (!authorizedUsers.has(params.userId)) {
      throw new TestAuthorizationError("No matter membership — access denied by default");
    }
    return {
      matter: { id: params.matterId, organizationId: "org-1" },
      membership: { roleKey: "attorney", capabilities: new Set<string>() },
      access: "edit",
    };
  }),
  requireCapability: vi.fn(async (_db: unknown, params: { userId: string }) => {
    if (!authorizedUsers.has(params.userId)) {
      throw new TestAuthorizationError("Missing capability");
    }
    return { roleKey: "attorney", membershipId: "m-1", capabilities: new Set<string>() };
  }),
  assertSameOrganization: vi.fn(async (a: string, b: string) => {
    if (a !== b) throw new TestAuthorizationError("Cross-organization access denied");
  }),
  writeAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

const { createToolRegistry, toolOk, PROHIBITED_TOOL_NAMES } = await import("./tools/registry");
const { createDefaultToolRegistry } = await import("./tools/index");
const { ProhibitedToolError } = await import("./types");

type ToolLike = Parameters<ReturnType<typeof createToolRegistry>["register"]>[0];

const execute = vi.fn(async () =>
  toolOk({ summary: "ok", data: { value: 1 }, resourceIds: ["res-1"] }),
);

function testTool(overrides: Partial<Record<string, unknown>> = {}): ToolLike {
  return {
    name: "testTool",
    description: "Test tool",
    risk: "low",
    capability: "matters.view",
    minAccess: "read",
    requiresMatter: true,
    inputSchema: z.object({ query: z.string().min(1) }),
    execute,
    ...overrides,
  } as unknown as ToolLike;
}

const ctx = {
  db: {} as never,
  userId: "user-authorized",
  organizationId: "org-1",
  matterId: "matter-1",
};

beforeEach(() => {
  execute.mockClear();
  authorizedUsers.clear();
  authorizedUsers.add("user-authorized");
});

describe("tool registry authorization", () => {
  it("re-checks matter access and records the authorization scope on success", async () => {
    const registry = createToolRegistry([testTool()]);
    const record = await registry.invoke(ctx, "testTool", { query: "hello" });

    expect(record.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(record.authorizationScope).toMatchObject({
      capability: "matters.view",
      minAccess: "read",
      matterId: "matter-1",
      organizationId: "org-1",
    });
    expect(typeof record.durationMs).toBe("number");
  });

  it("denies an unauthorized user and never reaches the domain call", async () => {
    const registry = createToolRegistry([testTool()]);
    await expect(
      registry.invoke({ ...ctx, userId: "user-outsider" }, "testTool", { query: "hello" }),
    ).rejects.toBeInstanceOf(TestAuthorizationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies an organization-scoped tool when the capability is missing", async () => {
    const registry = createToolRegistry([
      testTool({ name: "orgTool", requiresMatter: false, capability: "research.run" }),
    ]);
    await expect(
      registry.invoke({ ...ctx, userId: "user-outsider" }, "orgTool", { query: "hi" }),
    ).rejects.toBeInstanceOf(TestAuthorizationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a matter scope for matter-scoped tools", async () => {
    const registry = createToolRegistry([testTool()]);
    await expect(
      registry.invoke({ ...ctx, matterId: null }, "testTool", { query: "hello" }),
    ).rejects.toBeInstanceOf(TestAuthorizationError);
  });

  it("rejects invalid input before authorizing or calling the domain", async () => {
    const registry = createToolRegistry([testTool()]);
    const record = await registry.invoke(ctx, "testTool", { query: "" });

    expect(record.ok).toBe(false);
    expect(record.errorClassification).toBe("invalid_input");
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies a domain failure instead of throwing", async () => {
    const failing = testTool({
      name: "failingTool",
      execute: vi.fn(async () => {
        throw new Error("Draft not found in matter scope");
      }),
    });
    const registry = createToolRegistry([failing]);
    const record = await registry.invoke(ctx, "failingTool", { query: "hello" });

    expect(record.ok).toBe(false);
    expect(record.errorClassification).toBe("not_found");
  });
});

describe("prohibited tools", () => {
  it("refuses to register a prohibited tool name", () => {
    for (const name of PROHIBITED_TOOL_NAMES) {
      expect(() => createToolRegistry([testTool({ name })])).toThrow(ProhibitedToolError);
    }
  });

  it("refuses to invoke a prohibited tool name", async () => {
    const registry = createToolRegistry([testTool()]);
    for (const name of PROHIBITED_TOOL_NAMES) {
      await expect(registry.invoke(ctx, name, {})).rejects.toBeInstanceOf(ProhibitedToolError);
    }
  });

  it("keeps prohibited names out of the default registry", () => {
    const names = createDefaultToolRegistry().names();
    for (const prohibited of PROHIBITED_TOOL_NAMES) {
      expect(names).not.toContain(prohibited);
    }
    expect(names).toContain("searchMatterDocuments");
    expect(names).toContain("createTaskProposal");
  });

  it("gives every default tool a declared capability and risk level", () => {
    for (const tool of createDefaultToolRegistry().list()) {
      expect(tool.capability).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(tool.risk);
    }
  });
});

describe("createTaskProposal", () => {
  it("returns a proposal and creates nothing", async () => {
    const registry = createDefaultToolRegistry();
    const record = await registry.invoke(ctx, "createTaskProposal", {
      title: "Serve the subpoena",
    });

    expect(record.ok).toBe(true);
    const data = record.data as { created: boolean; proposal: { riskLevel: string } };
    expect(data.created).toBe(false);
    expect(data.proposal.riskLevel).toBe("high");
    expect(record.resourceIds).toEqual([]);
  });
});
