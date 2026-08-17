"use client";

import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type MatterRow = { id: string; title: string };
type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  matterId: string;
  totalMinutes: number;
  notes: string | null;
};

export default function BillingPage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
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

  return (
    <ProfessionalShell title="Billing">
      <p className="mb-4 text-sm text-ink/70">
        Draft invoices from posted time, in minutes. This is not trust accounting and does not
        collect payment.
      </p>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <Panel title="Draft from posted time">
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded border border-line px-2 py-1.5 text-sm"
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
          <Button type="button" disabled={busy || !matterId} onClick={createDraft}>
            Create draft invoice
          </Button>
        </div>
      </Panel>

      <div className="mt-4">
        <Panel title="Invoices">
          {invoices.length === 0 ? (
            <p className="text-sm text-ink/70">No invoices yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="rounded border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{invoice.invoiceNumber}</span>
                    <Badge>{invoice.status}</Badge>
                  </div>
                  <p className="text-xs text-ink/60">{invoice.totalMinutes} minutes posted</p>
                  {invoice.status === "draft" ? (
                    <div className="mt-2 flex gap-2">
                      <Button type="button" disabled={busy} onClick={() => review(invoice.id, "issue")}>
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
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ProfessionalShell>
  );
}
