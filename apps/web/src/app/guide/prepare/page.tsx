"use client";

import { useEffect, useState } from "react";
import { PublicShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type SituationRow = { id: string; title: string };

type ConsultationPacket = {
  situationSummary: string;
  peopleInvolved: string[];
  timeline: Array<{ date: string | null; title: string; sourceLabel: string }>;
  documentsAvailable: string[];
  questionsForTheLawyer: string[];
  desiredOutcome: string | null;
  missingInformation: string[];
  potentiallyUrgentItems: string[];
  limitations: string[];
};

export default function GuidePreparePage() {
  const [situations, setSituations] = useState<SituationRow[]>([]);
  const [situationId, setSituationId] = useState("");
  const [packet, setPacket] = useState<ConsultationPacket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/guide/situations")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load situations");
        setSituations(data.situations ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  async function generatePacket() {
    if (!situationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/guide/situations/${situationId}/consultation`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to generate packet");
      setPacket(data.packet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate packet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Prepare for a lawyer"
        description="Turn your situation into a short packet you can bring to a consultation — a summary, timeline, documents, and questions to ask. This organizes information; it does not reach a legal conclusion."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="rounded border border-line px-3 py-2 text-sm"
          value={situationId}
          onChange={(e) => setSituationId(e.target.value)}
        >
          <option value="">Select a situation</option>
          {situations.map((situation) => (
            <option key={situation.id} value={situation.id}>
              {situation.title}
            </option>
          ))}
        </select>
        <Button onClick={generatePacket} disabled={busy || !situationId}>
          {busy ? "Preparing…" : "Generate consultation packet"}
        </Button>
        {packet ? (
          <Button type="button" onClick={() => window.print()}>
            Print packet
          </Button>
        ) : null}
      </div>

      {!packet ? (
        <Panel title="No packet yet">
          <p className="text-sm text-ink/70">
            Create a situation first (see &ldquo;Organize Situation&rdquo;), then generate a packet
            here.
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {packet.potentiallyUrgentItems.length > 0 ? (
            <Panel title="Potentially urgent">
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ng-danger)]">
                {packet.potentiallyUrgentItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Summary">
            <p className="whitespace-pre-wrap text-sm text-ink/90">{packet.situationSummary}</p>
            {packet.desiredOutcome ? (
              <p className="mt-2 text-sm text-ink/70">
                <span className="font-semibold">Desired outcome:</span> {packet.desiredOutcome}
              </p>
            ) : null}
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Timeline">
              {packet.timeline.length === 0 ? (
                <p className="text-sm text-ink/70">No events recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {packet.timeline.map((item, i) => (
                    <li key={i} className="rounded border border-line px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span>{item.title}</span>
                        <Badge>{item.sourceLabel.replace(/_/g, " ")}</Badge>
                      </div>
                      <span className="text-xs text-ink/50">{item.date ?? "date unknown"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="People involved">
              {packet.peopleInvolved.length === 0 ? (
                <p className="text-sm text-ink/70">None recorded.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {packet.peopleInvolved.map((person, i) => (
                    <li key={i}>{person}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Documents available">
              {packet.documentsAvailable.length === 0 ? (
                <p className="text-sm text-ink/70">None linked yet.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {packet.documentsAvailable.map((doc, i) => (
                    <li key={i}>{doc}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Missing information">
              {packet.missingInformation.length === 0 ? (
                <p className="text-sm text-ink/70">Nothing flagged.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {packet.missingInformation.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Questions for the lawyer">
            {packet.questionsForTheLawyer.length === 0 ? (
              <p className="text-sm text-ink/70">None generated.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {packet.questionsForTheLawyer.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            )}
          </Panel>

          {packet.limitations.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink/50">
              {packet.limitations.map((limitation, i) => (
                <li key={i}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </PublicShell>
  );
}
