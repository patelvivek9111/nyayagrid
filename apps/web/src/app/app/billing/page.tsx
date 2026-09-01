"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import {
  billingSummary,
  formatDurationMinutes,
  formatShortDate,
  invoiceStatusLabel,
  type FirmInvoiceRow,
} from "@/lib/firm-workspace-ux";

type MatterRow = { id: string; title: string; clientDisplayName?: string };

export default function BillingPage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [invoices, setInvoices] = useState<FirmInvoiceRow[]>([]);
  const [matterId, setMatterId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(orgId: string) {
    const [mattersRes, invoicesRes] = await Promise.all([
      fetch(`/api/v1/matters?organizationId=${orgId}`),
      fetch(`/api/v1/invoices?organizationId=${orgId}`),
    ]);
    const mattersData = await mattersRes.json();
    const invoicesData = await invoicesRes.json();
    if (!mattersRes.ok) throw new Error(mattersData?.error?.message ?? "Failed to load cases");
    if (!invoicesRes.ok) throw new Error(invoicesData?.error?.message ?? "Failed to load invoices");
    setMatters(mattersData.matters ?? []);
    setInvoices(invoicesData.invoices ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  async function createDraft() {
    if (!organizationId || !matterId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, matterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to draft invoice");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(invoiceId: string, action: "issue" | "void") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to update invoice");
      if (organizationId) await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const summary = billingSummary(invoices);
  const matterById = new Map(matters.map((matter) => [matter.id, matter]));

  return (
    <ProfessionalShell>
      <FirmPageHeader title="Billing" description="Draft invoices from posted time." />
      <div className="mt-4">
        <FirmNotice>
          This is not trust accounting and does not collect payment. Amounts are posted minutes, not
          fees.
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FirmStatRow
          items={[
            { label: "Draft invoices", value: String(summary.draftCount) },
            { label: "Issued invoices", value: String(summary.issuedCount) },
          ]}
        />

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-white/80 px-3 py-3">
          <label className="text-sm font-semibold">
            Case
            <select
              className="mt-1 block min-w-[16rem] rounded border border-line px-2 py-1.5 font-normal"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
            >
              <option value="">Select a case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" disabled={busy || !matterId} onClick={createDraft}>
            Create draft invoice
          </Button>
        </div>

        {invoices.length === 0 ? (
          <FirmEmpty
            title="No invoices yet."
            description="Posted time can be used to create a draft invoice."
          />
        ) : (
          <ul className="space-y-2">
            {invoices.map((invoice) => {
              const matter = matterById.get(invoice.matterId);
              return (
                <li key={invoice.id}>
                  <FirmRow
                    title={invoice.invoiceNumber}
                    subtitle={`${matter?.clientDisplayName ? `${matter.clientDisplayName} · ` : ""}${matter?.title ?? "Case"}`}
                    meta={`${formatDurationMinutes(invoice.totalMinutes)} posted${formatShortDate(invoice.createdAt) ? ` · ${formatShortDate(invoice.createdAt)}` : ""}`}
                    status={<FirmStatusText>{invoiceStatusLabel(invoice.status)}</FirmStatusText>}
                    actions={
                      invoice.status === "draft" ? (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => review(invoice.id, "issue")}
                          >
                            Issue
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => review(invoice.id, "void")}
                          >
                            Void
                          </Button>
                        </div>
                      ) : (
                        <Link
                          href={`/app/cases/${invoice.matterId}`}
                          className="text-xs font-semibold text-accent underline"
                        >
                          Open case
                        </Link>
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ProfessionalShell>
  );
}
