import { describe, expect, it } from "vitest";
import { publicDatabaseError } from "./health";

describe("publicDatabaseError", () => {
  it("never returns a connection string", () => {
    expect(
      publicDatabaseError(
        new Error("connect postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid"),
        "development",
      ),
    ).toBe("connect [redacted]");
  });

  it("returns a generic label outside development/test", () => {
    expect(publicDatabaseError(new Error("ECONNREFUSED 10.0.0.8:5432"), "staging")).toBe(
      "unreachable",
    );
    expect(publicDatabaseError(new Error("ECONNREFUSED"), "production")).toBe("unreachable");
  });
});
