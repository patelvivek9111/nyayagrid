"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useOrgCapability } from "@/components/use-org-capability";
import { ErrorState } from "@/components/ux";
import { SearchableSelect } from "@/components/ux/searchable-select";
import { Button, Panel } from "@nyayagrid/ui";
import { isClientGuestRole } from "@/lib/first-run";
import {
  FORUM_TYPE_OPTIONS,
  type JurisdictionCourtOption,
  type JurisdictionStateOption,
  courtSelectOptions,
  stateSelectOptions,
} from "@/lib/case-jurisdiction";

type ClientRow = { id: string; displayName: string };

export default function NewCasePage() {
  const router = useRouter();
  const { organizationId, organizations, loading: orgLoading } = useActiveOrganization();
  const createCap = useOrgCapability(organizationId, "matters.create");
  const viewCap = useOrgCapability(organizationId, "matters.view");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [primaryState, setPrimaryState] = useState("");
  const [forumType, setForumType] = useState("");
  const [courtId, setCourtId] = useState("");
  const [states, setStates] = useState<JurisdictionStateOption[]>([]);
  const [courts, setCourts] = useState<JurisdictionCourtOption[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (orgLoading) return;
    if (organizations.length === 0) {
      router.replace("/app/onboarding");
      return;
    }
    if (isClientGuestRole(viewCap.roleKey)) {
      router.replace("/portal");
    }
  }, [orgLoading, organizations.length, viewCap.roleKey, router]);

  useEffect(() => {
    if (!organizationId) return;
    fetch(`/api/v1/clients?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setClients(data.clients ?? []);
          if (data.clients?.[0]?.id) setClientId(data.clients[0].id);
        }
      })
      .catch(() => undefined);
    fetch(`/api/v1/jurisdiction/options?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setStates(data.states ?? []);
      })
      .catch(() => undefined);
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !primaryState || !forumType) {
      setCourts([]);
      return;
    }
    const params = new URLSearchParams({
      organizationId,
      state: primaryState,
      forumType,
    });
    fetch(`/api/v1/jurisdiction/options?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setCourts(data.courts ?? []);
      })
      .catch(() => undefined);
  }, [organizationId, primaryState, forumType]);

  async function ensureClientId(): Promise<string> {
    if (clientId) return clientId;
    const name = newClientName.trim();
    if (!name) throw new Error("Add a client name to create this Case.");
    const res = await fetch("/api/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        clientType: "individual",
        displayName: name,
        firstName: name.split(" ")[0],
        lastName: name.split(" ").slice(1).join(" ") || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Could not create client");
    return data.client.id as string;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const resolvedClientId = await ensureClientId();
      const res = await fetch("/api/v1/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          clientId: resolvedClientId,
          title,
          practiceArea: practiceArea || null,
          primaryState: primaryState || null,
          forumType: forumType || null,
          courtId: courtId || null,
          description: description || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Create failed");
      router.push(`/app/cases/${data.matter.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  if (createCap.allowed === false) {
    return (
      <ProfessionalShell title="New Case">
        <p className="text-sm text-ink/70">
          You do not have permission to create a Case. Open an existing Case from the list, or ask
          a lawyer on the matter team.
        </p>
        <Link href="/app/cases" className="mt-3 inline-block text-sm font-semibold text-accent underline">
          View Cases
        </Link>
      </ProfessionalShell>
    );
  }

  return (
    <ProfessionalShell title="New Case">
      <Panel>
        <p className="mb-4 text-sm text-ink/70">
          A Case holds the documents Nyaya can read. Jurisdiction can be added now or later from the
          Case header.
        </p>
        <form className="flex max-w-lg flex-col gap-3" onSubmit={onSubmit}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Required now</p>
          <label className="text-sm font-semibold">
            Case name
            <input
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          {clients.length > 0 ? (
            <label className="text-sm font-semibold">
              Client
              <select
                className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              >
                <option value="">Select client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-sm font-semibold">
              Client name
              <input
                className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Person or company this Case is for"
                required
              />
            </label>
          )}
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            Recommended (optional)
          </p>
          <SearchableSelect
            label="Jurisdiction / State"
            value={primaryState}
            onChange={(value) => {
              setPrimaryState(value);
              setCourtId("");
            }}
            options={stateSelectOptions(states)}
            allowEmpty
            emptyLabel="Add later"
          />
          <label className="text-sm font-semibold">
            Court type
            <select
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={forumType}
              onChange={(e) => {
                setForumType(e.target.value);
                setCourtId("");
              }}
            >
              <option value="">Add later</option>
              {FORUM_TYPE_OPTIONS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <SearchableSelect
            label="Court"
            value={courtId}
            onChange={setCourtId}
            options={courtSelectOptions(courts)}
            allowEmpty
            emptyLabel={primaryState && forumType ? "Court not listed" : "Select state and court type first"}
            disabled={!primaryState || !forumType}
          />
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Can add later</p>
          <label className="text-sm font-semibold">
            Practice area / type
            <input
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
              placeholder="e.g. Employment litigation"
            />
          </label>
          <label className="text-sm font-semibold">
            Description
            <textarea
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          {error ? <ErrorState message={error} /> : null}
          <Button
            type="submit"
            disabled={busy || !organizationId || (!clientId && !newClientName.trim())}
          >
            {busy ? "Creating…" : "Create Case"}
          </Button>
        </form>
      </Panel>
    </ProfessionalShell>
  );
}
