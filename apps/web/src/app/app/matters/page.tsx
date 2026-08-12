"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button, Panel } from "@nyayagrid/ui";

type ClientRow = { id: string; displayName: string };
type MatterRow = {
  id: string;
  title: string;
  matterNumber: string;
  status: string;
  clientDisplayName: string;
  practiceArea: string | null;
  jurisdiction: string | null;
};

export default function MattersPage() {
  const { organizationId, organizations, selectOrganization, loading } = useActiveOrganization();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("Contract dispute");
  const [jurisdiction, setJurisdiction] = useState("Ontario");
  const [message, setMessage] = useState("");

  async function refresh(orgId: string) {
    const [clientsRes, mattersRes] = await Promise.all([
      fetch(`/api/v1/clients?organizationId=${orgId}`),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
    ]);
    const clientsData = await clientsRes.json();
    const mattersData = await mattersRes.json();
    if (!clientsRes.ok) throw new Error(clientsData?.error?.message ?? "Clients failed");
    if (!mattersRes.ok) throw new Error(mattersData?.error?.message ?? "Matters failed");
    setClients(clientsData.clients ?? []);
    setMatters(mattersData.matters ?? []);
    if (!clientId && clientsData.clients?.[0]?.id) setClientId(clientsData.clients[0].id);
  }

  useEffect(() => {
    if (!organizationId) return;
    refresh(organizationId).catch((err) => setMessage(err.message));
  }, [organizationId]);

  async function createMatter(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/v1/matters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        clientId,
        title,
        practiceArea,
        jurisdiction,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Create failed");
      return;
    }
    setTitle("");
    await refresh(organizationId);
    setMessage(`Created matter ${data.matter.matterNumber}`);
  }

  return (
    <ProfessionalShell title="Matters">
      {loading ? <p>Loading…</p> : null}
      {organizations.length > 0 ? (
        <div className="mb-4">
          <select
            className="rounded border border-line px-2 py-1 text-sm"
            value={organizationId}
            onChange={(e) => selectOrganization(e.target.value)}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Create matter">
          <form className="flex flex-col gap-3" onSubmit={createMatter}>
            <select
              className="rounded border border-line px-3 py-2"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.displayName}
                </option>
              ))}
            </select>
            <input
              className="rounded border border-line px-3 py-2"
              placeholder="Matter title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input
              className="rounded border border-line px-3 py-2"
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
            />
            <input
              className="rounded border border-line px-3 py-2"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            />
            <Button type="submit" disabled={!organizationId || !clientId}>
              Create matter
            </Button>
          </form>
          {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
        </Panel>
        <Panel title="Authorized matters">
          {matters.length === 0 ? (
            <p className="text-sm text-ink/70">No matters yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {matters.map((matter) => (
                <li key={matter.id} className="rounded border border-line px-3 py-2">
                  <Link
                    href={`/app/matters/${matter.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {matter.matterNumber} — {matter.title}
                  </Link>
                  <div className="text-ink/60">
                    {matter.clientDisplayName} · {matter.status}
                    {matter.jurisdiction ? ` · ${matter.jurisdiction}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
