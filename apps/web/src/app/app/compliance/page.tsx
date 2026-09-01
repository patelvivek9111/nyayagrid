"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { IntelligenceDialog } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
  FirmTabs,
} from "@/components/ux/firm-workspace";
import {
  deletionStatusLabel,
  formatShortDate,
  holdScopeLabel,
  holdStatusLabel,
} from "@/lib/firm-workspace-ux";

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
  const [tab, setTab] = useState("holds");
  const [holdOpen, setHoldOpen] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);

  async function load(orgId: string) {
    const [complianceRes, consentRes, mattersRes] = await Promise.all([
      fetch(`/api/v1/organizations/${orgId}/compliance`),
      fetch(`/api/v1/organizations/${orgId}/training-consent`),
      fetch(`/api/v1/matters?organizationId=${orgId}`),
    ]);
    const compliance = await complianceRes.json();
    const consent = await consentRes.json();
    const mattersData = await mattersRes.json();
    if (!complianceRes.ok)
      throw new Error(compliance?.error?.message ?? "Failed to load compliance");
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
      setHoldOpen(false);
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
      setDeletionOpen(false);
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

  const activeHolds = holds.filter((hold) => !hold.releasedAt).length;
  const matterTitle = (id: string | null) =>
    id ? (matters.find((matter) => matter.id === id)?.title ?? null) : null;

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Holds & privacy"
        description="What data is protected, exportable, or pending deletion."
        actions={
          <Button type="button" disabled={!organizationId} onClick={() => setHoldOpen(true)}>
            + Place legal hold
          </Button>
        }
      />
      <div className="mt-4">
        <FirmNotice>
          Legal holds block deletion. Training consent is recorded separately and does not enable
          training in this build. SSO and a signed DPA remain operator/counsel work.
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FirmTabs
          value={tab}
          onChange={setTab}
          options={[
            { id: "holds", label: "Legal holds", count: activeHolds },
            { id: "deletions", label: "Deletion requests" },
            { id: "exports", label: "Exports" },
            { id: "privacy", label: "Training & privacy" },
            { id: "subprocessors", label: "Subprocessors" },
          ]}
        />

        {tab === "holds" ? (
          holds.length === 0 ? (
            <FirmEmpty
              title="No active legal holds."
              description="A hold preserves records and blocks deletion for the selected scope until it is released."
            />
          ) : (
            <ul className="space-y-2">
              {holds.map((hold) => (
                <li key={hold.id}>
                  <FirmRow
                    title={holdScopeLabel(hold.matterId, matterTitle(hold.matterId))}
                    subtitle={`Reason: ${hold.reason}`}
                    status={<FirmStatusText>{holdStatusLabel(hold.releasedAt)}</FirmStatusText>}
                    actions={
                      !hold.releasedAt ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => releaseHold(hold.id)}
                        >
                          Release
                        </Button>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "deletions" ? (
          <div className="space-y-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!organizationId}
              onClick={() => setDeletionOpen(true)}
            >
              Request deletion
            </Button>
            {deletions.length === 0 ? (
              <FirmEmpty
                title="No deletion requests."
                description="Active holds reject new deletion requests. Archive and deletion semantics are unchanged."
              />
            ) : (
              <ul className="space-y-2">
                {deletions.map((row) => (
                  <li key={row.id}>
                    <FirmRow
                      title={row.workspace === "organization" ? "Whole organization" : "Case scope"}
                      subtitle={formatShortDate(row.createdAt) || row.id.slice(0, 8)}
                      status={<FirmStatusText>{deletionStatusLabel(row.status)}</FirmStatusText>}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "exports" ? (
          <div className="space-y-3 rounded-xl border border-line bg-white/80 p-4">
            <p className="text-sm text-ink/70">
              Organization metadata export. Original document text and files are not included. Case
              activity logs remain on each case Home.
            </p>
            <Button type="button" onClick={exportOrg}>
              Download organization metadata export
            </Button>
          </div>
        ) : null}

        {tab === "privacy" ? (
          <div className="space-y-3 rounded-xl border border-line bg-white/80 p-4">
            <p className="text-sm text-ink/70">
              Recorded consent: <FirmStatusText>{consented ? "Recorded" : "None"}</FirmStatusText>
              {" · "}
              Product training pipeline: <FirmStatusText>{trains ? "On" : "Off"}</FirmStatusText>
            </p>
            <p className="text-xs text-ink/55">
              Consent does not mean training is enabled. Recording consent here does not turn on a
              training pipeline.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || consented} onClick={recordConsent}>
                Record separate consent
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !consented}
                onClick={withdrawConsent}
              >
                Withdraw
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "subprocessors" ? (
          <div className="rounded-xl border border-line bg-white/80 p-4 text-sm">
            <p className="text-ink/70">
              The public subprocessor list is a draft. It does not imply an executed DPA.
            </p>
            <a
              className="mt-3 inline-block text-sm font-semibold text-accent underline"
              href="/subprocessors"
            >
              View draft subprocessors
            </a>
          </div>
        ) : null}
      </div>

      <IntelligenceDialog
        open={holdOpen}
        title="Place legal hold"
        description="A hold preserves records and blocks deletion until it is released."
        onClose={() => setHoldOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={placeHold}>
          <label className="text-sm font-semibold">
            Scope
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
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
          </label>
          <label className="text-sm font-semibold">
            Reason
            <input
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={busy}>
            Place hold
          </Button>
        </form>
      </IntelligenceDialog>

      <IntelligenceDialog
        open={deletionOpen}
        title="Request deletion"
        description="Active holds reject new requests. This does not change archive or deletion semantics."
        onClose={() => setDeletionOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <label className="text-sm font-semibold">
            Scope
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 font-normal"
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
          </label>
          <Button type="button" disabled={busy} onClick={requestDeletion}>
            Request deletion
          </Button>
        </div>
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
