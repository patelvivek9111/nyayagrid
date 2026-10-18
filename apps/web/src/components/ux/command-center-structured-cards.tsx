"use client";

import { useState } from "react";
import { Button, cx } from "@nyayagrid/ui";
import {
  FACTUALITY_DISPLAY_LABELS,
  investigateEmptyMessage,
  investigateSourceMapToDrawerItems,
  parseInvestigateNextForCards,
  parseMatterSynthesisForCards,
  turnGapIntoTaskPhrase,
  type InvestigateGapCardModel,
} from "@/lib/command-center-ux";
import type { SourceDrawerItem } from "./source-drawer";

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="mt-1.5 text-xs text-ink/70">
      <span className="font-semibold text-ink/55">{label}: </span>
      {value}
    </p>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const p = priority.toUpperCase();
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        p === "HIGH"
          ? "border-amber-800/35 bg-amber-50 text-amber-950"
          : p === "LOW"
            ? "border-line bg-white text-ink/60"
            : "border-line bg-black/[0.03] text-ink/75",
      )}
      aria-label={`Priority ${p}`}
    >
      {p}
    </span>
  );
}

function FactualityChip({ factuality }: { factuality?: string }) {
  if (!factuality) return null;
  const key = factuality.toUpperCase();
  const label = FACTUALITY_DISPLAY_LABELS[key] ?? key.replace(/_/g, " ");
  return (
    <span
      className="inline-flex rounded border border-line bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink/65"
      aria-label={`Factuality ${label}`}
    >
      {label}
    </span>
  );
}

function GapCard({
  gap,
  disabled,
  onViewSources,
  onTurnIntoTask,
}: {
  gap: InvestigateGapCardModel;
  disabled?: boolean;
  onViewSources: (items: SourceDrawerItem[], activeId?: string) => void;
  onTurnIntoTask: (phrase: string) => void;
}) {
  const [open, setOpen] = useState(gap.priority === "HIGH");
  const sourceItems = investigateSourceMapToDrawerItems(gap.sourceMap) as SourceDrawerItem[];
  const sourceCount = sourceItems.length;

  return (
    <article
      className="rounded-lg border border-line bg-white px-3 py-2.5"
      aria-label={`Investigate gap #${gap.displayIndex}: ${gap.title}`}
      data-gap-id={gap.id}
      data-gap-index={gap.displayIndex}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-xs font-bold text-ink/70" aria-hidden="true">
          #{gap.displayIndex}
        </span>
        <PriorityBadge priority={gap.priority} />
        {gap.gapType ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            {gap.gapType.replace(/_/g, " ")}
          </span>
        ) : null}
        <FactualityChip factuality={gap.factuality} />
      </div>
      <h4 className="mt-1.5 text-sm font-semibold text-ink">{gap.title}</h4>
      {gap.priorityRationale ? (
        <p className="mt-1 text-[11px] text-ink/55">
          <span className="font-semibold">Why this priority: </span>
          {gap.priorityRationale}
        </p>
      ) : null}
      {gap.whyItMatters ? (
        <p className="mt-1.5 text-xs text-ink/75">
          <span className="font-semibold text-ink/55">Why it matters: </span>
          {gap.whyItMatters}
        </p>
      ) : null}
      {gap.recommendedNextStep ? (
        <p className="mt-1.5 text-xs text-ink/75">
          <span className="font-semibold text-ink/55">What to look for: </span>
          {gap.recommendedNextStep}
        </p>
      ) : null}

      <button
        type="button"
        className="mt-2 text-[11px] font-semibold text-accent underline"
        aria-expanded={open}
        aria-label={open ? `Hide details for gap #${gap.displayIndex}` : `Show details for gap #${gap.displayIndex}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide details" : "Show details"}
      </button>

      {open ? (
        <div className="mt-1 border-t border-line/70 pt-1.5">
          <Field label="Description" value={gap.description} />
          <Field label="Related domain" value={gap.relatedDomain?.replace(/_/g, " ")} />
          <Field label="Expected evidence" value={gap.expectedEvidenceType ?? undefined} />
          <Field label="Impact" value={gap.impact} />
          <Field label="Effort" value={gap.effort} />
          <Field label="Status" value={gap.status?.replace(/_/g, " ")} />
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {sourceCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label={`View ${sourceCount} sources for gap #${gap.displayIndex}`}
            onClick={() => onViewSources(sourceItems, sourceItems[0]?.id)}
          >
            View sources ({sourceCount})
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          aria-label={`Turn gap #${gap.displayIndex} into a task`}
          onClick={() => onTurnIntoTask(turnGapIntoTaskPhrase(gap.displayIndex))}
        >
          Turn into task
        </Button>
      </div>
    </article>
  );
}

export function InvestigateNextCards({
  snapshot,
  disabled,
  onViewSources,
  onTurnIntoTask,
}: {
  snapshot: unknown;
  disabled?: boolean;
  onViewSources: (items: SourceDrawerItem[], activeId?: string) => void;
  onTurnIntoTask: (phrase: string) => void;
}) {
  const parsed = parseInvestigateNextForCards(snapshot);
  if (!parsed) return null;

  const empty = investigateEmptyMessage(parsed.posture);
  if (!parsed.gaps.length) {
    return (
      <div
        className="mt-3 rounded-lg border border-line bg-black/[0.02] px-3 py-2.5"
        role="region"
        aria-label="Investigate next"
        data-testid="investigate-next-cards"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Investigate next</p>
        <p className="mt-1.5 text-sm text-ink/75">
          {empty ?? "No investigation gaps are available in this result."}
        </p>
        {parsed.limitations[0] ? (
          <p className="mt-1 text-[11px] text-ink/50">{parsed.limitations[0]}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="mt-3 space-y-2"
      role="region"
      aria-label="Investigate next"
      data-testid="investigate-next-cards"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Investigate next</p>
      <ul className="space-y-2">
        {parsed.gaps.map((gap) => (
          <li key={gap.id}>
            <GapCard
              gap={gap}
              disabled={disabled}
              onViewSources={onViewSources}
              onTurnIntoTask={onTurnIntoTask}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SynthesisSection({
  title,
  items,
  testId,
}: {
  title: string;
  items: string[];
  testId: string;
}) {
  if (!items.length) return null;
  const preview = items.slice(0, 6);
  const rest = items.slice(6);
  return (
    <section className="rounded-md border border-line/80 bg-white px-3 py-2" data-testid={testId}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink/55">{title}</h4>
      <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-ink/80">
        {preview.map((item) => (
          <li key={item.slice(0, 80)}>{item}</li>
        ))}
      </ul>
      {rest.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] font-semibold text-accent">
            Show {rest.length} more
          </summary>
          <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-ink/80">
            {rest.map((item) => (
              <li key={item.slice(0, 80)}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ReadinessSection({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: Array<{ label: string; readiness: string; openGaps?: string[] }>;
  testId: string;
}) {
  if (!rows.length) return null;
  return (
    <section className="rounded-md border border-line/80 bg-white px-3 py-2" data-testid={testId}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink/55">{title}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((row) => (
          <li key={`${row.label}:${row.readiness}`} className="text-xs text-ink/80">
            <span className="font-medium text-ink">{row.label}</span>
            <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/60">
              {row.readiness.replace(/_/g, " ")}
            </span>
            {row.openGaps?.[0] ? (
              <span className="mt-0.5 block text-[11px] text-ink/55">{row.openGaps[0]}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MatterSynthesisCards({ snapshot }: { snapshot: unknown }) {
  const model = parseMatterSynthesisForCards(snapshot);
  if (!model) return null;

  return (
    <div
      className="mt-3 space-y-2"
      role="region"
      aria-label="Matter synthesis"
      data-testid="matter-synthesis-cards"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Matter synthesis</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SynthesisSection title="Core issues" items={model.coreIssues} testId="synth-core-issues" />
        <SynthesisSection
          title="Strongest supported positions"
          items={model.strongestSupported}
          testId="synth-strongest"
        />
        <SynthesisSection title="Weakest areas" items={model.weakestAreas} testId="synth-weakest" />
        <SynthesisSection title="Key facts" items={model.keyFacts} testId="synth-key-facts" />
        <SynthesisSection title="Key evidence" items={model.keyEvidence} testId="synth-key-evidence" />
        <SynthesisSection title="Key people" items={model.keyPeople} testId="synth-key-people" />
        <SynthesisSection title="Material conflicts" items={model.conflicts} testId="synth-conflicts" />
        <SynthesisSection title="Unknowns" items={model.unknowns} testId="synth-unknowns" />
        <ReadinessSection
          title="Claim readiness"
          rows={model.claimReadiness}
          testId="synth-claim-readiness"
        />
        <ReadinessSection
          title="Defense readiness"
          rows={model.defenseReadiness}
          testId="synth-defense-readiness"
        />
        <SynthesisSection
          title="Recent changes"
          items={model.recentChanges}
          testId="synth-recent-changes"
        />
        <SynthesisSection
          title="Investigate next"
          items={model.investigateNextTitles}
          testId="synth-investigate-titles"
        />
      </div>
      {model.limitations.length ? (
        <p className="text-[11px] text-ink/50" data-testid="synth-limitations">
          {model.limitations[0]}
        </p>
      ) : null}
    </div>
  );
}
