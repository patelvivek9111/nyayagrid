"use client";

import type { AskProgressItem, AskStreamEvent } from "@nyayagrid/ai";
import { cx } from "@nyayagrid/ui";
import { stageFromAskStreamEventType } from "../../lib/command-center-ux";

function statusGlyph(status: AskProgressItem["status"]): string {
  if (status === "done") return "✓";
  if (status === "warning") return "!";
  if (status === "error") return "×";
  if (status === "active") return "…";
  return "·";
}

/**
 * Reduce stream events into factual progress rows — no chain-of-thought.
 * Labels map to runtime-supported stages only (Phase 5).
 */
export function progressFromAskEvents(events: AskStreamEvent[]): AskProgressItem[] {
  const byId = new Map<string, AskProgressItem>();
  const upsert = (item: AskProgressItem) => {
    byId.set(item.id, item);
  };

  for (const event of events) {
    const stage = stageFromAskStreamEventType(event.type);
    switch (event.type) {
      case "request_started":
        upsert({
          id: "request",
          label: "Request accepted",
          status: "done",
          detail: stage ?? undefined,
        });
        break;
      case "retrieval_started":
        upsert({
          id: "retrieval",
          label: "Loading matter context…",
          status: "active",
          detail: stage ?? undefined,
        });
        break;
      case "retrieval_completed":
        upsert({
          id: "retrieval",
          label: "Matter sources retrieved",
          status: "done",
          detail: `${event.passagesFound} passage${event.passagesFound === 1 ? "" : "s"}`,
        });
        break;
      case "related_retrieval_started":
        upsert({
          id: "related",
          label: "Retrieving related matter context…",
          status: "active",
        });
        break;
      case "related_retrieval_completed":
        upsert({
          id: "related",
          label: "Related context ready",
          status: "done",
          detail: `+${event.passagesAdded}`,
        });
        break;
      case "amendment_check_started":
        upsert({ id: "amendment", label: "Checking cited authorities…", status: "active" });
        break;
      case "amendment_check_completed":
        upsert({
          id: "amendment",
          label: event.label,
          status: event.status === "controlling_identified" ? "warning" : "done",
        });
        break;
      case "contradiction_check_started":
        upsert({ id: "contradiction", label: "Checking conflicts…", status: "active" });
        break;
      case "contradiction_check_completed":
        upsert({
          id: "contradiction",
          label: event.label,
          status: event.unresolvedCount > 0 ? "warning" : "done",
        });
        break;
      case "citation_check_started":
        upsert({ id: "citations", label: "Checking cited authorities…", status: "active" });
        break;
      case "citation_check_completed":
        upsert({
          id: "citations",
          label: "Citations checked",
          status: event.rejected > 0 ? "warning" : "done",
          detail: `${event.accepted} accepted${event.rejected ? `, ${event.rejected} rejected` : ""}`,
        });
        break;
      case "generation_started":
        upsert({
          id: "generation",
          label: "Preparing answer…",
          status: "active",
          detail: stage ?? undefined,
        });
        break;
      case "generation_completed": {
        // Cancel wins races: never paint COMPLETED after the user stopped.
        const prior = byId.get("generation");
        if (prior?.detail === "CANCELLED" || prior?.label === "Cancelled") {
          break;
        }
        const awaiting = event.ux?.action?.confirmationRequired &&
          (event.ux.action.actionStatus === "AWAITING_CONFIRMATION" ||
            event.ux.action.actionStatus === "PREVIEW");
        upsert({
          id: "generation",
          label: awaiting ? "Waiting for confirmation…" : "Answer ready",
          status: awaiting ? "warning" : "done",
          detail: awaiting ? "WAITING_FOR_CONFIRMATION" : "COMPLETED",
        });
        break;
      }
      case "generation_stopped":
        upsert({
          id: "generation",
          label: "Cancelled",
          status: "warning",
          detail: "CANCELLED",
        });
        break;
      case "generation_failed":
        upsert({
          id: "generation",
          label: "Failed",
          status: "error",
          detail: event.message,
        });
        break;
      default:
        break;
    }
  }

  return [...byId.values()];
}

/** True only when a completed/failed/cancelled terminal event has arrived. */
export function askProgressIsTerminal(events: AskStreamEvent[]): boolean {
  return events.some(
    (e) =>
      e.type === "generation_completed" ||
      e.type === "generation_stopped" ||
      e.type === "generation_failed",
  );
}

export function AskProgress({
  items,
  events,
}: {
  items?: AskProgressItem[];
  events?: AskStreamEvent[];
}) {
  const rows = items ?? (events ? progressFromAskEvents(events) : []);
  if (rows.length === 0) return null;
  const terminal = events ? askProgressIsTerminal(events) : true;
  return (
    <ul
      className="space-y-1 rounded-lg border border-line bg-black/[0.015] px-3 py-2 text-xs text-ink/70"
      aria-live="polite"
      aria-busy={!terminal}
      aria-label="Ask progress"
    >
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-2">
          <span
            className={cx(
              "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold",
              row.status === "done" && "bg-accent-soft text-accent",
              row.status === "warning" && "bg-amber-100 text-amber-800",
              row.status === "error" && "bg-red-100 text-red-700",
              row.status === "active" && "bg-ink/10 text-ink/60",
              row.status === "pending" && "bg-transparent text-ink/35",
            )}
            aria-hidden
          >
            {statusGlyph(row.status)}
          </span>
          <span>
            <span className="font-semibold text-ink/80">{row.label}</span>
            {row.detail && !["REQUEST_ACCEPTED", "RETRIEVING_MATTER", "CONTEXT_LOADING", "FINALIZING", "COMPLETED", "CANCELLED", "WAITING_FOR_CONFIRMATION"].includes(row.detail) ? (
              <span className="text-ink/50"> · {row.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
