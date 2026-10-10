"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type MotionRow = {
  id: string;
  title: string;
  motionType: string;
  status: string;
  disposition: string | null;
  filedAt: string | null;
  hearingAt: string | null;
  oppositionDueAt: string | null;
  replyDueAt: string | null;
  movingPartyEntityId: string | null;
};

type MotionLink = {
  motionId: string;
  linkType: string;
  targetId: string;
  note: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function nextDeadline(motion: MotionRow): string {
  const candidates = [
    { label: "Opposition due", at: motion.oppositionDueAt },
    { label: "Reply due", at: motion.replyDueAt },
    { label: "Hearing", at: motion.hearingAt },
  ]
    .filter((row) => row.at)
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  if (candidates.length === 0) return "—";
  const next = candidates[0]!;
  return `${next.label} ${formatDate(next.at)}`;
}

export default function MatterMotionsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [motions, setMotions] = useState<MotionRow[]>([]);
  const [links, setLinks] = useState<MotionLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [motionType, setMotionType] = useState("MOTION_TO_COMPEL");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/matters/${matterId}/motions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(userFacingLoadError("motions", res.status));
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setMotions(json.motions ?? []);
        setLinks(json.motionLinks ?? []);
        setError(null);
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
  }, [matterId]);

  const relatedByMotion = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) {
      const list = map.get(link.motionId) ?? [];
      list.push(`${link.linkType}:${link.targetId.slice(0, 8)}`);
      map.set(link.motionId, list);
    }
    return map;
  }, [links]);

  async function createMotion() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/motions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), motionType, status: "DRAFT" }),
      });
      if (!res.ok) throw new Error(userFacingLoadError("motions", res.status));
      const json = await res.json();
      setMotions((prev) => [json.motion, ...prev]);
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingLoadError("motions"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading motions…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">Motions</h2>
        <p className="mt-1 text-sm text-muted">
          Source-backed motion status, deadlines, and discovery links. No predictive outcomes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 border border-line bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Title</span>
          <input
            className="w-72 border border-line px-2 py-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Motion to Compel — RFP-12"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Type</span>
          <select
            className="border border-line px-2 py-1.5"
            value={motionType}
            onChange={(e) => setMotionType(e.target.value)}
          >
            <option value="MOTION_TO_COMPEL">Motion to compel</option>
            <option value="SUMMARY_JUDGMENT">Summary judgment</option>
            <option value="MOTION_TO_DISMISS">Motion to dismiss</option>
            <option value="MOTION_IN_LIMINE">Motion in limine</option>
            <option value="PROTECTIVE_ORDER">Protective order</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={saving || !title.trim()}
          onClick={() => void createMotion()}
        >
          Create motion
        </button>
      </div>

      {motions.length === 0 ? (
        <EmptyState
          title="No motions yet"
          description="Create a motion or link one from discovery practice."
        />
      ) : (
        <div className="overflow-x-auto border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Filed</th>
                <th className="px-3 py-2">Next deadline</th>
                <th className="px-3 py-2">Disposition</th>
                <th className="px-3 py-2">Related</th>
              </tr>
            </thead>
            <tbody>
              {motions.map((motion) => (
                <tr key={motion.id} className="border-b border-line/70">
                  <td className="px-3 py-2 font-semibold">
                    <Link
                      href={`/app/cases/${matterId}/motions/${motion.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {motion.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{motion.motionType}</td>
                  <td className="px-3 py-2">{motion.status}</td>
                  <td className="px-3 py-2">{formatDate(motion.filedAt)}</td>
                  <td className="px-3 py-2">{nextDeadline(motion)}</td>
                  <td className="px-3 py-2">{motion.disposition ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {(relatedByMotion.get(motion.id) ?? []).slice(0, 3).join(", ") || "—"}
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
