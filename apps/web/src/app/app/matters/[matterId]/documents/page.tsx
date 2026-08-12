"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Button, Panel, Badge } from "@nyayagrid/ui";

type Doc = {
  id: string;
  title: string;
  processingState: string;
  malwareScanStatus: string;
  processingError: string | null;
};

export default function MatterDocumentsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [title, setTitle] = useState("Matter");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    const matterRes = await fetch(`/api/v1/matters/${matterId}`);
    const matterData = await matterRes.json();
    if (matterRes.ok) setTitle(`${matterData.matter.matterNumber} — ${matterData.matter.title}`);
    const res = await fetch(`/api/v1/matters/${matterId}/documents`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load documents");
    setDocs(data.documents ?? []);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage(err.message));
  }, [matterId]);

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/matters/${matterId}/documents`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed");
      setMessage(
        `Uploaded. Processing state: ${data.document?.processingState ?? data.processing?.state}`,
      );
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <MatterShell matterId={matterId} title={title}>
      <Panel title="Upload document">
        <p className="mb-3 text-sm text-ink/70">
          Supported: PDF (native text), DOCX, TXT. OCR is not enabled in Phase 2.
        </p>
        <input type="file" accept=".pdf,.docx,.txt,.md" onChange={onUpload} disabled={uploading} />
        {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
      </Panel>
      <div className="mt-4">
        <Panel title="Matter documents">
          {docs.length === 0 ? (
            <p className="text-sm text-ink/70">No documents uploaded.</p>
          ) : (
            <ul className="space-y-3">
              {docs.map((doc) => (
                <li key={doc.id} className="rounded border border-line px-3 py-3 text-sm">
                  <div className="font-semibold">{doc.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge>{doc.processingState}</Badge>
                    <Badge>{doc.malwareScanStatus}</Badge>
                  </div>
                  {doc.processingError ? (
                    <p className="mt-2 text-[var(--ng-danger)]">{doc.processingError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </MatterShell>
  );
}
