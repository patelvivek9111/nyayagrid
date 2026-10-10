"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type CommunicationRow = {
  id: string;
  subject: string;
  communicationType: string;
  direction: string;
  status: string;
  occurredAt: string | null;
  followUpNeeded: boolean;
  followUpDueAt: string | null;
  summary: string | null;
};

type CommunicationLink = {
  communicationId: string;
  linkType: string;
  targetId: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function MatterCommunicationsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [rows, setRows] = useState<CommunicationRow[]>([]);
  const [links, setLinks] = useState<CommunicationLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [communicationType, setCommunicationType] = useState("MEET_AND_CONFER");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/matters/${matterId}/communications`)
      .then(async (res) => {
        if (!res.ok) throw new Error(userFacingLoadError("communications", res.status));
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setRows(json.communications ?? []);
        setLinks(json.communicationLinks ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : userFacingLoadError("communications"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId]);

  const relatedByComm = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) {
      const list = map.get(link.communicationId) ?? [];
      list.push(link.linkType);
      map.set(link.communicationId, list);
    }
    return map;
  }, [links]);

  async function createCommunication() {
    if (!subject.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          communicationType,
          direction: "OUTBOUND",
          status: "DRAFT",
        }),
      });
      if (!res.ok) throw new Error(userFacingLoadError("communications", res.status));
      const json = await res.json();
      setRows((prev) => [json.communication, ...prev]);
      setSubject("");
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingLoadError("communications"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading communications…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">Communications</h2>
        <p className="mt-1 text-sm text-muted">
          Matter correspondence for meet-and-confer, demands, and follow-up. No intent or credibility
          conclusions.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 border border-line bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Subject</span>
          <input
            className="w-80 border border-line px-2 py-1.5"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Meet-and-confer regarding RFP-12"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Type</span>
          <select
            className="border border-line px-2 py-1.5"
            value={communicationType}
            onChange={(e) => setCommunicationType(e.target.value)}
          >
            <option value="MEET_AND_CONFER">Meet-and-confer</option>
            <option value="DEMAND">Demand</option>
            <option value="FOLLOW_UP">Follow-up</option>
            <option value="DEFICIENCY_NOTICE">Deficiency notice</option>
            <option value="EXTENSION_REQUEST">Extension request</option>
            <option value="OTHER_CORRESPONDENCE">Other</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={saving || !subject.trim()}
          onClick={() => void createCommunication()}
        >
          Create communication
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No communications yet"
          description="Record meet-and-confer and follow-up correspondence."
        />
      ) : (
        <div className="overflow-x-auto border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Direction</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Follow-up</th>
                <th className="px-3 py-2">Related</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/70">
                  <td className="px-3 py-2">{formatDate(row.occurredAt)}</td>
                  <td className="px-3 py-2">{row.communicationType}</td>
                  <td className="px-3 py-2">{row.direction}</td>
                  <td className="px-3 py-2 font-semibold">
                    <Link
                      href={`/app/cases/${matterId}/communications/${row.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {row.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">
                    {row.followUpNeeded
                      ? `Needed${row.followUpDueAt ? ` by ${formatDate(row.followUpDueAt)}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {(relatedByComm.get(row.id) ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
