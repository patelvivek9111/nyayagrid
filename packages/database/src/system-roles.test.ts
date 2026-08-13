import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

describe("system roles", () => {
  it("includes owner lawyer and staff", () => {
    expect(SYSTEM_ROLE_DEFINITIONS.map((r) => r.key)).toEqual(["owner", "lawyer", "staff"]);
  });
});
