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

export function NeedsReviewBadge({ children = "Needs review" }: { children?: ReactNode }) {
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

export function DisputedBadge({ children = "Disputed" }: { children?: ReactNode }) {
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

export function ArchivedBadge({ children = "Archived" }: { children?: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border border-line bg-black/[0.03] px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide text-ink/65",
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
  return <DisputedBadge>{children}</DisputedBadge>;
}

/** Case Q&A honesty label — grounded | partial | insufficient */
export function EvidenceStateBadge({ state }: { state?: string | null }) {
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
    <div className="space-y-3" role="status" aria-live="polite" aria-label={label}>
      <p className="sr-only">{label}</p>
      <div className="h-4 w-48 animate-pulse rounded bg-black/[0.06]" />
      <div className="h-16 animate-pulse rounded-lg border border-line bg-white/70" />
      <div className="h-16 animate-pulse rounded-lg border border-line bg-white/70" />
      <div className="h-16 animate-pulse rounded-lg border border-line bg-white/70" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="rounded-lg border border-[var(--ng-danger)]/20 bg-red-50/60 px-4 py-3 text-sm text-[var(--ng-danger)]"
      role="alert"
    >
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="mt-2 font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
