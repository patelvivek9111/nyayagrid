import { describe, expect, it } from "vitest";
import { MemoryAlertTransport, buildAlertEvent, deliverAlert } from "./alert-delivery";

describe("WP-05 alert delivery", () => {
  it("delivers firing and recovery events without secrets", async () => {
    const transport = new MemoryAlertTransport();
    const firing = await deliverAlert(transport, {
      policyId: "ready-probe-failing",
      message: "Synthetic readiness failure (staging rehearsal)",
      host: "https://staging.nyayagrid.com",
      status: "firing",
    });
    expect(firing.delivered).toBe(true);
    const recovery = await deliverAlert(transport, {
      policyId: "ready-probe-failing",
      message: "Readiness recovered (staging rehearsal)",
      host: "https://staging.nyayagrid.com",
      status: "resolved",
    });
    expect(recovery.delivered).toBe(true);
    expect(transport.events).toHaveLength(2);
    expect(transport.events[0]!.status).toBe("firing");
    expect(transport.events[1]!.status).toBe("resolved");
  });

  it("refuses secret-shaped alert bodies", () => {
    expect(() =>
      buildAlertEvent({
        policyId: "database-unreachable",
        message: "db down postgresql://user:password@host/db",
      }),
    ).toThrow(/secrets/i);
  });
});
