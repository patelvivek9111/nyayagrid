"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { FilterChipBar, IntelligenceDialog } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import { researchSessionKindLabel, authorityRelationshipLabel } from "@/lib/firm-workspace-ux";
import { humanizeKey } from "@/lib/plain-labels";
import { ExecutionStrategyControl, type ExecutionStrategyValue } from "@/components/ux/execution-strategy-control";

type ResearchSession = {
  id: string;
  title: string;
  status: string;
  matterId: string | null;
  updatedAt: string;
};

type AuthorityHit = {
  authorityId: string;
  authorityVersionId: string;
  chunkId: string;
  title: string;
  citation: string | null;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  decisionDate: string | null;
  score: number;
  snippet: string;
  hierarchyRelationship?: string;
};

type ResearchSynthesis = {
  conciseAnswer?: string;
  legalPropositions?: Array<{ text: string }>;
  coverageWarnings?: string[];
  jurisdictionCaveats?: string[];
};

export default function ResearchHomePage() {
  const { organizations, organizationId, loading, error } = useActiveOrganization();

  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuthorityHit[]>([]);
  const [panel, setPanel] = useState("answer");

  const [question, setQuestion] = useState("");
  const [queryResult, setQueryResult] = useState<{
    synthesis?: ResearchSynthesis;
    hits?: AuthorityHit[];
    results?: AuthorityHit[];
    coverageWarnings?: string[];
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [executionStrategy, setExecutionStrategy] = useState<ExecutionStrategyValue>("auto");
  const [modelId, setModelId] = useState<string | undefined>(undefined);

  async function loadSessions(orgId: string) {
    const res = await fetch(`/api/v1/research/sessions?organizationId=${orgId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load sessions");
    setSessions(json.sessions ?? []);
    if (!sessionId && json.sessions?.[0]) setSessionId(json.sessions[0].id);
  }

  useEffect(() => {
    if (!organizationId) return;
    loadSessions(organizationId).catch((err) => setMessage(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function createSession(e: FormEvent) {
    e.preventDefault();
    if (!organizationId || !newSessionTitle.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/research/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, title: newSessionTitle }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to create session");
      setNewSessionTitle("");
      setSessionOpen(false);
      await loadSessions(organizationId);
      setSessionId(json.session.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setBusy(false);
    }
  }

  async function searchAuthorities(e: FormEvent) {
    e.preventDefault();
    if (!organizationId || !searchQuery.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(
        `/api/v1/research/authorities?organizationId=${organizationId}&q=${encodeURIComponent(searchQuery)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Search failed");
      setSearchResults(json.authorities ?? []);
      setPanel("authorities");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function askQuestion(e: FormEvent) {
    e.preventDefault();
    if (!organizationId || !sessionId || !question.trim()) return;
    setBusy(true);
    setMessage("");
    setQueryResult(null);
    try {
      const res = await fetch(
        `/api/v1/research/sessions/${sessionId}/query?organizationId=${organizationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            queryText: question,
            executionStrategy,
            modelId,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Query failed");
      setQueryResult(json);
      setPanel("answer");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }

  const synthesis = queryResult?.synthesis;
  const hits: AuthorityHit[] = queryResult?.hits ?? queryResult?.results ?? [];
  const coverageWarnings: string[] =
    queryResult?.coverageWarnings ?? synthesis?.coverageWarnings ?? [];
  const currentSession = sessions.find((session) => session.id === sessionId) ?? null;

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Nyaya Research"
        description="Ask a legal question against the imported corpus for this workspace."
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={!organizationId}
            onClick={() => setSessionOpen(true)}
          >
            + New research session
          </Button>
        }
      />
      <div className="mt-4">
        <FirmNotice>
          Current treatment has not been independently verified. NyayaGrid research covers only
          authorities imported into this corpus — it is not a comprehensive survey of the law.
        </FirmNotice>
      </div>
      {loading ? <p className="mt-4 text-sm text-ink/55">Loading…</p> : null}
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-[var(--ng-danger)]">{message}</p> : null}

      {!loading && organizations.length === 0 ? (
        <div className="mt-6">
          <FirmEmpty
            title="No workspace yet"
            description="Create a workspace before running research."
            action={
              <Link href="/app/onboarding" className="text-sm font-semibold text-accent underline">
                Go to onboarding
              </Link>
            }
          />
        </div>
      ) : null}

      {organizationId ? (
        <div className="mt-6 space-y-4">
          <form className="rounded-xl border border-line bg-white/80 p-4" onSubmit={askQuestion}>
            <label className="text-sm font-semibold" htmlFor="research-question">
              Ask a research question
            </label>
            {currentSession ? (
              <p className="mt-1 text-xs text-ink/55">
                Session: {currentSession.title} ·{" "}
                {researchSessionKindLabel(currentSession.matterId)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink/55">
                Create a research session to ask a question.
              </p>
            )}
            <div className="mt-3">
              <ExecutionStrategyControl
                subsystem="research"
                value={executionStrategy}
                onChange={setExecutionStrategy}
                modelId={modelId}
                onModelChange={setModelId}
              />
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id="research-question"
                className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-sm"
                placeholder="Ask a research question…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button type="submit" disabled={busy || !sessionId}>
                {busy ? "Researching…" : "Research"}
              </Button>
            </div>
          </form>

          <FilterChipBar
            value={panel}
            onChange={setPanel}
            options={[
              { id: "answer", label: "Answer" },
              { id: "authorities", label: "Authorities" },
              { id: "sessions", label: "Recent research" },
            ]}
          />

          {panel === "answer" ? (
            !synthesis && coverageWarnings.length === 0 ? (
              <FirmEmpty
                title="Start with a legal research question."
                description="Answers are grounded in the imported corpus for this workspace, with sources attached."
              />
            ) : (
              <div className="space-y-4 rounded-xl border border-line bg-white/80 p-4 text-sm">
                {coverageWarnings.length > 0 ? (
                  <div className="rounded border border-line bg-[color-mix(in_srgb,var(--ng-danger)_8%,white)] p-3 text-xs">
                    <p className="font-semibold">Coverage warnings</p>
                    <ul className="mt-1 list-disc pl-4">
                      {coverageWarnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {synthesis?.conciseAnswer ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                      Answer
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{synthesis.conciseAnswer}</p>
                  </div>
                ) : null}
                {(synthesis?.jurisdictionCaveats ?? []).length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                      Jurisdiction
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {(synthesis?.jurisdictionCaveats ?? []).map((caveat, i) => (
                        <li key={i}>{caveat}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(synthesis?.legalPropositions ?? []).length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                      Legal propositions
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {(synthesis?.legalPropositions ?? []).map((prop, i) => (
                        <li key={i}>{prop.text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {hits.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                      Authorities
                    </p>
                    <ul className="mt-2 space-y-2">
                      {hits.map((hit) => (
                        <li key={hit.chunkId}>
                          <Link
                            href={`/app/research/authorities/${hit.authorityId}`}
                            className="font-semibold text-accent underline"
                          >
                            {hit.title}
                          </Link>
                          <p className="text-xs text-ink/55">
                            {hit.citation ?? "No citation"}
                            {hit.court ? ` · ${hit.court}` : ""}
                            {hit.jurisdiction ? ` · ${hit.jurisdiction}` : ""}
                            {hit.decisionDate ? ` · ${hit.decisionDate}` : ""}
                            {hit.hierarchyRelationship
                              ? ` · ${authorityRelationshipLabel(hit.hierarchyRelationship)}`
                              : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {panel === "authorities" ? (
            <div className="space-y-3">
              <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchAuthorities}>
                <input
                  className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-sm"
                  placeholder="Search authorities"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button type="submit" disabled={busy || !organizationId}>
                  Search
                </Button>
              </form>
              {searchResults.length === 0 ? (
                <FirmEmpty
                  title="No authority results yet."
                  description="Search the imported corpus. Classification and ranking are unchanged."
                />
              ) : (
                <ul className="space-y-2">
                  {searchResults.map((hit) => (
                    <li key={hit.chunkId}>
                      <FirmRow
                        title={hit.title}
                        subtitle={`${hit.citation ?? "No citation"}${hit.court ? ` · ${hit.court}` : ""}${hit.jurisdiction ? ` · ${hit.jurisdiction}` : ""}`}
                        meta={hit.snippet}
                        status={
                          <FirmStatusText>
                            {hit.hierarchyRelationship
                              ? authorityRelationshipLabel(hit.hierarchyRelationship)
                              : humanizeKey(hit.authorityType)}
                          </FirmStatusText>
                        }
                        actions={
                          <Link
                            href={`/app/research/authorities/${hit.authorityId}`}
                            className="text-xs font-semibold text-accent underline"
                          >
                            View source
                          </Link>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {panel === "sessions" ? (
            sessions.length === 0 ? (
              <FirmEmpty
                title="No research sessions yet."
                description="Create a session to keep questions and retrieved authorities together."
                action={
                  <Button type="button" onClick={() => setSessionOpen(true)}>
                    + New research session
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <FirmRow
                      title={session.title}
                      subtitle={researchSessionKindLabel(session.matterId)}
                      status={
                        session.id === sessionId ? (
                          <FirmStatusText>Current</FirmStatusText>
                        ) : undefined
                      }
                      actions={
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSessionId(session.id)}
                        >
                          Use session
                        </Button>
                      }
                    />
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}

      <IntelligenceDialog
        open={sessionOpen}
        title="New research session"
        description="Sessions keep a research question and retrieved authorities together."
        onClose={() => setSessionOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createSession}>
          <input
            className="rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Session title"
            value={newSessionTitle}
            onChange={(e) => setNewSessionTitle(e.target.value)}
          />
          <Button type="submit" disabled={busy || !organizationId}>
            Create session
          </Button>
        </form>
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
