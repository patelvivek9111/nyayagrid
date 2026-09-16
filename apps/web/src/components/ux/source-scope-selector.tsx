"use client";

import type { SourceScope } from "@nyayagrid/ai";
import { cx } from "@nyayagrid/ui";

const OPTIONS: Array<{ value: SourceScope; label: string; optional?: boolean }> = [
  { value: "case", label: "This case" },
  { value: "legal_research", label: "Legal research" },
  { value: "web", label: "Web research" },
  { value: "case_plus_legal", label: "Case + Legal", optional: true },
];

/**
 * Explicit source boundary control. Default is Case; Web is never silently selected.
 */
export function SourceScopeSelector({
  value,
  onChange,
  disabled,
  showCasePlusLegal = true,
}: {
  value: SourceScope;
  onChange: (scope: SourceScope) => void;
  disabled?: boolean;
  showCasePlusLegal?: boolean;
}) {
  const options = OPTIONS.filter((o) => showCasePlusLegal || !o.optional);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label="Sources"
    >
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
        Sources
      </span>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cx(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
              selected
                ? "border-accent bg-accent-soft/50 text-accent"
                : "border-line text-ink/65 hover:border-accent/40 hover:text-accent",
              disabled && "opacity-50",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
