import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeDatabase, fakeConditionHelpers } from "./testing/fake-db";

const authorizedUsers = new Set<string>(["attorney-1"]);

class TestAuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

vi.mock("@nyayagrid/database", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@nyayagrid/database");
  return { ...actual, ...fakeConditionHelpers };
});

vi.mock("@nyayagrid/permissions", () => ({
  AuthorizationError: TestAuthorizationError,
  requireMatterAccess: vi.fn(async (_db: unknown, params: { userId: string; matterId: string }) => {
    if (!authorizedUsers.has(params.userId)) {
      throw new TestAuthorizationError("No matter membership — access denied by default");
    }
    return {
      matter: { id: params.matterId, organizationId: "org-1" },
      membership: { roleKey: "attorney" },
      access: "edit",
    };
  }),
  requireCapability: vi.fn(async (_db: unknown, params: { userId: string }) => {
    if (!authorizedUsers.has(params.userId)) throw new TestAuthorizationError("Missing capability");
    return { roleKey: "attorney" };
  }),
  assertSameOrganization: vi.fn(async () => undefined),
  writeAuditEvent: vi.fn(async () => ({ id: crypto.randomUUID() })),
}));

const { agentRunSteps, agentRuns } = await import("@nyayagrid/database");
const { NyayaOrchestrator, MAX_ORCHESTRATION_DEPTH } = await import("./orchestrator");
const { createAgentRegistry } = await import("./agent");
const { createToolRegistry } = await import("./tools/registry");
const { KNOWN_AGENT_TYPES } = await import("./planner");
const { createDefaultAgentRegistry } = await import("./agents/index");

let db: FakeDatabase;

function orchestrator() {
  // Real agent registry, empty tool registry: planning and persistence are what is under test.
  return new NyayaOrchestrator({
    agents: createDefaultAgentRegistry(),
    tools: createToolRegistry([]),
  });
}

function params(goal: string, extra: Record<string, unknown> = {}) {
  return {
    db: db as unknown as never,
    userId: "attorney-1",
    organizationId: "org-1",
    matterId: "matter-1",
    goal,
    execute: false,
    rulesOnlyIntent: true,
    ...extra,
  };
}

beforeEach(() => {
  db = new FakeDatabase();
  authorizedUsers.clear();
  authorizedUsers.add("attorney-1");
});

describe("NyayaOrchestrator.runTask", () => {
  it("answers a single question directly without creating a run", async () => {
    const outcome = await orchestrator().runTask(
      params("What is the notice deadline in the lease?"),
    );

    expect(outcome.mode).toBe("qa");
    expect(db.rows(agentRuns)).toHaveLength(0);
    expect(db.rows(agentRunSteps)).toHaveLength(0);
  });

  it("plans and persists a run for a task intent without executing it", async () => {
    const outcome = await orchestrator().runTask(
      params("Research the notice requirements and then draft a motion to dismiss"),
    );

    expect(outcome.mode).toBe("task");
    if (outcome.mode !== "task") return;
    expect(outcome.executed).toBe(false);
    expect(outcome.run.run.status).toBe("planned");
    expect(outcome.run.steps.length).toBeGreaterThan(1);
    expect(outcome.userFacingPlan).toMatch(/^1\. /);
    for (const step of outcome.run.steps) {
      expect(KNOWN_AGENT_TYPES).toContain(step.agentType);
      expect(step.status).toBe("pending");
    }
  });

  it("creates a run when the caller forces task mode on a simple question", async () => {
    const outcome = await orchestrator().runTask(
      params("What is the notice deadline?", { mode: "task" }),
    );
    expect(outcome.mode).toBe("task");
    expect(db.rows(agentRuns)).toHaveLength(1);
  });

  it("plans reviewable drafting for an email-and-settle request and blocks both actions", async () => {
    const outcome = await orchestrator().runTask(
      params("Email opposing counsel and accept the settlement offer"),
    );

    expect(outcome.mode).toBe("task");
    if (outcome.mode !== "task") return;
    expect(outcome.intent.intent).toBe("drafting");
    expect(outcome.intent.blockedActions).toContain("send_email");
    expect(outcome.intent.blockedActions).toContain("accept_settlement");
    expect(outcome.run.run.limitations?.join(" ")).toMatch(/will not perform/i);
    expect(outcome.run.steps.flatMap((step) => step.requiredTools ?? []).join(" ")).not.toMatch(
      /sendEmail|contactExternal/,
    );
  });

  it("refuses a caller without matter access before planning anything", async () => {
    await expect(
      orchestrator().runTask(params("Draft a motion", { userId: "outsider" })),
    ).rejects.toBeInstanceOf(TestAuthorizationError);
    expect(db.rows(agentRuns)).toHaveLength(0);
  });

  it("rejects an empty goal", async () => {
    await expect(orchestrator().runTask(params("   "))).rejects.toThrow(/goal is required/i);
  });
});

describe("orchestration boundaries", () => {
  it("keeps step creation with the orchestrator so agents cannot spawn agents", () => {
    expect(MAX_ORCHESTRATION_DEPTH).toBe(1);
  });

  it("plans only agent types the registry actually provides", async () => {
    const restricted = new NyayaOrchestrator({
      agents: createAgentRegistry([]),
      tools: createToolRegistry([]),
    });
    await expect(restricted.runTask(params("Draft a motion to dismiss"))).rejects.toThrow(
      /Unknown agent type/,
    );
  });

  it("exposes its registered agent types and tool names", () => {
    const instance = orchestrator();
    expect(instance.agentTypes()).toEqual([...KNOWN_AGENT_TYPES]);
    expect(instance.toolNames()).toEqual([]);
  });
});
