import { describe, expect, it } from "vitest";
import { normalizeCustody, validateChainOfCustody } from "./chain-of-custody";

describe("chain of custody normalization", () => {
  it("upgrades legacy string entries into structured transfers", () => {
    const transfers = normalizeCustody(["collected", { to: "evidence locker", actor: "Clerk A" }]);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]?.to).toBe("collected");
    expect(transfers[0]?.timestamp).toBe("date unknown");
    expect(transfers[1]?.actor).toBe("Clerk A");
  });

  it("flags gaps without rewriting history", () => {
    const transfers = normalizeCustody([
      {
        actor: "Officer",
        timestamp: "2026-01-01T10:00:00.000Z",
        from: null,
        to: "Officer",
        source: { humanEntered: true, extractionOrigin: "human" },
      },
      {
        actor: "Clerk",
        timestamp: "2026-01-01T12:00:00.000Z",
        from: "Someone else",
        to: "Locker",
        source: { humanEntered: true, extractionOrigin: "human" },
      },
    ]);
    const findings = validateChainOfCustody(transfers);
    expect(findings.some((f) => f.code === "CHAIN_GAP")).toBe(true);
  });
});
