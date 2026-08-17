"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicShell } from "@/components/shell";
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

  useEffect(() => {
    fetch("/api/v1/guide/documents")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load files");
        setDocuments(data.documents ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="My Files"
        description="Documents you uploaded to Nyaya Guide. They are private to this account and are not a Case file."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <Panel title="Uploaded documents">
        {documents.length === 0 ? (
          <p className="text-sm text-ink/70">
            No files yet.{" "}
            <Link className="font-semibold text-accent underline" href="/guide/explain">
              Explain a document
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex items-center justify-between rounded border border-line px-3 py-2"
              >
                <Link
                  className="font-semibold text-accent underline"
                  href={`/guide/explain?documentId=${document.id}`}
                >
                  {document.title}
                </Link>
                <Badge>{document.documentKind ?? "other"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PublicShell>
  );
}
