"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { ErrorState } from "@/components/ux";
import { Button, Panel } from "@nyayagrid/ui";

type ClientRow = { id: string; displayName: string };

export default function NewCasePage() {
  const router = useRouter();
  const { organizationId } = useActiveOrganization();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [court, setCourt] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
  }, [organizationId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          clientId,
          title,
          practiceArea: practiceArea || null,
          jurisdiction: jurisdiction || null,
          court: court || null,
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

  return (
    <ProfessionalShell title="New Case">
      <Panel>
        <form className="flex max-w-lg flex-col gap-3" onSubmit={onSubmit}>
          <label className="text-sm font-semibold">
            Case name
            <input
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
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
          <p className="text-xs text-ink/55">
            Need a client first?{" "}
            <Link href="/app/clients" className="text-accent underline">
              Manage clients
            </Link>
          </p>
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
            Jurisdiction
            <input
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            />
          </label>
          <label className="text-sm font-semibold">
            Court (optional)
            <input
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
            />
          </label>
          <label className="text-sm font-semibold">
            Description (optional)
            <textarea
              className="mt-1 w-full rounded border border-line px-3 py-2 font-normal"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          {error ? <ErrorState message={error} /> : null}
          <Button type="submit" disabled={busy || !organizationId || !clientId}>
            {busy ? "Creating…" : "Create Case"}
          </Button>
        </form>
      </Panel>
    </ProfessionalShell>
  );
}
