"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@nyayagrid/ui";

export type MatterFolder = {
  id: string;
  name: string;
  parentFolderId: string | null;
};

type Props = {
  matterId: string;
  canEdit: boolean;
  activeFolderId: string | null;
  onActiveFolderChange: (folderId: string | null) => void;
  onFoldersChanged?: () => void;
};

export function MatterFoldersPanel({
  matterId,
  canEdit,
  activeFolderId,
  onActiveFolderChange,
  onFoldersChanged,
}: Props) {
  const [folders, setFolders] = useState<MatterFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/folders`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not load folders");
      setFolders(
        (data.folders ?? []).map((f: MatterFolder) => ({
          id: f.id,
          name: f.name,
          parentFolderId: f.parentFolderId ?? null,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load folders");
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rootFolders = useMemo(
    () =>
      folders.filter((f) => f.parentFolderId == null).sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !newName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          parentFolderId: activeFolderId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not create folder");
      setNewName("");
      await load();
      onFoldersChanged?.();
      setMessage(`Created folder ${data.folder.name}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create folder");
    } finally {
      setBusy(false);
    }
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !renameId || !renameValue.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/folders/${renameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not rename folder");
      setRenameId(null);
      setRenameValue("");
      await load();
      onFoldersChanged?.();
      setMessage(`Renamed folder to ${data.folder.name}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not rename folder");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(folderId: string) {
    if (!canEdit) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/folders/${folderId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Could not delete folder");
      if (activeFolderId === folderId) onActiveFolderChange(null);
      await load();
      onFoldersChanged?.();
      setMessage("Deleted empty folder");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not delete folder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-line bg-white/80 p-3" aria-label="Document folders">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Folders</h2>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => onActiveFolderChange(null)}
        >
          All documents
        </Button>
      </div>

      {loading ? <p className="text-sm text-ink/55">Loading folders…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-ink/70">{message}</p> : null}

      {!loading && rootFolders.length === 0 ? (
        <p className="text-sm text-ink/55">
          No folders yet. Create one to organize Case documents.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {rootFolders.map((folder) => (
            <li
              key={folder.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${
                activeFolderId === folder.id ? "bg-accent-soft/40" : "hover:bg-black/[0.03]"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-ink"
                onClick={() => onActiveFolderChange(folder.id)}
              >
                {folder.name}
              </button>
              {canEdit ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRenameId(folder.id);
                      setRenameValue(folder.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void deleteFolder(folder.id)}
                  >
                    Delete
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={createFolder}>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">New folder</span>
            <input
              className="rounded border border-line px-2 py-1.5"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={activeFolderId ? "Subfolder name" : "Folder name"}
              maxLength={200}
              required
            />
          </label>
          <Button type="submit" disabled={busy || !newName.trim()}>
            Create
          </Button>
        </form>
      ) : null}

      {renameId ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={renameFolder}>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Rename folder</span>
            <input
              className="rounded border border-line px-2 py-1.5"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <Button type="submit" disabled={busy || !renameValue.trim()}>
            Save name
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setRenameId(null);
              setRenameValue("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export async function moveDocumentToFolder(params: {
  matterId: string;
  documentId: string;
  folderId: string | null;
}): Promise<void> {
  const res = await fetch(
    `/api/v1/matters/${params.matterId}/documents/${params.documentId}/folder`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: params.folderId }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? "Could not move document");
  }
}
