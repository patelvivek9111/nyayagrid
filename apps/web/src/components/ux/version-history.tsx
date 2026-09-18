"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@nyayagrid/ui";
import { useMatterChrome } from "@/components/use-matter-chrome";

type HistoryVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
  actorUserId: string | null;
  source: string;
  description: string;
  current: boolean;
  restorationOfVersionId: string | null;
};

type DiffChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

type Preview = {
  summary: string;
  restorableCount: number;
  conflictCount: number;
  irreversibleCount: number;
  items: Array<{
    objectType: string;
    objectId: string;
    description: string;
    conflict: { message: string } | null;
    irreversible: boolean;
    irreversibleReason: string | null;
    approvalReset: boolean;
  }>;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Recovery mutation controls fail closed.
 * Prefer explicit `canRestore`; otherwise derive from matter chrome (false until proven).
 */
export function VersionHistoryPanel({
  matterId,
  objectType,
  objectId,
  canRestore: canRestoreProp,
}: {
  matterId: string;
  objectType: string;
  objectId: string | null;
  canRestore?: boolean;
}) {
  const { canRestore: chromeCanRestore } = useMatterChrome();
  // Explicit prop wins; otherwise chrome (false until proven allowed).
  const canRestore = canRestoreProp ?? chromeCanRestore;

  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compareFrom, setCompareFrom] = useState<string>("");
  const [compareTo, setCompareTo] = useState<string>("");
  const [changes, setChanges] = useState<DiffChange[] | null>(null);
  const [conflict, setConflict] = useState<string>("");

  const load = useCallback(async () => {
    if (!objectId) return;
    const res = await fetch(
      `/api/v1/matters/${matterId}/recovery/history?objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}`,
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Could not load version history");
    setVersions(json.versions ?? []);
  }, [matterId, objectType, objectId]);

  useEffect(() => {
    if (!objectId) return;
    setError("");
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load version history"));
  }, [load, objectId]);

  const current = versions.find((v) => v.current);

  async function restore(versionId: string, asNew = true) {
    if (!objectId || !canRestore) return;
    setBusy(true);
    setError("");
    setConflict("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/recovery/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType,
          objectId,
          targetVersionId: versionId,
          expectedCurrentVersionId: current?.id,
          restoreAsNewVersion: asNew,
          idempotencyKey: `restore:${objectId}:${versionId}:${current?.id ?? "none"}`,
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setConflict(json?.error?.message ?? "Newer changes exist");
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Restore failed");
      setChanges(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!objectId || !canRestore) return;
    setBusy(true);
    setError("");
    setConflict("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/recovery/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "object", objectType, objectId }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setConflict(json?.error?.message ?? "Newer changes exist");
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? "Undo failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!objectId || !compareFrom || !compareTo) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/recovery/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType,
          objectId,
          fromVersionId: compareFrom,
          toVersionId: compareTo,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Compare failed");
      setChanges(json.changes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setBusy(false);
    }
  }

  if (!objectId) {
    return <p className="text-sm text-ink/70">Select an item to see its version history.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Version history</p>
        {canRestore ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={undo}>
            Undo last change
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-ink/55">
        Restoring appends a new version. Earlier versions stay available, and original files are not
        changed.
      </p>
      {error ? (
        <p className="text-sm text-[var(--ng-danger)]" role="alert">
          {error}
        </p>
      ) : null}
      {conflict ? (
        <div className="rounded border border-amber-700/30 bg-amber-50 px-3 py-2 text-sm" role="status">
          <p className="font-semibold">Newer changes exist</p>
          <p className="mt-1 text-ink/80">{conflict}</p>
          <p className="mt-1 text-xs text-ink/60">
            Items changed after this action won&apos;t be overwritten.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy || !compareFrom} onClick={compare}>
              View diff
            </Button>
            {canRestore && current ? (
              <Button
                type="button"
                disabled={busy || !compareFrom}
                onClick={() => restore(compareFrom || versions[0]?.id || "", true)}
              >
                Restore as a new version
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setConflict("")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ul aria-label="Version history" className="space-y-2 text-sm">
        {versions.map((version) => (
          <li key={version.id} className="rounded border border-line p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">v{version.versionNumber}</span>
              <span className="text-xs text-ink/60">{version.source}</span>
            </div>
            <p className="text-xs text-ink/70">{version.description}</p>
            <p className="text-[11px] text-ink/50">{formatTime(version.createdAt)}</p>
            {version.current ? (
              <p className="mt-1 text-[11px] font-semibold text-accent">Current version</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {canRestore ? (
                  <Button
                    className="mt-1"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setCompareFrom(version.id);
                      setCompareTo(current?.id ?? "");
                      restore(version.id, true);
                    }}
                  >
                    Restore this version
                  </Button>
                ) : null}
                <Button
                  className="mt-1"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCompareFrom(version.id);
                    setCompareTo(current?.id ?? version.id);
                    void compare();
                  }}
                >
                  Compare
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {versions.length >= 2 ? (
        <div className="space-y-2 border-t border-line pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Compare versions</p>
          <div className="flex gap-2">
            <select
              aria-label="Earlier version"
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              value={compareFrom}
              onChange={(e) => setCompareFrom(e.target.value)}
            >
              <option value="">Earlier</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber}
                </option>
              ))}
            </select>
            <select
              aria-label="Later version"
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
            >
              <option value="">Later</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="secondary" disabled={busy || !compareFrom || !compareTo} onClick={compare}>
            Compare
          </Button>
        </div>
      ) : null}
      {changes ? (
        <ul aria-label="Version differences" className="space-y-1 text-xs">
          {changes.length === 0 ? <li>No field differences.</li> : null}
          {changes.map((change, idx) => (
            <li key={`${change.path}-${idx}`}>
              <span className="font-semibold">{change.kind}</span> {change.path}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SessionRestoreControl({ matterId }: { matterId: string }) {
  const { canRestore } = useMatterChrome();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const storageKey = useMemo(() => `nyaya-work-session:${matterId}`, [matterId]);

  useEffect(() => {
    if (!canRestore) {
      setSessionId(null);
      setPreview(null);
      return;
    }
    const existing = sessionStorage.getItem(storageKey);
    if (existing) {
      setSessionId(existing);
      return;
    }
    fetch(`/api/v1/matters/${matterId}/recovery/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Case work session" }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Could not start work session");
        sessionStorage.setItem(storageKey, json.session.id);
        setSessionId(json.session.id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not start work session"));
  }, [matterId, storageKey, canRestore]);

  async function loadPreview() {
    if (!sessionId || !canRestore) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/recovery/session/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not preview session restore");
      setPreview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview session restore");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!sessionId || !preview || !canRestore) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/recovery/session/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          idempotencyKey: `session-restore:${sessionId}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Session restore failed");
      setPreview(json.preview ?? preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session restore failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canRestore) {
    return (
      <div className="rounded-lg border border-line bg-white p-3 text-sm">
        <p className="font-semibold">Session restore</p>
        <p className="mt-1 text-xs text-ink/60">
          Restoring a work session requires edit access on this matter. You can still view version
          history where available.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white p-3 text-sm">
      <p className="font-semibold">Restore this session to start</p>
      <p className="mt-1 text-xs text-ink/60">
        Restores your reversible changes from this session as new versions. Other people&apos;s later
        work and original uploads stay as they are.
      </p>
      {error ? (
        <p className="mt-2 text-[var(--ng-danger)]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy || !sessionId} onClick={loadPreview}>
          Preview restore
        </Button>
        {preview ? (
          <Button type="button" disabled={busy} onClick={confirmRestore}>
            Confirm restore
          </Button>
        ) : null}
      </div>
      {preview ? (
        <div className="mt-2 space-y-1 text-xs">
          <p>{preview.summary}</p>
          {preview.items.map((item) => (
            <p key={`${item.objectType}:${item.objectId}`}>
              {item.description}
              {item.conflict ? ` — ${item.conflict.message}` : ""}
              {item.irreversible ? ` — ${item.irreversibleReason}` : ""}
              {item.approvalReset ? " — approval will need review again." : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
