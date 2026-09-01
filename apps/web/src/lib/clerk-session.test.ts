import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "clerk-session.ts"), "utf8");
const webhook = readFileSync(
  resolve(__dirname, "../app/api/webhooks/clerk/route.ts"),
  "utf8",
);

describe("Clerk secret handling", () => {
  it("does not log session tokens or secret keys", () => {
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("console.error");
    expect(source).toContain("return { userId: null }");
    expect(webhook).not.toContain("console.log");
    expect(webhook).toContain("NOT_CONFIGURED");
    expect(webhook).toContain("503");
    expect(webhook).not.toContain("secretKey");
  });
});
