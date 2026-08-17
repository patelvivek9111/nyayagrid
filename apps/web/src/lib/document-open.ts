export type DocumentDownloadDisposition = "attachment" | "inline";

export class DocumentOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentOpenError";
  }
}

/**
 * Signs a short-lived download URL for a matter document and opens it.
 * Originals stay in object storage; this never mutates the stored file.
 */
export async function openMatterDocument(params: {
  matterId: string;
  documentId: string;
  disposition?: DocumentDownloadDisposition;
  documentVersionId?: string;
}): Promise<void> {
  const qs = new URLSearchParams();
  qs.set("disposition", params.disposition ?? "inline");
  if (params.documentVersionId) qs.set("versionId", params.documentVersionId);
  const res = await fetch(
    `/api/v1/matters/${params.matterId}/documents/${params.documentId}/download?${qs.toString()}`,
  );
  const json = (await res.json().catch(() => ({}))) as {
    download?: { url?: string; filename?: string };
    error?: { message?: string };
  };
  if (!res.ok || !json.download?.url) {
    throw new DocumentOpenError(json.error?.message ?? "Document download is unavailable");
  }

  if (params.disposition === "attachment") {
    const link = document.createElement("a");
    link.href = json.download.url;
    link.rel = "noopener noreferrer";
    link.download = json.download.filename ?? "document";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  window.open(json.download.url, "_blank", "noopener,noreferrer");
}
