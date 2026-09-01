"use client";

import { Button, cx } from "@nyayagrid/ui";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import {
  ArchivedBadge,
  DisputedBadge,
  NeedsReviewBadge,
  SuggestedBadge,
  VerifiedBadge,
} from "./trust";
import type { TrustStatusKind } from "@/lib/case-intelligence-ux";

export function IntelligenceHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-xl text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink/65">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function TrustStatus({ kind }: { kind: TrustStatusKind }) {
  if (kind === "verified") return <VerifiedBadge />;
  if (kind === "suggested") return <SuggestedBadge />;
  if (kind === "needs_review") return <NeedsReviewBadge />;
  if (kind === "disputed") return <DisputedBadge />;
  return <ArchivedBadge />;
}

export function FilterChipBar({
  options,
  value,
  onChange,
  search,
  searchPlaceholder,
  onSearchChange,
  searchLabel,
}: {
  options: Array<{ id: string; label: string; count?: number }>;
  value: string;
  onChange: (id: string) => void;
  search?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  searchLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearchChange ? (
        <input
          className="min-w-[12rem] flex-1 rounded-md border border-line bg-white px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          value={search ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder ?? "Search"}
          aria-label={searchLabel ?? searchPlaceholder ?? "Search"}
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cx(
            "rounded-md border px-3 py-1.5 text-sm font-semibold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            value === option.id ? "border-accent bg-accent-soft/50" : "border-line bg-white",
          )}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {typeof option.count === "number" ? ` (${option.count})` : ""}
        </button>
      ))}
    </div>
  );
}

export function IntelligenceInspector({
  open,
  title,
  subtitle,
  status,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
        aria-label="Close details"
        onClick={onClose}
      />
      <aside
        className={cx(
          "z-40 flex w-full flex-col border border-line bg-white",
          "fixed inset-y-0 right-0 max-w-md shadow-lg",
          "lg:static lg:max-w-none lg:rounded-xl lg:shadow-none",
        )}
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg text-ink">{title}</h3>
              {status}
            </div>
            {subtitle ? <p className="mt-1 text-xs text-ink/55">{subtitle}</p> : null}
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">{children}</div>
        {actions ? (
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">{actions}</div>
        ) : null}
      </aside>
    </>
  );
}

export function IntelligenceDialog({
  open,
  title,
  description,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-ink/30"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="intelligence-dialog-title"
        className={cx(
          "relative z-10 flex max-h-[min(36rem,90vh)] w-full flex-col rounded-xl border border-line bg-white p-5 shadow-lg",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h3 id="intelligence-dialog-title" className="font-display text-lg text-ink">
              {title}
            </h3>
            {description ? <p className="mt-1 text-sm text-ink/65">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function RelatedList({
  heading,
  children,
  empty,
}: {
  heading: string;
  children?: ReactNode;
  empty?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">{heading}</p>
      {children ? (
        <div className="mt-1 space-y-1 text-ink/80">{children}</div>
      ) : (
        <p className="mt-1 text-ink/55">{empty ?? "None recorded."}</p>
      )}
    </div>
  );
}

export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-md border border-line bg-white p-2 shadow-sm">
        {children}
      </div>
    </details>
  );
}

export function CompactSection({
  title,
  href,
  linkLabel,
  children,
  empty,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children?: ReactNode;
  empty?: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-white/80 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        {href && linkLabel ? (
          <Link href={href} className="text-xs font-semibold text-accent underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children ? children : <p className="text-sm text-ink/55">{empty ?? "None recorded."}</p>}
    </section>
  );
}
