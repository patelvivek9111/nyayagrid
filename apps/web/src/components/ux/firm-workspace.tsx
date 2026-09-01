"use client";

import { cx } from "@nyayagrid/ui";
import type { ReactNode } from "react";
import { ErrorState, LoadingState } from "./trust";

export function FirmPageHeader({
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
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink/65">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function FirmStatRow({ items }: { items: Array<{ label: string; value: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-line bg-white/80 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            {item.label}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function FirmRow({
  title,
  subtitle,
  meta,
  status,
  actions,
  onClick,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  status?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-ink/55">{subtitle}</p> : null}
        {meta ? <p className="mt-0.5 truncate text-xs text-ink/45">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {status}
        {actions}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 rounded-lg border border-line bg-white/80 px-3 py-2.5 text-left hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onClick}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white/80 px-3 py-2.5">
      {inner}
    </div>
  );
}

export function FirmTabs({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string; count?: number }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cx(
            "border-b-2 px-3 py-2 text-sm font-semibold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            value === option.id
              ? "border-accent text-ink"
              : "border-transparent text-ink/55 hover:text-ink",
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

export function FirmEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white/50 px-4 py-6">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1 max-w-xl text-sm text-ink/65">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export { ErrorState as FirmError, LoadingState as FirmLoading };

export function FirmNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line bg-accent-soft/30 px-3 py-2 text-xs text-ink/80">
      {children}
    </p>
  );
}

export function FirmStatusText({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-line bg-black/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink/65">
      {children}
    </span>
  );
}
