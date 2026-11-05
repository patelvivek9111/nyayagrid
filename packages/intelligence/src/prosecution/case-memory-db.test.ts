import { describe, expect, it } from "vitest";
import { ProsecutionError } from "./domain";
import {
  assertProsecutionMemoryTransition,
  isDownstreamEligibleProsecutionMemory,
  isProsecutionMemoryVerifiedFact,
  resolveProsecutionMemoryCreateStatus,
} from "./case-memory-db";

describe("prosecution case memory status transitions", () => {
  it("forces AI origin to proposed — never verified on create", () => {
    expect(resolveProsecutionMemoryCreateStatus({ origin: "ai" })).toBe("proposed");
    expect(resolveProsecutionMemoryCreateStatus({ origin: "ai", status: "approved" })).toBe(
      "proposed",
    );
    expect(isProsecutionMemoryVerifiedFact("proposed")).toBe(false);
  });

  it("allows explicit manual approve on create, defaults to proposed", () => {
    expect(resolveProsecutionMemoryCreateStatus({ origin: "manual" })).toBe("proposed");
    expect(resolveProsecutionMemoryCreateStatus({ origin: "manual", status: "approved" })).toBe(
      "approved",
    );
  });

  it("treats only approved as verified fact", () => {
    expect(isProsecutionMemoryVerifiedFact("approved")).toBe(true);
    expect(isProsecutionMemoryVerifiedFact("proposed")).toBe(false);
    expect(isProsecutionMemoryVerifiedFact("rejected")).toBe(false);
    expect(isProsecutionMemoryVerifiedFact("superseded")).toBe(false);
    expect(isDownstreamEligibleProsecutionMemory({ status: "proposed" })).toBe(false);
    expect(isDownstreamEligibleProsecutionMemory({ status: "approved", supersededBy: null })).toBe(
      true,
    );
    expect(isDownstreamEligibleProsecutionMemory({ status: "approved", supersededBy: "x" })).toBe(
      false,
    );
  });

  it("approves proposed → approved", () => {
    expect(
      assertProsecutionMemoryTransition({ currentStatus: "proposed", action: "approve" }),
    ).toBe("approved");
  });

  it("rejects proposed or approved → rejected", () => {
    expect(assertProsecutionMemoryTransition({ currentStatus: "proposed", action: "reject" })).toBe(
      "rejected",
    );
    expect(assertProsecutionMemoryTransition({ currentStatus: "approved", action: "reject" })).toBe(
      "rejected",
    );
  });

  it("edit of proposed/approved becomes approved (human correction)", () => {
    expect(assertProsecutionMemoryTransition({ currentStatus: "proposed", action: "edit" })).toBe(
      "approved",
    );
    expect(assertProsecutionMemoryTransition({ currentStatus: "approved", action: "edit" })).toBe(
      "approved",
    );
  });

  it("supersede marks prior as superseded", () => {
    expect(
      assertProsecutionMemoryTransition({ currentStatus: "proposed", action: "supersede" }),
    ).toBe("superseded");
    expect(
      assertProsecutionMemoryTransition({ currentStatus: "approved", action: "supersede" }),
    ).toBe("superseded");
    expect(
      assertProsecutionMemoryTransition({ currentStatus: "rejected", action: "supersede" }),
    ).toBe("superseded");
  });

  it("blocks invalid transitions", () => {
    expect(() =>
      assertProsecutionMemoryTransition({ currentStatus: "approved", action: "approve" }),
    ).toThrow(ProsecutionError);
    expect(() =>
      assertProsecutionMemoryTransition({ currentStatus: "superseded", action: "approve" }),
    ).toThrow(ProsecutionError);
    expect(() =>
      assertProsecutionMemoryTransition({ currentStatus: "rejected", action: "edit" }),
    ).toThrow(ProsecutionError);
  });

  it("exports no guilt or charging autonomy fields on public helpers", () => {
    const helpers = {
      resolveProsecutionMemoryCreateStatus,
      isProsecutionMemoryVerifiedFact,
      assertProsecutionMemoryTransition,
      isDownstreamEligibleProsecutionMemory,
    };
    expect(JSON.stringify(helpers)).not.toMatch(/guilt|charging|probability/i);
  });
});
