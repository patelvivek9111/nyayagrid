import { describe, expect, it } from "vitest";
import { assertProsecutionGraphNodeKind } from "./case-graph-db";
import { ProsecutionError } from "./domain";

describe("prosecution case graph helpers", () => {
  it("accepts known node kinds and rejects unknown ones", () => {
    expect(assertProsecutionGraphNodeKind("evidence")).toBe("evidence");
    expect(() => assertProsecutionGraphNodeKind("guilt_score")).toThrow(ProsecutionError);
  });

  it("marks only approved status as verified in the public contract", () => {
    const isVerified = (status: string) => status === "approved";
    expect(isVerified("proposed")).toBe(false);
    expect(isVerified("approved")).toBe(true);
    expect(isVerified("rejected")).toBe(false);
  });
});
