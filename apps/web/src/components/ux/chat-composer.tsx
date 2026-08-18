"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, cx } from "@nyayagrid/ui";

export type CaseOption = { id: string; title: string; matterNumber?: string };

export function CaseChip({ label, onClear }: { label: string; onClear?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent-soft/50 px-2.5 py-1 text-xs font-semibold text-accent">
      {label}
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded px-1 text-accent/70 hover:bg-white/60 hover:text-accent"
          aria-label="Remove case context"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask Nyaya…",
  disabled,
  busy,
  caseChip,
  onSelectCase,
  onUploadDocument,
  onRunTask,
  cases = [],
  footer,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  caseChip?: ReactNode;
  onSelectCase?: (caseId: string) => void;
  onUploadDocument?: (file: File) => void;
  onRunTask?: () => void;
  cases?: CaseOption[];
  footer?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled || busy) return;
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      {caseChip ? <div className="mb-2 flex flex-wrap gap-2">{caseChip}</div> : null}
      <div className="rounded-xl border border-line bg-white shadow-sm focus-within:border-accent/40">
        <textarea
          className="min-h-[88px] w-full resize-y rounded-t-xl border-0 bg-transparent px-4 py-3 text-sm outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || busy}
          rows={3}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1 text-sm font-semibold text-ink/70 hover:bg-black/[0.03]"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              +
            </button>
            {onRunTask ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs font-semibold text-ink/55 hover:text-accent"
                onClick={onRunTask}
              >
                Start a task
              </button>
            ) : null}
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-line bg-white py-1 shadow-md"
              >
                {onSelectCase && cases.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto border-b border-line py-1">
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink/45">
                      Use a case
                    </p>
                    {cases.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="menuitem"
                        className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent-soft/40"
                        onClick={() => {
                          onSelectCase(c.id);
                          setMenuOpen(false);
                        }}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                ) : null}
                {onSelectCase ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent-soft/40"
                    onClick={() => {
                      window.location.href = "/app/cases/new";
                    }}
                  >
                    New case…
                  </button>
                ) : null}
                {onUploadDocument ? (
                  <label className="block cursor-pointer px-3 py-1.5 text-sm hover:bg-accent-soft/40">
                    Upload a file
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUploadDocument(file);
                        setMenuOpen(false);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent-soft/40"
                  onClick={() => {
                    window.location.href = "/app/research";
                    setMenuOpen(false);
                  }}
                >
                  Search legal sources
                </button>
              </div>
            ) : null}
          </div>
          <Button type="submit" disabled={disabled || busy || !value.trim()}>
            {busy ? "Working…" : "Send"}
          </Button>
        </div>
      </div>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </form>
  );
}

export function SourceMarker({ index, onClick }: { index: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded px-1",
        "align-super text-[10px] font-bold text-accent hover:bg-accent-soft",
      )}
      aria-label={`Open source ${index}`}
    >
      [{index}]
    </button>
  );
}
