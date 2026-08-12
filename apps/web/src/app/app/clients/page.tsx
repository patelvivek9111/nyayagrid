"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button, Panel } from "@nyayagrid/ui";

type ClientRow = {
  id: string;
  displayName: string;
  clientType: string;
  email: string | null;
  status: string;
};

export default function ClientsPage() {
  const { organizations, organizationId, selectOrganization, loading, error } =
    useActiveOrganization();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [clientType, setClientType] = useState<"individual" | "organization">("individual");
  const [message, setMessage] = useState("");

  async function loadClients(orgId: string) {
    const res = await fetch(`/api/v1/clients?organizationId=${orgId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load clients");
    setClients(data.clients ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    loadClients(organizationId).catch((err) => setMessage(err.message));
  }, [organizationId]);

  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const res = await fetch("/api/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        clientType,
        displayName,
        firstName: clientType === "individual" ? displayName.split(" ")[0] : null,
        lastName:
          clientType === "individual" ? displayName.split(" ").slice(1).join(" ") || null : null,
        organizationName: clientType === "organization" ? displayName : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Create failed");
      return;
    }
    setDisplayName("");
    await loadClients(organizationId);
    setMessage(`Created client ${data.client.displayName}`);
  }

  return (
    <ProfessionalShell title="Clients">
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
        <div className="mb-4">
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
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Create client">
          <form className="flex flex-col gap-3" onSubmit={createClient}>
            <select
              className="rounded border border-line px-3 py-2"
              value={clientType}
              onChange={(e) => setClientType(e.target.value as "individual" | "organization")}
            >
              <option value="individual">Individual</option>
              <option value="organization">Organization</option>
            </select>
            <input
              className="rounded border border-line px-3 py-2"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <Button type="submit" disabled={!organizationId}>
              Create client
            </Button>
          </form>
          {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
        </Panel>
        <Panel title="Client list">
          {clients.length === 0 ? (
            <p className="text-sm text-ink/70">No clients yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {clients.map((client) => (
                <li key={client.id} className="rounded border border-line px-3 py-2">
                  <div className="font-semibold">{client.displayName}</div>
                  <div className="text-ink/60">
                    {client.clientType} · {client.status}
                    {client.email ? ` · ${client.email}` : ""}
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
