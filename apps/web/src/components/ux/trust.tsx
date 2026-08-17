"use client";

import { cx } from "@nyayagrid/ui";
import type { ReactNode } from "react";

export function VerifiedBadge({ children = "Verified" }: { children?: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border border-accent/30 bg-accent-soft/60 px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function SuggestedBadge({ children = "Suggested by Nyaya" }: { children?: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border border-amber-700/25 bg-amber-50 px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide text-amber-800",
      )}
    >
      {children}
    </span>
  );
}

export function ConflictingEvidenceBadge({
  children = "Conflicting evidence",
}: {
  children?: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border border-[var(--ng-danger)]/30 bg-red-50 px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide text-[var(--ng-danger)]",
      )}
    >
      {children}
    </span>
  );
}

/** Case Q&A honesty label — grounded | partial | insufficient */
export function EvidenceStateBadge({
  state,
}: {
  state?: string | null;
}) {
  const normalized = (state ?? "").toLowerCase().trim();
  if (normalized === "grounded") {
    return <VerifiedBadge>Grounded in Case sources</VerifiedBadge>;
  }
  if (normalized === "partial") {
    return <SuggestedBadge>Partial — verify sources</SuggestedBadge>;
  }
  if (normalized === "insufficient" || normalized === "insufficient_evidence") {
    return (
      <span
        className={cx(
          "inline-flex items-center rounded border border-line bg-black/[0.03] px-2 py-0.5",
          "text-[11px] font-semibold uppercase tracking-wide text-ink/65",
        )}
      >
        Insufficient evidence
      </span>
    );
  }
  return null;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white/50 px-6 py-10 text-center">
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink/65">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="text-sm text-ink/60" suppressHydrationWarning>
      {label}
    </p>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <p className="text-sm text-[var(--ng-danger)]">{message}</p>;
}
