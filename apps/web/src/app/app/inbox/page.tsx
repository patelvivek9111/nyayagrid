"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type MatterRow = { id: string; title: string };
type EmailRow = {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  status: string;
  documentId: string | null;
};

export default function InboxPage() {
  const { organizationId } = useActiveOrganization();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileMatterId, setFileMatterId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <ProfessionalShell title="Inbox">
      <p className="mb-4 text-sm text-ink/70">
        Paste an email, then confirm the case before it becomes a document. Nyaya never sends mail
        from this screen.
      </p>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Paste email">
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
        </Panel>
        <Panel title="Pending and filed">
          <label className="mb-3 block text-sm font-semibold">
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
          {emails.length === 0 ? (
            <p className="text-sm text-ink/70">No captured emails.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {emails.map((email) => (
                <li key={email.id} className="rounded border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{email.subject}</span>
                    <Badge>{email.status}</Badge>
                  </div>
                  <p className="text-xs text-ink/50">From {email.fromAddress}</p>
                  {email.status === "pending" ? (
                    <div className="mt-2 flex gap-2">
                      <Button type="button" disabled={busy} onClick={() => fileToMatter(email.id)}>
                        Confirm file to case
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => discard(email.id)}
                      >
                        Discard
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
