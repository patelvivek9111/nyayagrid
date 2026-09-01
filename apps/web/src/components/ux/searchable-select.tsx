"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "@nyayagrid/ui";
import { filterSelectOptions } from "@/lib/case-jurisdiction";

export type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
};

export function SearchableSelect({
  id: idProp,
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  allowEmpty = false,
  emptyLabel = "Not set",
  helperText,
  error,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  helperText?: string;
  error?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => filterSelectOptions(options, query), [options, query]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={cx(
          "mt-1 flex w-full items-center justify-between rounded border border-line bg-white px-3 py-2 text-left text-sm font-normal",
          disabled && "cursor-not-allowed opacity-60",
          error && "border-[var(--ng-danger)]",
        )}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <span className={cx(!selected && !value && "text-ink/45")}>
          {value ? (selected?.label ?? value) : allowEmpty ? emptyLabel : placeholder}
        </span>
        <span className="text-ink/40" aria-hidden>
          ▾
        </span>
      </button>
      {helperText ? <p className="mt-1 text-xs text-ink/55">{helperText}</p> : null}
      {error ? (
        <p className="mt-1 text-xs text-[var(--ng-danger)]" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded border border-line bg-white shadow-lg">
          <input
            type="search"
            autoFocus
            className="w-full border-b border-line px-3 py-2 text-sm outline-none"
            placeholder="Type to search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`Search ${label}`}
          />
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1 text-sm">
            {allowEmpty ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className="block w-full px-3 py-2 text-left hover:bg-black/[0.04]"
                  onClick={() => pick("")}
                >
                  {emptyLabel}
                </button>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-ink/50">No matches</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={cx(
                      "block w-full px-3 py-2 text-left hover:bg-black/[0.04]",
                      option.value === value && "bg-accent-soft/40 font-semibold text-accent",
                    )}
                    onClick={() => pick(option.value)}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
