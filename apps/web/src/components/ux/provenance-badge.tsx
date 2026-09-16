"use client";

import type { ProvenanceSummary } from "@nyayagrid/ai";

export function ProvenanceBadge({ provenance }: { provenance: ProvenanceSummary }) {
  return (
    <div
      className="rounded-lg border border-line bg-white px-3 py-2 text-xs"
      role="status"
      aria-label={provenance.headline}
    >
      <p className="font-semibold text-ink">{provenance.headline}</p>
      <p className="mt-0.5 text-ink/60">{provenance.detail}</p>
    </div>
  );
}
