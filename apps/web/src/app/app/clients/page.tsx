"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { IntelligenceDialog, FilterChipBar } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmLoading,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import {
  clientStatusLabel,
  clientTypeLabel,
  countMattersForClient,
  filterClients,
} from "@/lib/firm-workspace-ux";

type ClientRow = {
  id: string;
  displayName: string;
  clientType: string;
  email: string | null;
  status: string;
};

type MatterRow = {
  id: string;
  title: string;
  status: string;
  clientId?: string;
  clientDisplayName?: string;
};

export default function ClientsPage() {
  const { organizations, organizationId, loading, error } = useActiveOrganization();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [clientType, setClientType] = useState<"individual" | "organization">("individual");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load(orgId: string) {
    const [clientsRes, mattersRes] = await Promise.all([
      fetch(`/api/v1/clients?organizationId=${orgId}`),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
    ]);
    const clientsData = await clientsRes.json();
    const mattersData = await mattersRes.json();
    if (!clientsRes.ok) throw new Error(clientsData?.error?.message ?? "Failed to load clients");
    setClients(clientsData.clients ?? []);
    if (mattersRes.ok) setMatters(mattersData.matters ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setMessage(err.message));
  }, [organizationId]);

  async function createClient(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setMessage("");
    try {
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
      if (!res.ok) throw new Error(data?.error?.message ?? "Create failed");
      setDisplayName("");
      setCreateOpen(false);
      await load(organizationId);
      setMessage(`Created client ${data.client.displayName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(
    () => filterClients(clients, { query, typeFilter }),
    [clients, query, typeFilter],
  );
  const selected = clients.find((client) => client.id === selectedId) ?? null;
  const selectedMatters = selected
    ? matters.filter(
        (matter) =>
          matter.clientId === selected.id || matter.clientDisplayName === selected.displayName,
      )
    : [];

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Clients"
        description="People and companies this workspace represents, and the cases linked to them."
        actions={
          <Button type="button" disabled={!organizationId} onClick={() => setCreateOpen(true)}>
            + New client
          </Button>
        }
      />

      {loading ? (
        <div className="mt-6">
          <FirmLoading label="Loading clients…" />
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}

      {!loading && organizations.length === 0 ? (
        <div className="mt-6">
          <FirmEmpty
            title="No workspace yet"
            description="Set up your workspace before adding clients."
            action={
              <Link href="/app/onboarding" className="text-sm font-semibold text-accent underline">
                Set up your workspace
              </Link>
            }
          />
        </div>
      ) : null}

      {organizationId ? (
        <div className="mt-6 space-y-4">
          <FilterChipBar
            value={typeFilter}
            onChange={setTypeFilter}
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search clients"
            searchLabel="Search clients"
            options={[
              { id: "all", label: "All", count: clients.length },
              { id: "individuals", label: "Individuals" },
              { id: "organizations", label: "Organizations" },
              { id: "active", label: "Active" },
            ]}
          />

          {visible.length === 0 ? (
            <FirmEmpty
              title={clients.length === 0 ? "No clients yet." : "No matching clients."}
              description={
                clients.length === 0
                  ? "Add a person or company to connect future cases, time, and billing."
                  : "Try a different search or filter."
              }
              action={
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  + New client
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {visible.map((client) => {
                const matterCount = countMattersForClient(matters, client);
                return (
                  <li key={client.id}>
                    <FirmRow
                      title={client.displayName}
                      subtitle={`${clientTypeLabel(client.clientType)} · ${clientStatusLabel(client.status)}${client.email ? ` · ${client.email}` : ""}`}
                      meta={matterCount === 1 ? "1 case" : `${matterCount} cases`}
                      status={<FirmStatusText>{clientStatusLabel(client.status)}</FirmStatusText>}
                      actions={
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedId(client.id)}
                        >
                          Open
                        </Button>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <IntelligenceDialog
        open={createOpen}
        title="New client"
        description="Add a person or organization this workspace represents."
        onClose={() => setCreateOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createClient}>
          <label className="text-sm font-semibold">
            Type
            <select
              className="mt-1 block w-full rounded border border-line px-3 py-2 font-normal"
              value={clientType}
              onChange={(e) => setClientType(e.target.value as "individual" | "organization")}
            >
              <option value="individual">Individual</option>
              <option value="organization">Organization</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            Display name
            <input
              className="mt-1 block w-full rounded border border-line px-3 py-2 font-normal"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={busy || !organizationId}>
            Create client
          </Button>
        </form>
      </IntelligenceDialog>

      <IntelligenceDialog
        open={Boolean(selected)}
        title={selected?.displayName ?? "Client"}
        description={
          selected
            ? `${clientTypeLabel(selected.clientType)} · ${clientStatusLabel(selected.status)}`
            : undefined
        }
        onClose={() => setSelectedId(null)}
      >
        {selected ? (
          <div className="space-y-3 text-sm">
            {selected.email ? (
              <p>Email: {selected.email}</p>
            ) : (
              <p className="text-ink/55">No email on file.</p>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">Cases</p>
              {selectedMatters.length === 0 ? (
                <p className="mt-1 text-ink/55">No cases linked yet.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {selectedMatters.map((matter) => (
                    <li key={matter.id}>
                      <Link
                        href={`/app/cases/${matter.id}`}
                        className="font-semibold text-accent underline"
                      >
                        {matter.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
