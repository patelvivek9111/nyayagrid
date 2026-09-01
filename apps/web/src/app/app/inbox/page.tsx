"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Button } from "@nyayagrid/ui";
import { FilterChipBar, IntelligenceDialog } from "@/components/ux/case-intelligence";
import {
  FirmEmpty,
  FirmError,
  FirmNotice,
  FirmPageHeader,
  FirmRow,
  FirmStatusText,
} from "@/components/ux/firm-workspace";
import {
  inboxBucket,
  inboxStatusLabel,
  filterInbox,
  formatShortDate,
  type FirmInboxEmail,
} from "@/lib/firm-workspace-ux";

type MatterRow = { id: string; title: string };

export default function InboxPage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [emails, setEmails] = useState<FirmInboxEmail[]>([]);
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileMatterId, setFileMatterId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [tab, setTab] = useState("pending");

  async function load(orgId: string) {
    const [mattersRes, inboxRes] = await Promise.all([
      fetch(`/api/v1/matters?organizationId=${orgId}`),
      fetch(`/api/v1/inbox?organizationId=${orgId}`),
    ]);
    const mattersData = await mattersRes.json();
    const inboxData = await inboxRes.json();
    if (!mattersRes.ok) throw new Error(mattersData?.error?.message ?? "Failed to load cases");
    if (!inboxRes.ok) throw new Error(inboxData?.error?.message ?? "Failed to load inbox");
    setMatters(mattersData.matters ?? []);
    setEmails(inboxData.emails ?? []);
  }

  useEffect(() => {
    if (!organizationId) return;
    load(organizationId).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }, [organizationId]);

  async function capture(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fromAddress, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to capture email");
      setFromAddress("");
      setSubject("");
      setBody("");
      setCaptureOpen(false);
      setTab("pending");
      await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function fileToMatter(emailId: string) {
    if (!fileMatterId) {
      setError("Select a case before filing");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/inbox/${emailId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matterId: fileMatterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to file email");
      if (organizationId) await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function discard(emailId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/inbox/${emailId}/discard`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to discard");
      if (organizationId) await load(organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = emails.filter((email) => inboxBucket(email.status) === "pending").length;
  const filedCount = emails.filter((email) => inboxBucket(email.status) === "filed").length;
  const visible = useMemo(() => filterInbox(emails, tab), [emails, tab]);

  return (
    <ProfessionalShell>
      <FirmPageHeader
        title="Inbox"
        description="Captured communications waiting to be filed to a case. NyayaGrid does not send mail from this screen."
        actions={
          <Button type="button" disabled={!organizationId} onClick={() => setCaptureOpen(true)}>
            + Capture email
          </Button>
        }
      />
      <div className="mt-4">
        <FirmNotice>
          Paste an email to capture it for review. Nothing is filed to a case until you confirm.
        </FirmNotice>
      </div>
      {error ? (
        <div className="mt-4">
          <FirmError message={error} />
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <FilterChipBar
          value={tab}
          onChange={setTab}
          options={[
            { id: "pending", label: "Pending", count: pendingCount },
            { id: "filed", label: "Filed", count: filedCount },
          ]}
        />

        {tab === "pending" && pendingCount > 0 ? (
          <label className="block max-w-sm text-sm font-semibold">
            File to case
            <select
              className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
              value={fileMatterId}
              onChange={(e) => setFileMatterId(e.target.value)}
            >
              <option value="">Select a case</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {visible.length === 0 ? (
          <FirmEmpty
            title={tab === "filed" ? "No filed emails yet." : "No captured emails yet."}
            description={
              tab === "filed"
                ? "Filed messages appear here after you file them to a case."
                : "Captured messages will appear here before they are filed to a case."
            }
            action={
              tab === "pending" ? (
                <Button type="button" onClick={() => setCaptureOpen(true)}>
                  + Capture email
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((email) => (
              <li key={email.id}>
                <FirmRow
                  title={email.subject}
                  subtitle={`From ${email.fromAddress}${email.matterId ? ` · ${matters.find((m) => m.id === email.matterId)?.title ?? "Case"}` : ""}`}
                  meta={formatShortDate(email.createdAt) || undefined}
                  status={<FirmStatusText>{inboxStatusLabel(email.status)}</FirmStatusText>}
                  actions={
                    email.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => fileToMatter(email.id)}
                        >
                          File to case
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => discard(email.id)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : email.matterId ? (
                      <a
                        href={`/app/cases/${email.matterId}`}
                        className="text-xs font-semibold text-accent underline"
                      >
                        Open case
                      </a>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <IntelligenceDialog
        open={captureOpen}
        title="Capture email"
        description="Paste an email to capture it for review. NyayaGrid does not send mail from this screen."
        onClose={() => setCaptureOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={capture}>
          <input
            className="rounded border border-line px-2 py-1.5 text-sm"
            placeholder="From"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            required
          />
          <input
            className="rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
          <textarea
            className="min-h-[160px] rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy}>
            Capture for review
          </Button>
        </form>
      </IntelligenceDialog>
    </ProfessionalShell>
  );
}
