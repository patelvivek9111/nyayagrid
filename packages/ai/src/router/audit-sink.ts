import type { RoutingAuditRecord } from "./audit";

type RoutingAuditSink = (record: RoutingAuditRecord) => void;

let sink: RoutingAuditSink | undefined;

/** Apps persist usage from routing audits. Generate must not fail if the sink throws. */
export function setRoutingAuditSink(next: RoutingAuditSink | undefined): void {
  sink = next;
}

export function emitRoutingAudit(record: RoutingAuditRecord): void {
  try {
    sink?.(record);
  } catch {
    // Persistence is best-effort.
  }
}
