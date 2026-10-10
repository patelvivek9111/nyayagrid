"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type CommunicationDetail = {
  id: string;
  subject: string;
  communicationType: string;
  direction: string;
  status: string;
  occurredAt: string | null;
  summary: string | null;
  followUpNeeded: boolean;
  followUpDueAt: string | null;
  primaryDocumentId: string | null;
  followUpTaskId: string | null;
};

export default function CommunicationDetailPage() {
  const params = useParams<{ matterId: string; communicationId: string }>();
  const { matterId, communicationId } = params;
  const [communication, setCommunication] = useState<CommunicationDetail | null>(null);
  const [links, setLinks] = useState<Array<{ linkType: string; targetId: string; note: string | null }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/matters/${matterId}/communications/${communicationId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(userFacingLoadError("communications", res.status));
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setCommunication(json.communication);
        setLinks(json.links ?? []);
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
  }, [matterId, communicationId]);

  if (loading) return <LoadingState label="Loading communication…" />;
  if (error) return <ErrorState message={error} />;
  if (!communication) {
    return (
      <EmptyState
        title="Communication not found"
        description="This communication is not on the matter."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/app/cases/${matterId}/communications`}
          className="text-sm text-accent hover:underline"
        >
          ← Communications
        </Link>
        <h2 className="mt-2 font-display text-2xl text-ink">{communication.subject}</h2>
        <p className="text-sm text-muted">
          {communication.communicationType} · {communication.direction} · {communication.status}
        </p>
      </div>

      <section className="border border-line bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">Summary</h3>
        <p className="whitespace-pre-wrap text-muted">
          {communication.summary || "No factual summary recorded."}
        </p>
        <dl className="mt-3 space-y-1">
          <div>
            <dt className="inline font-semibold">Occurred: </dt>
            <dd className="inline">
              {communication.occurredAt
                ? new Date(communication.occurredAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">Follow-up: </dt>
            <dd className="inline">
              {communication.followUpNeeded
                ? `Needed${
                    communication.followUpDueAt
                      ? ` by ${new Date(communication.followUpDueAt).toLocaleDateString()}`
                      : ""
                  }`
                : "Not marked"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">Source document: </dt>
            <dd className="inline">{communication.primaryDocumentId || "—"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Follow-up task: </dt>
            <dd className="inline">{communication.followUpTaskId || "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="border border-line bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">Related discovery / motions</h3>
        {links.length === 0 ? (
          <p className="text-muted">No related links.</p>
        ) : (
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={`${link.linkType}-${link.targetId}`}>
                <span className="font-semibold">{link.linkType}</span>: {link.targetId}
                {link.linkType === "MOTION" ? (
                  <>
                    {" "}
                    (
                    <Link
                      href={`/app/cases/${matterId}/motions/${link.targetId}`}
                      className="text-accent hover:underline"
                    >
                      open motion
                    </Link>
                    )
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
