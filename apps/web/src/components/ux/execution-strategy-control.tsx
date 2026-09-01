"use client";

import { useEffect, useState } from "react";

export type ExecutionStrategyValue = "auto" | "fast" | "deep";

export type RoutingModelOption = {
  id: string;
  displayName: string;
  certification: string;
};

const HELPERS: Record<ExecutionStrategyValue, string> = {
  auto: "Nyaya selects a validated model and verification strategy for this task.",
  fast: "Lower latency. Still uses citations, jurisdiction, provenance, and abstention.",
  deep: "Uses additional verification for higher-stakes work and may take longer.",
};

export function ExecutionStrategyControl({
  subsystem,
  value,
  onChange,
  modelId,
  onModelChange,
}: {
  subsystem: "ask" | "research" | "draft";
  value: ExecutionStrategyValue;
  onChange: (value: ExecutionStrategyValue) => void;
  modelId?: string;
  onModelChange?: (modelId: string | undefined) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [models, setModels] = useState<RoutingModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/ai/routing-options?subsystem=${subsystem}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setModels(json.models ?? json.data?.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [subsystem]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Nyaya execution strategy">
        {(
          [
            ["auto", "Auto"],
            ["fast", "Fast"],
            ["deep", "Deep Review"],
          ] as const
        ).map(([id, label]) => (
          <label
            key={id}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${
              value === id ? "border-accent bg-accent-soft/50 text-accent" : "border-line text-ink/70"
            }`}
          >
            <input
              type="radio"
              name={`nyaya-strategy-${subsystem}`}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
        {onModelChange ? (
          <button
            type="button"
            className="text-xs font-semibold text-ink/60 underline-offset-2 hover:underline"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            Advanced
          </button>
        ) : null}
      </div>
      <p className="text-xs text-ink/60">{HELPERS[value]}</p>
      {advanced && onModelChange ? (
        <label className="flex flex-col gap-1 text-xs text-ink/70">
          Validated model
          <select
            className="rounded border border-line px-2 py-1 text-sm"
            value={modelId ?? ""}
            onChange={(e) => onModelChange(e.target.value || undefined)}
          >
            <option value="">Auto (validated only)</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
