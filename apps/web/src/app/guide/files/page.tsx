"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { humanizeKey } from "@/lib/plain-labels";
import { Badge, PageHeader, Panel } from "@nyayagrid/ui";

type DocumentRow = {
  id: string;
  title: string;
  documentKind: string | null;
  processingState: string;
  createdAt: string;
};

export default function GuideFilesPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/v1/guide/documents")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load files");
        setDocuments(data.documents ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="My Files"
        description="Documents you uploaded to Nyaya Guide. They are private to this account and are not a Case file."
      />
      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}
      {loading ? <LoadingState label="Loading your files…" /> : null}
      {!loading ? (
      <Panel title="Uploaded documents">
        {documents.length === 0 ? (
          <EmptyState
            title="No files yet"
            description="Upload or paste a document on Explain a Document to keep it here."
            action={
              <Link className="text-sm font-semibold text-accent underline" href="/guide/explain">
                Explain a document
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-3 py-2"
              >
                <Link
                  className="font-semibold text-accent underline"
                  href={`/guide/explain?documentId=${document.id}`}
                >
                  {document.title}
                </Link>
                <div className="flex flex-wrap gap-2">
                  <Badge>{humanizeKey(document.documentKind ?? "other")}</Badge>
                  <Badge>{humanizeKey(document.processingState)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      ) : null}
    </>
  );
}
