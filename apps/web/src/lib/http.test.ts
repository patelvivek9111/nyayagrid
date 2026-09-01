import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "http.ts"), "utf8");

describe("handleRouteError", () => {
  it("does not leak raw Error messages or stack traces to the client", () => {
    expect(source).toContain('const PUBLIC_INTERNAL_ERROR = "An unexpected error occurred"');
    expect(source).toContain("ROUTER_UNAVAILABLE_USER_MESSAGE");
    expect(source).toContain("jsonError(\"INTERNAL_ERROR\", PUBLIC_INTERNAL_ERROR, 500)");
    expect(source).not.toContain('jsonError("INTERNAL_ERROR", error.message, 500)');
    expect(source).toContain("USER_FACING_AUTH.unauthenticated");
    expect(source).toContain("USER_FACING_AUTH.forbidden");
    expect(source).toContain("userFacingInviteMessage");
    expect(source).not.toContain("error.stack");
  });
});
