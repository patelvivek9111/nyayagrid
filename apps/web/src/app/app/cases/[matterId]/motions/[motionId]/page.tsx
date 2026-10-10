"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type MotionDetail = {
  id: string;
  title: string;
  motionType: string;
  status: string;
  summary: string | null;
  disposition: string | null;
  rulingSummary: string | null;
  filedAt: string | null;
  servedAt: string | null;
  oppositionDueAt: string | null;
  oppositionFiledAt: string | null;
  replyDueAt: string | null;
  replyFiledAt: string | null;
  hearingAt: string | null;
  rulingAt: string | null;
  courtName: string | null;
  judgeName: string | null;
};

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function MotionDetailPage() {
  const params = useParams<{ matterId: string; motionId: string }>();
  const { matterId, motionId } = params;
  const [motion, setMotion] = useState<MotionDetail | null>(null);
  const [documents, setDocuments] = useState<Array<{ role: string; documentId: string }>>([]);
  const [links, setLinks] = useState<Array<{ linkType: string; targetId: string; note: string | null }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/matters/${matterId}/motions/${motionId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(userFacingLoadError("motions", res.status));
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setMotion(json.motion);
        setDocuments(
          (json.documents ?? []).map((row: { role: string; documentId: string }) => ({
            role: row.role,
            documentId: row.documentId,
          })),
        );
        setLinks(json.links ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : userFacingLoadError("motions"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId, motionId]);

  if (loading) return <LoadingState label="Loading motion…" />;
  if (error) return <ErrorState message={error} />;
  if (!motion) {
    return (
      <EmptyState title="Motion not found" description="This motion is not available on the matter." />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/cases/${matterId}/motions`} className="text-sm text-accent hover:underline">
          ← Motions
        </Link>
        <h2 className="mt-2 font-display text-2xl text-ink">{motion.title}</h2>
        <p className="text-sm text-muted">
          {motion.motionType} · {motion.status}
          {motion.disposition ? ` · ${motion.disposition}` : ""}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="border border-line bg-white p-4 text-sm">
          <h3 className="mb-2 font-semibold">Overview</h3>
          <p className="whitespace-pre-wrap text-muted">{motion.summary || "No summary recorded."}</p>
          <dl className="mt-3 space-y-1">
            <div>
              <dt className="inline font-semibold">Court: </dt>
              <dd className="inline">{motion.courtName || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Judge: </dt>
              <dd className="inline">{motion.judgeName || "—"}</dd>
            </div>
          </dl>
        </div>
        <div className="border border-line bg-white p-4 text-sm">
          <h3 className="mb-2 font-semibold">Dates (explicit only)</h3>
          <ul className="space-y-1">
            <li>Filed: {fmt(motion.filedAt)}</li>
            <li>Served: {fmt(motion.servedAt)}</li>
            <li>Opposition due: {fmt(motion.oppositionDueAt)}</li>
            <li>Opposition filed: {fmt(motion.oppositionFiledAt)}</li>
            <li>Reply due: {fmt(motion.replyDueAt)}</li>
            <li>Reply filed: {fmt(motion.replyFiledAt)}</li>
            <li>Hearing: {fmt(motion.hearingAt)}</li>
            <li>Ruling: {fmt(motion.rulingAt)}</li>
          </ul>
        </div>
      </section>

      <section className="border border-line bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">Ruling / disposition</h3>
        <p>
          <span className="font-semibold">Disposition:</span> {motion.disposition || "Not recorded"}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-muted">
          {motion.rulingSummary || "No source-backed ruling summary."}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="border border-line bg-white p-4 text-sm">
          <h3 className="mb-2 font-semibold">Documents</h3>
          {documents.length === 0 ? (
            <p className="text-muted">No motion papers linked.</p>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li key={`${doc.role}-${doc.documentId}`}>
                  <span className="font-semibold">{doc.role}</span>: {doc.documentId}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-line bg-white p-4 text-sm">
          <h3 className="mb-2 font-semibold">Links</h3>
          {links.length === 0 ? (
            <p className="text-muted">No claim, discovery, or evidence links.</p>
          ) : (
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={`${link.linkType}-${link.targetId}`}>
                  <span className="font-semibold">{link.linkType}</span>: {link.targetId}
                  {link.note ? ` — ${link.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
