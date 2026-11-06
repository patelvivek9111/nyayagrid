/**
 * WP-05B — provider-neutral alert transport proof.
 * Starts a local receiver, delivers an alert payload, asserts receipt.
 * Does NOT claim on-call paging certification (no external vendor).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_POLICIES, listPageSeverityAlerts } from "./ops-health";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

describe("WP-05B alert transport (local receiver)", () => {
  let server: Server;
  let endpoint = "";
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> =
    [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/alert") {
        const body = await readBody(req);
        received.push({ headers: { ...req.headers }, body });
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    endpoint = `http://127.0.0.1:${addr.port}/alert`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers a page-severity alert payload to a local receiver", async () => {
    const policy = listPageSeverityAlerts().find((p) => p.id === "ready-probe-failing");
    expect(policy).toBeTruthy();
    const payload = {
      policyId: policy!.id,
      severity: policy!.severity,
      signal: policy!.signal,
      message: "Synthetic readiness failure (WP-05B local transport test)",
      at: new Date().toISOString(),
      // Must never include secrets in alert bodies.
      stagingHost: "https://staging.nyayagrid.com",
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nyayagrid-alert": "1" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(202);
    expect(received.length).toBe(1);
    const body = JSON.parse(received[0]!.body) as typeof payload;
    expect(body.policyId).toBe("ready-probe-failing");
    expect(body.severity).toBe("page");
    expect(JSON.stringify(body)).not.toMatch(/sk_live|password|postgresql:\/\//i);
  });

  it("catalog remains free of destination credentials", () => {
    for (const p of DEFAULT_ALERT_POLICIES) {
      expect(JSON.stringify(p)).not.toMatch(/pagerduty|opsgenie|routing_key|api_key/i);
    }
  });
});
