"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type HoldRow = {
  id: string;
  reason: string;
  matterId: string | null;
  documentId: string | null;
  releasedAt: string | null;
};
type DeletionRow = { id: string; status: string; workspace: string; createdAt: string };
type MatterRow = { id: string; title: string };

const CONSENT_STATEMENT =
  "I record explicit, separate consent that this organization may later allow listed model providers to use our customer data for training. This does not turn on training in NyayaGrid today.";

export default function CompliancePage() {
  const { organizationId } = useActiveOrganization();
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [deletions, setDeletions] = useState<DeletionRow[]>([]);
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [reason, setReason] = useState("");
  const [matterId, setMatterId] = useState("");
  const [consented, setConsented] = useState(false);
  const [trains, setTrains] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(orgId: string) {
    const [complianceRes, consentRes, mattersRes] = await Promise.all([
      fetch(`/api/v1/organizations/${orgId}/compliance`),
      fetch(`/api/v1/organizations/${orgId}/training-consent`),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
    ]);
    const compliance = await complianceRes.json();
    const consent = await consentRes.json();
    const mattersData = await mattersRes.json();
    if (!complianceRes.ok) throw new Error(compliance?.error?.message ?? "Failed to load compliance");
    setHolds(compliance.holds ?? []);
    setDeletions(compliance.deletionRequests ?? []);
    if (consentRes.ok) {
      setConsented(Boolean(consent.consented));
      setTrains(Boolean(consent.trainsOnCustomerData));
    }
    if (mattersRes.ok) setMatters(mattersData.matters ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  async function placeHold(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/compliance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          matterId: matterId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to place hold");
      setReason("");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold(holdId: string) {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/compliance/holds/${holdId}/release`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to release hold");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/compliance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "deletion",
          scopeType: matterId ? "matter" : "organization",
          organizationId,
          matterId: matterId || undefined,
          reason: reason || "Deletion requested from Compliance",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to request deletion");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportOrg() {
    if (!organizationId) return;
    const res = await fetch(`/api/v1/organizations/${organizationId}/export`);
    if (!res.ok) {
      const data = await res.json();
      setError(data?.error?.message ?? "Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nyayagrid-org-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function recordConsent() {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/training-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement: CONSENT_STATEMENT }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to record consent");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawConsent() {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/organizations/${organizationId}/training-consent`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to withdraw");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProfessionalShell title="Holds & privacy">
      <p className="mb-4 text-sm text-ink/70">
        Legal holds block deletion. Audit export is per case (no document text). Training consent is
        recorded separately and does <span className="font-semibold">not</span> enable training in
        this build. SSO and a signed DPA remain operator/counsel work.
      </p>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="space-y-4">
        <Panel title="Legal hold">
          <form className="mb-3 flex flex-col gap-2" onSubmit={placeHold}>
            <select
              className="rounded border border-line px-2 py-1.5 text-sm"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
            >
              <option value="">Whole organization</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
            <input
              className="rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Reason (required to place a hold)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Place hold
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={requestDeletion}>
                Request deletion
              </Button>
            </div>
          </form>
          {holds.length === 0 ? (
            <p className="text-sm text-ink/70">No holds recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {holds.map((hold) => (
                <li key={hold.id} className="rounded border border-line px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span>{hold.reason}</span>
                    <Badge>{hold.releasedAt ? "released" : "active"}</Badge>
                  </div>
                  {!hold.releasedAt ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => releaseHold(hold.id)}
                    >
                      Release
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Deletion requests">
          {deletions.length === 0 ? (
            <p className="text-sm text-ink/70">None yet. Active holds reject new requests.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {deletions.map((row) => (
                <li key={row.id} className="flex justify-between gap-2">
                  <span>{row.id.slice(0, 8)}</span>
                  <Badge>{row.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Exports">
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={exportOrg}>
              Download organization metadata export
            </Button>
            <a className="ng-button ng-button-secondary text-sm" href="/subprocessors">
              Subprocessors (draft)
            </a>
          </div>
          <p className="mt-2 text-xs text-ink/50">
            Case activity logs: open a case Home and choose Download activity log. Original files
            are not included.
          </p>
        </Panel>

        <Panel title="Model-training consent">
          <p className="mb-2 text-sm text-ink/70">
            Default: no consent. Product training pipeline:{" "}
            <Badge>{trains ? "on" : "off"}</Badge>. Recorded consent:{" "}
            <Badge>{consented ? "recorded" : "none"}</Badge>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || consented} onClick={recordConsent}>
              Record separate consent
            </Button>
            <Button type="button" variant="secondary" disabled={busy || !consented} onClick={withdrawConsent}>
              Withdraw
            </Button>
          </div>
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
