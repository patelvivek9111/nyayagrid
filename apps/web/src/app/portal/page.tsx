"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type OrgRow = { id: string; name: string };
type MatterRow = { id: string; title: string; matterNumber: string };
type DocumentRow = { id: string; title: string };

export default function PortalPage() {
  const [organizations, setOrganizations] = useState<OrgRow[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [matterId, setMatterId] = useState("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/organizations")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load organizations");
        const orgs = data.organizations ?? [];
        setOrganizations(orgs);
        if (orgs[0]?.id) setOrganizationId(orgs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    fetch(`/api/v1/matters?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
        setMatters(data.matters ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  useEffect(() => {
    if (!matterId) {
      setDocuments([]);
      return;
    }
    fetch(`/api/v1/matters/${matterId}/documents`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load documents");
        setDocuments(data.documents ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [matterId]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!matterId || !question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode: "ask", execute: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Ask failed");
      const text =
        data.qa?.answer?.text ??
        data.qa?.answer ??
        data.qa?.artifact?.content ??
        JSON.stringify(data.qa ?? data, null, 2);
      setAnswer(typeof text === "string" ? text : JSON.stringify(text, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-display text-xl text-ink">Client portal</p>
            <p className="text-xs uppercase tracking-[0.16em] text-accent">Assigned cases only</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-accent underline">
            Professional
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <PageHeader
          eyebrow="NyayaGrid"
          title="Your cases"
          description="Documents and limited Ask for matters you have been assigned. This is not a student or public workspace."
        />
        {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold">
            Organization
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Case
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
            >
              <option value="">Select a case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title} ({matter.matterNumber})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Documents">
            {!matterId ? (
              <p className="text-sm text-ink/70">Select a case to see documents.</p>
            ) : documents.length === 0 ? (
              <p className="text-sm text-ink/70">No documents on this case.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {documents.map((document) => (
                  <li key={document.id} className="rounded border border-line px-3 py-2">
                    {document.title} <Badge>view</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Ask about this case">
            <form className="flex flex-col gap-3" onSubmit={ask}>
              <textarea
                className="min-h-[120px] rounded border border-line px-2 py-1.5 text-sm"
                placeholder="Ask a question about the documents on this case"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button type="submit" disabled={busy || !matterId || !question.trim()}>
                {busy ? "Asking…" : "Ask"}
              </Button>
            </form>
            {answer ? <p className="mt-3 whitespace-pre-wrap text-sm text-ink/80">{answer}</p> : null}
          </Panel>
        </div>
      </main>
    </div>
  );
}
