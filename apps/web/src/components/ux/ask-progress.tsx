"use client";

import type { AskProgressItem, AskStreamEvent } from "@nyayagrid/ai";
import { cx } from "@nyayagrid/ui";

function statusGlyph(status: AskProgressItem["status"]): string {
  if (status === "done") return "✓";
  if (status === "warning") return "!";
  if (status === "error") return "×";
  if (status === "active") return "…";
  return "·";
}

/**
 * Reduce stream events into factual progress rows — no chain-of-thought.
 */
export function progressFromAskEvents(events: AskStreamEvent[]): AskProgressItem[] {
  const byId = new Map<string, AskProgressItem>();
  const upsert = (item: AskProgressItem) => {
    byId.set(item.id, item);
  };

  for (const event of events) {
    switch (event.type) {
      case "request_started":
        upsert({ id: "request", label: "Request started", status: "done" });
        break;
      case "retrieval_started":
        upsert({ id: "retrieval", label: event.label, status: "active" });
        break;
      case "retrieval_completed":
        upsert({
          id: "retrieval",
          label: event.label,
          status: "done",
          detail: `${event.passagesFound} passage${event.passagesFound === 1 ? "" : "s"}`,
        });
        break;
      case "related_retrieval_started":
        upsert({
          id: "related",
          label: `Related retrieval (${event.reason})`,
          status: "active",
        });
        break;
      case "related_retrieval_completed":
        upsert({
          id: "related",
          label: `Related retrieval (${event.reason})`,
          status: "done",
          detail: `+${event.passagesAdded}`,
        });
        break;
      case "amendment_check_started":
        upsert({ id: "amendment", label: "Checking amendments", status: "active" });
        break;
      case "amendment_check_completed":
        upsert({
          id: "amendment",
          label: event.label,
          status: event.status === "controlling_identified" ? "warning" : "done",
        });
        break;
      case "contradiction_check_started":
        upsert({ id: "contradiction", label: "Checking conflicts", status: "active" });
        break;
      case "contradiction_check_completed":
        upsert({
          id: "contradiction",
          label: event.label,
          status: event.unresolvedCount > 0 ? "warning" : "done",
        });
        break;
      case "citation_check_started":
        upsert({ id: "citations", label: "Checking citations", status: "active" });
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
        upsert({ id: "generation", label: "Generating answer", status: "active" });
        break;
      case "generation_completed":
        upsert({ id: "generation", label: "Answer ready", status: "done" });
        break;
      case "generation_stopped":
        upsert({ id: "generation", label: "Generation stopped", status: "warning" });
        break;
      case "generation_failed":
        upsert({
          id: "generation",
          label: "Generation failed",
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

export function AskProgress({
  items,
  events,
}: {
  items?: AskProgressItem[];
  events?: AskStreamEvent[];
}) {
  const rows = items ?? (events ? progressFromAskEvents(events) : []);
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-line bg-black/[0.015] px-3 py-2 text-xs text-ink/70">
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
            {row.detail ? <span className="text-ink/50"> · {row.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
