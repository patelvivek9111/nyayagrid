"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

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
};

export default function ResearchHomePage() {
  const { organizations, organizationId, selectOrganization, loading, error } =
    useActiveOrganization();

  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [newSessionTitle, setNewSessionTitle] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuthorityHit[]>([]);

  const [question, setQuestion] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
          body: JSON.stringify({ organizationId, queryText: question }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Query failed");
      setQueryResult(json);
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

  return (
    <ProfessionalShell title="Nyaya Research">
      {loading ? <p>Loading…</p> : null}
      {error ? <p className="text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {!loading && organizations.length === 0 ? (
        <Panel title="No organization">
          <p className="mb-3 text-sm text-ink/70">Create an organization first.</p>
          <Link href="/app/onboarding" className="text-sm font-semibold text-accent underline">
            Go to onboarding
          </Link>
        </Panel>
      ) : null}
      {organizations.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold">
            Organization{" "}
            <select
              className="ml-2 rounded border border-line px-2 py-1"
              value={organizationId}
              onChange={(e) => selectOrganization(e.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Session{" "}
            <select
              className="ml-2 rounded border border-line px-2 py-1"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Select a session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {message ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{message}</p> : null}

      <p className="mb-4 rounded border border-line bg-accent-soft/30 px-3 py-2 text-xs text-ink/80">
        Current treatment has not been independently verified. NyayaGrid research covers only
        authorities imported into this corpus — it is not a comprehensive survey of the law.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Research sessions">
          <form className="mb-3 flex gap-2" onSubmit={createSession}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="New session title"
              value={newSessionTitle}
              onChange={(e) => setNewSessionTitle(e.target.value)}
            />
            <Button type="submit" disabled={busy || !organizationId}>
              Create
            </Button>
          </form>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink/70">No research sessions yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={`rounded border border-line p-2 ${session.id === sessionId ? "bg-accent-soft/40" : ""}`}
                >
                  <button
                    className="text-left font-semibold underline-offset-2 hover:underline"
                    onClick={() => setSessionId(session.id)}
                  >
                    {session.title}
                  </button>
                  <div className="text-xs text-ink/60">
                    {session.status} {session.matterId ? "· matter-linked" : "· global"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Search authorities">
          <form className="mb-3 flex gap-2" onSubmit={searchAuthorities}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="e.g. preliminary injunction irreparable harm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button type="submit" disabled={busy || !organizationId}>
              Search
            </Button>
          </form>
          {searchResults.length === 0 ? (
            <p className="text-sm text-ink/70">No results yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {searchResults.map((hit) => (
                <li key={hit.chunkId} className="rounded border border-line p-2">
                  <Link
                    href={`/app/research/authorities/${hit.authorityId}`}
                    className="font-semibold text-accent underline"
                  >
                    {hit.title}
                  </Link>
                  <div className="text-xs text-ink/60">
                    {hit.citation ?? "No citation"} · {hit.authorityType}
                    {hit.jurisdiction ? ` · ${hit.jurisdiction}` : ""}
                    {hit.court ? ` · ${hit.court}` : ""}
                  </div>
                  <p className="mt-1 text-ink/80">{hit.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Ask a research question" className="lg:col-span-2">
          <form className="mb-3 flex gap-2" onSubmit={askQuestion}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="e.g. What must a party show to obtain a preliminary injunction?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" disabled={busy || !organizationId || !sessionId}>
              {busy ? "Running…" : "Ask"}
            </Button>
          </form>
          {!sessionId ? (
            <p className="text-sm text-ink/70">Select or create a session to ask a question.</p>
          ) : null}

          {coverageWarnings.length > 0 ? (
            <div className="mb-3 rounded border border-line bg-[color-mix(in_srgb,var(--ng-danger)_8%,white)] p-2 text-xs">
              <p className="font-semibold">Coverage warnings</p>
              <ul className="list-disc pl-4">
                {coverageWarnings.map((warning: string, i: number) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {synthesis ? (
            <div className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap">{synthesis.conciseAnswer}</p>
              {(synthesis.legalPropositions ?? []).length > 0 ? (
                <div>
                  <p className="font-semibold">Legal propositions</p>
                  <ul className="list-disc pl-4">
                    {synthesis.legalPropositions.map((prop: any, i: number) => (
                      <li key={i}>{prop.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {hits.length > 0 ? (
                <div>
                  <p className="font-semibold">Retrieved authorities</p>
                  <ul className="space-y-1">
                    {hits.map((hit) => (
                      <li key={hit.chunkId}>
                        <Link
                          href={`/app/research/authorities/${hit.authorityId}`}
                          className="text-accent underline"
                        >
                          {hit.title}
                        </Link>{" "}
                        <span className="text-ink/60">{hit.citation ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
