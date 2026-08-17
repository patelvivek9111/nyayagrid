"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { StudentShell } from "@/components/shell";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type CaseRow = { id: string; title: string; citation: string | null };

type ComparisonField = {
  text: string;
  caseAChunkIds: string[];
  caseBChunkIds: string[];
};

type ComparisonContent = {
  facts: ComparisonField;
  issue: ComparisonField;
  rule: ComparisonField;
  reasoning: ComparisonField;
  holding: ComparisonField;
  outcome: ComparisonField;
  tensions: ComparisonField[];
  limitations: string[];
};

const FIELDS: Array<{ key: keyof Omit<ComparisonContent, "tensions" | "limitations">; label: string }> =
  [
    { key: "facts", label: "Facts" },
    { key: "issue", label: "Issue" },
    { key: "rule", label: "Rule" },
    { key: "reasoning", label: "Reasoning" },
    { key: "holding", label: "Holding" },
    { key: "outcome", label: "Outcome" },
  ];

export default function ProfessorComparePage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseAId, setCaseAId] = useState("");
  const [caseBId, setCaseBId] = useState("");
  const [comparison, setComparison] = useState<ComparisonContent | null>(null);
  const [droppedTensionCount, setDroppedTensionCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/professor/cases")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
        setCases(data.cases ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load cases"))
      .finally(() => setLoading(false));
  }, []);

  async function compare(event: FormEvent) {
    event.preventDefault();
    if (!caseAId || !caseBId || caseAId === caseBId) {
      setError("Pick two different cases from your library.");
      return;
    }
    setBusy(true);
    setError("");
    setSavedMessage("");
    try {
      const res = await fetch("/api/v1/professor/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseAId, caseBId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to compare cases");
      setComparison(data.comparison);
      setDroppedTensionCount(data.validation?.droppedTensionCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compare cases");
      setComparison(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveComparison() {
    if (!comparison) return;
    const caseA = cases.find((row) => row.id === caseAId);
    const caseB = cases.find((row) => row.id === caseBId);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/professor/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "case_comparison",
          title: `Compare: ${caseA?.title ?? "Case A"} / ${caseB?.title ?? "Case B"}`,
          content: comparison.holding.text,
          ref: { caseAId, caseBId },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to save comparison");
      setSavedMessage("Comparison saved to your library.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save comparison");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Compare cases"
        description="Compare two opinions from your own library. A tension is shown only when both sides have supporting passages."
      />
      <div className="mb-4">
        <StudyAidNotice />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {savedMessage ? <p className="mb-4 text-sm text-accent">{savedMessage}</p> : null}

      <Panel title="Choose two cases">
        {loading ? (
          <p className="text-sm text-ink/70">Loading your cases…</p>
        ) : cases.length < 2 ? (
          <p className="text-sm text-ink/70">
            Add at least two cases to compare.{" "}
            <Link href="/professor/cases" className="text-accent underline">
              Open your library
            </Link>
          </p>
        ) : (
          <form className="grid gap-3 md:grid-cols-3" onSubmit={compare}>
            <label className="text-sm font-semibold">
              Case A
              <select
                className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
                value={caseAId}
                onChange={(e) => setCaseAId(e.target.value)}
              >
                <option value="">Select…</option>
                {cases.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Case B
              <select
                className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
                value={caseBId}
                onChange={(e) => setCaseBId(e.target.value)}
              >
                <option value="">Select…</option>
                {cases.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Comparing…" : "Compare"}
              </Button>
            </div>
          </form>
        )}
      </Panel>

      {comparison ? (
        <div className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={saveComparison}>
              Save comparison
            </Button>
          </div>
          {FIELDS.map(({ key, label }) => {
            const field = comparison[key];
            return (
              <Panel key={key} title={label}>
                <p className="text-sm text-ink/90">{field.text}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {field.caseAChunkIds.map((id) => (
                    <Badge key={`a-${id}`}>Case A source</Badge>
                  ))}
                  {field.caseBChunkIds.map((id) => (
                    <Badge key={`b-${id}`}>Case B source</Badge>
                  ))}
                </div>
              </Panel>
            );
          })}
          <Panel title="Tensions">
            {droppedTensionCount > 0 ? (
              <p className="mb-2 text-xs text-ink/60">
                {droppedTensionCount} claimed difference
                {droppedTensionCount === 1 ? " was" : "s were"} removed because passages from both
                cases did not support them. No doctrinal split is asserted from those drops.
              </p>
            ) : null}
            {comparison.tensions.length === 0 ? (
              <p className="text-sm text-ink/70">No supported tensions between these passages.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {comparison.tensions.map((tension, index) => (
                  <li key={index} className="rounded border border-line px-3 py-2">
                    {tension.text}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {tension.caseAChunkIds.map((id) => (
                        <Badge key={`ta-${id}`}>Case A</Badge>
                      ))}
                      {tension.caseBChunkIds.map((id) => (
                        <Badge key={`tb-${id}`}>Case B</Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {comparison.limitations.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink/60">
              {comparison.limitations.map((limitation, i) => (
                <li key={i}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </StudentShell>
  );
}
