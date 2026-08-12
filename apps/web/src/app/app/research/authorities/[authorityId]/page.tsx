"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

export default function AuthorityViewerPage() {
  const params = useParams<{ authorityId: string }>();
  const authorityId = params.authorityId;
  const { organizationId } = useActiveOrganization();

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  async function load() {
    const res = await fetch(`/api/v1/research/authorities/${authorityId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load authority");
    setData(json);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityId]);

  async function summarize() {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/research/authorities/${authorityId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Summarize failed");
      setSummary(json.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summarize failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <ProfessionalShell title="Authority">
        <p className="text-sm text-[var(--ng-danger)]">{error}</p>
      </ProfessionalShell>
    );
  }
  if (!data) {
    return (
      <ProfessionalShell title="Authority">
        <p>Loading…</p>
      </ProfessionalShell>
    );
  }

  const {
    authority,
    currentVersion,
    versions,
    chunks,
    outboundCitations,
    relationships,
    treatment,
  } = data;

  const chunksByPart = new Map<string, any[]>();
  for (const chunk of chunks ?? []) {
    const part = chunk.opinionPart ?? "opinion";
    if (!chunksByPart.has(part)) chunksByPart.set(part, []);
    chunksByPart.get(part)!.push(chunk);
  }

  return (
    <ProfessionalShell title={authority.shortTitle ?? authority.title}>
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{authority.authorityType}</Badge>
        {authority.jurisdiction ? <Badge>{authority.jurisdiction}</Badge> : null}
        {authority.court ? <Badge>{authority.court}</Badge> : null}
        {authority.decisionDate ? <Badge>{authority.decisionDate}</Badge> : null}
        <Badge>{authority.ingestionStatus}</Badge>
      </div>

      <div className="mb-4 rounded border border-line bg-[color-mix(in_srgb,var(--ng-danger)_8%,white)] p-3 text-sm">
        <p className="font-semibold">Current treatment has not been independently verified.</p>
        <p className="mt-1 text-ink/80">{treatment?.summary ?? "Treatment status unknown."}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Metadata" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-semibold">Title</dt>
              <dd>{authority.title}</dd>
            </div>
            <div>
              <dt className="font-semibold">Citation</dt>
              <dd>{authority.citation ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Normalized citation</dt>
              <dd>{authority.normalizedCitation ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Source</dt>
              <dd>{authority.sourceProvider ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Versions</dt>
              <dd>{versions?.length ?? 0}</dd>
            </div>
          </dl>

          <div className="mt-4">
            <Button disabled={busy || !organizationId} onClick={summarize}>
              {busy ? "Summarizing…" : "Summarize authority"}
            </Button>
          </div>

          {summary ? (
            <div className="mt-4 space-y-2 rounded border border-line p-2 text-sm">
              <p className="text-xs uppercase tracking-wide text-ink/60">
                AI-generated summary · not attorney work product
              </p>
              <p>
                <span className="font-semibold">Facts: </span>
                {summary.facts?.text}
              </p>
              <p>
                <span className="font-semibold">Issue: </span>
                {summary.issue?.text}
              </p>
              <p>
                <span className="font-semibold">Rule: </span>
                {summary.rule?.text}
              </p>
              <p>
                <span className="font-semibold">Reasoning: </span>
                {summary.reasoning?.text}
              </p>
              <p>
                <span className="font-semibold">Holding: </span>
                {summary.holding?.text}
              </p>
              {summary.proceduralPosture?.text ? (
                <p>
                  <span className="font-semibold">Procedural posture: </span>
                  {summary.proceduralPosture.text}
                </p>
              ) : null}
              {summary.concurrenceDissent?.text ? (
                <p>
                  <span className="font-semibold">Concurrence/dissent: </span>
                  {summary.concurrenceDissent.text}
                </p>
              ) : null}
              <p>
                <span className="font-semibold">Relevance: </span>
                {summary.relevance?.text}
              </p>
              {(summary.coverageWarnings ?? []).length > 0 ? (
                <ul className="list-disc pl-4 text-xs text-ink/70">
                  {summary.coverageWarnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <Panel title="Related citations" className="lg:col-span-1">
          {(outboundCitations ?? []).length === 0 && (relationships ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No recorded citations or relationships.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(outboundCitations ?? []).map((cite: any) => (
                <li key={cite.id} className="rounded border border-line p-2">
                  <div className="font-semibold">{cite.rawCitation ?? cite.normalizedCitation}</div>
                  <div className="text-xs text-ink/60">{cite.citationType ?? "citation"}</div>
                </li>
              ))}
              {(relationships ?? []).map((rel: any) => (
                <li key={rel.id} className="rounded border border-line p-2">
                  <div className="font-semibold">{rel.label ?? rel.relationshipType}</div>
                  <div className="text-xs text-ink/60">
                    {rel.relationshipType} · reported by {rel.origin ?? "unknown"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Text" className="lg:col-span-1">
          {chunks?.length === 0 ? (
            <p className="text-sm text-ink/70">No stored text for the current version.</p>
          ) : (
            <div className="max-h-[32rem] space-y-4 overflow-y-auto text-sm">
              {[...chunksByPart.entries()].map(([part, partChunks]) => (
                <div key={part}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                    {part}
                  </p>
                  {partChunks.map((chunk: any) => (
                    <p key={chunk.id} className="mb-2 whitespace-pre-wrap text-ink/80">
                      {chunk.sectionRef ? (
                        <span className="mr-1 font-semibold">{chunk.sectionRef}</span>
                      ) : null}
                      {chunk.content}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
