/**
 * WP-05 — staging alert delivery (privacy-safe payloads only).
 * Uses injectable transport so unit tests never need SMTP.
 */

import { DEFAULT_ALERT_POLICIES, type AlertPolicy } from "./ops-health";

export type AlertEvent = {
  policyId: string;
  severity: AlertPolicy["severity"];
  signal: string;
  message: string;
  at: string;
  host?: string;
  status?: "firing" | "resolved";
};

export type AlertTransport = {
  readonly name: string;
  send(event: AlertEvent): Promise<{ delivered: boolean; detail: string }>;
};

export class ConsoleAlertTransport implements AlertTransport {
  readonly name = "console";
  async send(event: AlertEvent) {
    // Structured console only — never include secrets or case content in alerts.
    console.warn(
      JSON.stringify({
        scope: "ops-alert",
        message: event.message,
        policyId: event.policyId,
        severity: event.severity,
        signal: event.signal,
        status: event.status ?? "firing",
        host: event.host ?? null,
        at: event.at,
      }),
    );
    return { delivered: true, detail: "console" };
  }
}

/** In-memory transport for deterministic tests / local rehearsal. */
export class MemoryAlertTransport implements AlertTransport {
  readonly name = "memory";
  readonly events: AlertEvent[] = [];
  async send(event: AlertEvent) {
    this.events.push(event);
    return { delivered: true, detail: `memory:${this.events.length}` };
  }
}

export function buildAlertEvent(params: {
  policyId: string;
  message: string;
  host?: string;
  status?: "firing" | "resolved";
  at?: string;
}): AlertEvent {
  const policy = DEFAULT_ALERT_POLICIES.find((p) => p.id === params.policyId);
  if (!policy) {
    throw new Error(`Unknown alert policy: ${params.policyId}`);
  }
  const message = params.message.slice(0, 500);
  if (/postgresql:\/\/|sk_live|password=|REDIS_URL|CLERK_SECRET/i.test(message)) {
    throw new Error("Refusing to send alert that appears to contain secrets");
  }
  return {
    policyId: policy.id,
    severity: policy.severity,
    signal: policy.signal,
    message,
    at: params.at ?? new Date().toISOString(),
    host: params.host,
    status: params.status ?? "firing",
  };
}

export async function deliverAlert(
  transport: AlertTransport,
  params: {
    policyId: string;
    message: string;
    host?: string;
    status?: "firing" | "resolved";
  },
): Promise<{ delivered: boolean; event: AlertEvent; detail: string }> {
  const event = buildAlertEvent(params);
  const result = await transport.send(event);
  return { delivered: result.delivered, event, detail: result.detail };
}
