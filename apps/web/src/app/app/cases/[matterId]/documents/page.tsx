"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Button, cx } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  IntelligenceDialog,
  IntelligenceHeader,
  LoadingState,
  OverflowMenu,
  SuggestedBadge,
} from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { openMatterDocument } from "@/lib/document-open";
import {
  documentListCountLabel,
  normalizeDocumentSearchQuery,
  parseDocumentListSort,
  parseDocumentListStatus,
  parseDocumentProcessingSummary,
  processingSummaryChip,
  type DocumentListSort,
  type DocumentListStatusFilter,
  type DocumentProcessingSummary,
} from "@/lib/document-list";
import {
  DOCUMENT_UPLOAD_BATCH_MAX,
  DOCUMENT_UPLOAD_CONCURRENCY,
  DOCUMENT_UPLOAD_MAX_BYTES,
  buildUploadItemsFromFiles,
  canCancelWaitingUpload,
  canRetryUpload,
  collectDroppedFiles,
  dragLooksLikeFiles,
  interpretUploadHttpResult,
  omittedSelectionNote,
  runWithConcurrency,
  summarizeUploadBatch,
  takeFileSelection,
  uploadPhaseLabel,
  type DocumentUploadItem,
} from "@/lib/document-upload-queue";

type Doc = {
  id: string;
  title: string;
  processingState: string;
  malwareScanStatus: string;
  processingError: string | null;
  latestVersionId: string | null;
  intelligenceStatus?: string | null;
  createdAt?: string;
};

const FAILED_STATES = new Set([
  "scan_blocked",
  "quarantined",
  "malware_scan_failed",
  "extraction_failed",
  "failed",
]);

const PROCESSING_STATES = new Set([
  "uploaded",
  "awaiting_malware_scan",
  "unscanned_development",
  "scan_clean",
  "extracting_text",
  "chunking",
  "embedding",
  "indexed",
  "requires_ocr",
]);

function processingLabel(doc: Doc): string {
  if (FAILED_STATES.has(doc.processingState)) {
    if (doc.processingState === "scan_blocked" || doc.processingState === "quarantined") {
      return "Blocked by malware scan";
    }
    if (doc.processingState === "malware_scan_failed") return "Scan failed — file not indexed";
    if (doc.processingState === "extraction_failed") return "Could not read text";
    return "Processing failed";
  }
  if (doc.processingState === "ready") {
    if (doc.intelligenceStatus === "queued" || doc.intelligenceStatus === "running") {
      return "Ready — extracting insights";
    }
    if (doc.intelligenceStatus === "failed") return "Ready — insight extraction failed";
    return "Ready";
  }
  if (doc.processingState === "uploaded") return "Received — waiting for processing";
  if (doc.processingState === "awaiting_malware_scan") return "Scanning";
  if (doc.processingState === "unscanned_development")
    return "Processing (scan skipped in development)";
  if (doc.processingState === "scan_clean") return "Scan complete — reading file";
  if (doc.processingState === "extracting_text") return "Reading text";
  if (doc.processingState === "requires_ocr") return "Needs OCR (not enabled)";
  if (doc.processingState === "chunking") return "Preparing for search";
  if (doc.processingState === "embedding") return "Indexing";
  if (doc.processingState === "indexed") return "Indexed — finishing";
  return "Processing";
}

function compactStatus(doc: Doc): "Ready" | "Processing" | "Needs attention" {
  if (FAILED_STATES.has(doc.processingState)) return "Needs attention";
  if (doc.processingState === "ready" && !isInFlight(doc)) return "Ready";
  return "Processing";
}

function fileKindLabel(title: string): string | null {
  const ext = title.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "DOCX";
  if (ext === "txt" || ext === "md") return "Text";
  return null;
}

function isInFlight(doc: Doc): boolean {
  if (FAILED_STATES.has(doc.processingState)) return false;
  if (doc.processingState === "ready") {
    return doc.intelligenceStatus === "queued" || doc.intelligenceStatus === "running";
  }
  return true;
}

async function fetchJson(input: string, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? userFacingLoadError("documents", res.status)
        : (json?.error?.message ?? userFacingLoadError("documents")),
    );
  }
  return json;
}

export default function MatterDocumentsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading documents…" />}>
      <MatterDocumentsPageInner />
    </Suspense>
  );
}

function MatterDocumentsPageInner() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { reviewPendingCount, canReview, canUpload, loading: chromeLoading } = useMatterChrome();
  const q = normalizeDocumentSearchQuery(searchParams.get("q"));
  const status = parseDocumentListStatus(searchParams.get("status"));
  const sort = parseDocumentListSort(searchParams.get("sort"));
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [processingSummary, setProcessingSummary] = useState<DocumentProcessingSummary | null>(
    null,
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<Array<DocumentUploadItem & { file: File }>>([]);
  const [uploadNote, setUploadNote] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listBusy, setListBusy] = useState(false);
  const [qInput, setQInput] = useState(q);
  const [docAId, setDocAId] = useState("");
  const [docBId, setDocBId] = useState("");
  const [compareBusy, setCompareBusy] = useState(false);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const uploadQueueRef = useRef<Array<DocumentUploadItem & { file: File }>>([]);
  const drainLockRef = useRef(false);
  const listRefreshTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);

  const readyDocs = docs.filter((d) => Boolean(d.latestVersionId));
  const hasActiveFind = Boolean(q) || Boolean(status);
  const hasFindControls = hasActiveFind || sort !== "newest" || Boolean(qInput);
  const countLabel = documentListCountLabel({
    loaded: docs.length,
    total,
    hasQuery: Boolean(q),
    hasStatus: Boolean(status),
  });
  const zeroDocuments =
    !loading && !hasActiveFind && (total === 0 || (total == null && docs.length === 0));
  const noMatches = !loading && hasActiveFind && total === 0;
  const uploadBatch = summarizeUploadBatch(uploadQueue);
  const maxUploadMb = Math.round(DOCUMENT_UPLOAD_MAX_BYTES / (1024 * 1024));
  const showProcessingSummary = Boolean(processingSummary && processingSummary.total > 0);
  const allDocumentsReady =
    Boolean(processingSummary) &&
    processingSummary!.total > 0 &&
    processingSummary!.ready === processingSummary!.total &&
    processingSummary!.processing === 0 &&
    processingSummary!.attention === 0;

  function listQuery(extra?: { cursor?: string | null }): string {
    const sp = new URLSearchParams();
    sp.set("limit", "50");
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (sort !== "newest") sp.set("sort", sort);
    if (extra?.cursor) sp.set("cursor", extra.cursor);
    return sp.toString();
  }

  function replaceFindParams(next: {
    q?: string;
    status?: DocumentListStatusFilter | null;
    sort?: DocumentListSort;
  }) {
    const sp = new URLSearchParams();
    const nextQ = next.q !== undefined ? normalizeDocumentSearchQuery(next.q) : q;
    const nextStatus = next.status !== undefined ? next.status : status;
    const nextSort = next.sort !== undefined ? next.sort : sort;
    if (nextQ) sp.set("q", nextQ);
    if (nextStatus) sp.set("status", nextStatus);
    if (nextSort !== "newest") sp.set("sort", nextSort);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function applyListPayload(data: { total?: unknown; processingSummary?: unknown }) {
    setTotal(typeof data.total === "number" ? data.total : null);
    setProcessingSummary(parseDocumentProcessingSummary(data.processingSummary));
  }

  async function fetchDocsPage(opts: { cursor?: string | null; append?: boolean }) {
    const data = await fetchJson(
      `/api/v1/matters/${matterId}/documents?${listQuery({ cursor: opts.cursor })}`,
    );
    const incoming = (data.documents ?? []) as Doc[];
    applyListPayload(data);
    const cursor = data.nextCursor ?? null;
    nextCursorRef.current = cursor;
    setNextCursor(cursor);
    setDocs((prev) => (opts.append ? [...prev, ...incoming] : incoming));
  }

  async function refreshDocs() {
    const data = await fetchJson(`/api/v1/matters/${matterId}/documents?${listQuery()}`);
    const incoming = (data.documents ?? []) as Doc[];
    applyListPayload(data);
    if (!nextCursorRef.current) {
      const cursor = data.nextCursor ?? null;
      nextCursorRef.current = cursor;
      setDocs(incoming);
      setNextCursor(cursor);
      return;
    }
    setDocs((prev) => {
      const byId = new Map(incoming.map((d) => [d.id, d]));
      return prev.map((d) => byId.get(d.id) ?? d);
    });
  }

  async function refreshComparisons() {
    const data = await fetchJson(`/api/v1/matters/${matterId}/analysis/comparisons`);
    setComparisons(data.comparisons ?? []);
  }

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    setDocs([]);
    setTotal(null);
    setProcessingSummary(null);
    nextCursorRef.current = null;
    setNextCursor(null);
    setLoading(true);
  }, [matterId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = normalizeDocumentSearchQuery(qInput);
      if (next === q) return;
      replaceFindParams({ q: next });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [qInput, q, pathname, router, status, sort]);

  useEffect(() => {
    let cancelled = false;
    setListBusy(true);
    Promise.all([fetchDocsPage({}), refreshComparisons()])
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : userFacingLoadError("documents"));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId, q, status, sort]);

  useEffect(() => {
    const stillProcessing = (processingSummary?.processing ?? 0) > 0 || docs.some(isInFlight);
    if (!stillProcessing) return;
    let requestOpen = false;
    const timer = window.setInterval(() => {
      if (requestOpen) return;
      requestOpen = true;
      void refreshDocs()
        .catch(() => undefined)
        .finally(() => {
          requestOpen = false;
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [matterId, docs, q, status, sort, processingSummary?.processing]);

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    enqueueIncomingFiles(picked);
  }

  function enqueueIncomingFiles(files: File[], extraNote?: string | null) {
    if (!canUpload) return;
    if (files.length === 0) {
      if (extraNote) setUploadNote(extraNote);
      return;
    }
    const { selected, omitted } = takeFileSelection(files, DOCUMENT_UPLOAD_BATCH_MAX);
    const added = buildUploadItemsFromFiles(selected, () => crypto.randomUUID());
    setUploadNote([extraNote, omittedSelectionNote(omitted)].filter(Boolean).join(" "));
    setMessage("");
    const next = [...uploadQueueRef.current, ...added];
    uploadQueueRef.current = next;
    setUploadQueue(next);
    void drainUploads();
  }

  function probesFromDataTransfer(dt: DataTransfer): Parameters<typeof collectDroppedFiles>[0] {
    if (dt.items && dt.items.length > 0) {
      return Array.from(dt.items).map((item) => {
        const entry =
          "webkitGetAsEntry" in item && typeof item.webkitGetAsEntry === "function"
            ? item.webkitGetAsEntry()
            : null;
        const isDirectory = Boolean(entry && "isDirectory" in entry && entry.isDirectory);
        return {
          kind: item.kind,
          isDirectory,
          file: item.kind === "file" && !isDirectory ? item.getAsFile() : null,
        };
      });
    }
    return Array.from(dt.files).map((file) => ({
      kind: "file" as const,
      isDirectory: false,
      file,
    }));
  }

  function onAddDocumentsDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!canUpload) return;
    dragDepthRef.current += 1;
    if (dragLooksLikeFiles(event.dataTransfer.types)) setDragActive(true);
  }

  function onAddDocumentsDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!canUpload) return;
    if (dragLooksLikeFiles(event.dataTransfer.types)) {
      event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    } else {
      event.dataTransfer.dropEffect = "none";
    }
  }

  function onAddDocumentsDragLeave(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function onAddDocumentsDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!canUpload) return;
    const collected = collectDroppedFiles(probesFromDataTransfer(event.dataTransfer));
    enqueueIncomingFiles(collected.files, collected.note);
  }

  function patchUploadItem(id: string, patch: Partial<DocumentUploadItem>) {
    const next = uploadQueueRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    uploadQueueRef.current = next;
    setUploadQueue(next);
  }

  function scheduleListRefresh() {
    if (listRefreshTimerRef.current) window.clearTimeout(listRefreshTimerRef.current);
    listRefreshTimerRef.current = window.setTimeout(() => {
      void refreshDocs().catch(() => undefined);
    }, 400);
  }

  async function postOneDocument(file: File) {
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/matters/${matterId}/documents`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      return interpretUploadHttpResult(res.status, data?.error?.message ?? null);
    } catch {
      return interpretUploadHttpResult(0);
    }
  }

  async function uploadQueueItem(id: string) {
    const current = uploadQueueRef.current.find((item) => item.id === id);
    if (!current || current.accepted) return;
    if (current.phase !== "waiting" && !(current.phase === "failed" && current.retryable)) return;
    patchUploadItem(id, { phase: "uploading", error: null });
    const result = await postOneDocument(current.file);
    patchUploadItem(id, {
      phase: result.phase,
      accepted: result.accepted,
      retryable: result.retryable,
      error: result.error,
    });
    if (result.accepted) scheduleListRefresh();
  }

  async function drainUploads() {
    if (drainLockRef.current) return;
    drainLockRef.current = true;
    setUploading(true);
    try {
      for (;;) {
        const waiting = uploadQueueRef.current.filter((item) => item.phase === "waiting");
        if (waiting.length === 0) break;
        await runWithConcurrency(
          DOCUMENT_UPLOAD_CONCURRENCY,
          waiting.map((item) => () => uploadQueueItem(item.id)),
        );
      }
    } finally {
      drainLockRef.current = false;
      setUploading(false);
      if (uploadQueueRef.current.some((item) => item.phase === "waiting")) {
        void drainUploads();
        return;
      }
      if (listRefreshTimerRef.current) window.clearTimeout(listRefreshTimerRef.current);
      void refreshDocs().catch(() => undefined);
    }
  }

  function retryUpload(id: string) {
    const current = uploadQueueRef.current.find((item) => item.id === id);
    if (!current || !canRetryUpload(current)) return;
    patchUploadItem(id, { phase: "waiting", error: null });
    void drainUploads();
  }

  function cancelWaitingUpload(id: string) {
    const current = uploadQueueRef.current.find((item) => item.id === id);
    if (!current || !canCancelWaitingUpload(current)) return;
    const next = uploadQueueRef.current.filter((item) => item.id !== id);
    uploadQueueRef.current = next;
    setUploadQueue(next);
  }

  async function selectComparison(comparisonId: string) {
    try {
      const json = await fetchJson(
        `/api/v1/matters/${matterId}/analysis/comparisons/${comparisonId}`,
      );
      setSelected(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comparison");
    }
  }

  async function runComparison() {
    const docA = docs.find((d) => d.id === docAId);
    const docB = docs.find((d) => d.id === docBId);
    if (!docA?.latestVersionId || !docB?.latestVersionId) {
      setError("Select two ready documents to compare");
      return;
    }
    setCompareBusy(true);
    setError("");
    try {
      const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/comparisons`, {
        method: "POST",
        body: JSON.stringify({
          documentAId: docA.id,
          versionAId: docA.latestVersionId,
          documentBId: docB.id,
          versionBId: docB.latestVersionId,
        }),
      });
      await refreshComparisons();
      await selectComparison(json.comparison.id);
      setMessage("Comparison saved. Changes below are proposals for attorney review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setCompareBusy(false);
    }
  }

  async function openDoc(doc: Doc, disposition: "inline" | "attachment") {
    setOpeningId(doc.id);
    setError("");
    try {
      await openMatterDocument({
        matterId,
        documentId: doc.id,
        disposition,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the original file");
    } finally {
      setOpeningId(null);
    }
  }

  async function loadMore() {
    if (!nextCursorRef.current) return;
    setListBusy(true);
    setError("");
    try {
      await fetchDocsPage({ cursor: nextCursorRef.current, append: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingLoadError("documents"));
    } finally {
      setListBusy(false);
    }
  }

  function clearFind() {
    setQInput("");
    router.replace(pathname, { scroll: false });
  }

  return (
    <div
      className="space-y-4"
      onDragEnter={canUpload ? onAddDocumentsDragEnter : undefined}
      onDragOver={canUpload ? onAddDocumentsDragOver : undefined}
      onDragLeave={canUpload ? onAddDocumentsDragLeave : undefined}
      onDrop={canUpload ? onAddDocumentsDrop : undefined}
    >
      <IntelligenceHeader
        title="Documents"
        description="Case file room — upload, track processing, and open the stored original. Compare versions for material changes. Opening a file does not replace the original. Ready means the file finished the processing pipeline — not that the Case is legally complete."
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpload && !zeroDocuments ? (
              <Button type="button" variant="secondary" onClick={() => setUploadOpen(true)}>
                + Upload documents
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setCompareOpen(true)}>
              Compare documents
            </Button>
          </div>
        }
      />
      {showProcessingSummary && processingSummary ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink/55">
            {allDocumentsReady
              ? `All ${processingSummary.total} documents ready`
              : "Case processing"}
            {q ? " — all documents in this Case, not limited to this search." : "."}
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Case document processing"
          >
            {(["ready", "processing", "attention"] as const).map((key) => {
              const chip = processingSummaryChip(key, processingSummary[key]);
              const selected = status === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={cx(
                    "rounded-md border px-2.5 py-1 text-xs font-semibold",
                    selected ? "border-accent bg-accent-soft/50" : "border-line bg-white",
                  )}
                  aria-pressed={selected}
                  aria-label={`${chip.ariaLabel}${selected ? ", filter on" : ""}`}
                  onClick={() => replaceFindParams({ status: selected ? null : key })}
                >
                  {chip.text}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {reviewPendingCount > 0 ? (
        <p className="text-sm text-ink/70">
          {reviewPendingCount} extracted item{reviewPendingCount === 1 ? " is" : "s are"} waiting
          for Review. They are not confirmed by being extracted.{" "}
          <Link
            href={`/app/cases/${matterId}/review`}
            className="font-semibold text-accent underline"
          >
            Open Review
          </Link>
          {!canReview ? " (view only)" : ""}
        </p>
      ) : null}

      {zeroDocuments || uploadOpen || dragActive || uploadQueue.length > 0 ? (
        <div>
          <Panel
            title={canUpload && dragActive ? "Drop files to add to this Case" : "Add documents"}
            className={cx(canUpload && dragActive && "ring-2 ring-accent ring-offset-2")}
          >
            <p className="mb-3 text-sm text-ink/70">
              Supported: PDF (native text), DOCX, TXT. OCR is not enabled. Files are received
              individually. Nyaya continues scanning and indexing them in the background — received
              does not mean ready. You can leave this page. Maximum {maxUploadMb} MB per file; up to{" "}
              {DOCUMENT_UPLOAD_BATCH_MAX} files per selection.
            </p>
            {chromeLoading ? (
              <p className="text-sm text-ink/60">Checking upload permission…</p>
            ) : canUpload ? (
              <label className="block text-sm font-semibold text-ink">
                Add documents
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md"
                  onChange={onUpload}
                  className="mt-1 block w-full text-sm font-normal"
                />
                <span className="mt-1 hidden text-xs font-normal text-ink/55 sm:block">
                  {dragActive ? "Drop files to add to this Case" : "Or drop files onto this area"}
                </span>
              </label>
            ) : (
              <p className="text-sm text-ink/60">
                You do not have permission to add documents to this Case.
              </p>
            )}
            {uploadQueue.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-ink/70" aria-live="polite">
                  {uploadQueue.length === 1
                    ? "1 file selected"
                    : `${uploadQueue.length} files selected`}
                  {uploadBatch.uploading > 0 ? ` · ${uploadBatch.uploading} uploading` : ""}
                </p>
                <ul className="max-h-64 space-y-2 overflow-auto">
                  {uploadQueue.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={item.filename}>
                          {item.filename}
                        </p>
                        <p className="text-xs text-ink/60">
                          {uploadPhaseLabel(item.phase)}
                          {item.error ? ` — ${item.error}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canCancelWaitingUpload(item) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`Remove ${item.filename} from the upload queue`}
                            onClick={() => cancelWaitingUpload(item.id)}
                          >
                            Remove
                          </Button>
                        ) : null}
                        {canRetryUpload(item) ? (
                          <Button
                            type="button"
                            variant="secondary"
                            aria-label={`Retry upload of ${item.filename}`}
                            onClick={() => retryUpload(item.id)}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {uploadNote ? <p className="mt-3 text-sm text-ink/70">{uploadNote}</p> : null}
            {uploadBatch.summary ? (
              <p className="mt-3 text-sm text-accent" aria-live="polite">
                {uploadBatch.summary}
                {hasActiveFind ? " Current search and filters were kept." : ""}
              </p>
            ) : null}
            {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
            {error ? <ErrorState message={error} /> : null}
          </Panel>
        </div>
      ) : null}

      {loading && docs.length === 0 ? <LoadingState label="Loading documents…" /> : null}

      <Panel title="Matter documents">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <label className="block min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
              Search by document name
              <input
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search by document name"
                autoComplete="off"
                className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
              Processing
              <select
                className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-ink lg:w-48"
                value={status ?? ""}
                onChange={(e) =>
                  replaceFindParams({
                    status: parseDocumentListStatus(e.target.value || null),
                  })
                }
              >
                <option value="">All</option>
                <option value="ready">Ready</option>
                <option value="processing">Processing</option>
                <option value="attention">Needs attention</option>
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
              Sort
              <select
                className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-ink lg:w-44"
                value={sort}
                onChange={(e) => replaceFindParams({ sort: parseDocumentListSort(e.target.value) })}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name_asc">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
              </select>
            </label>
            {hasFindControls ? (
              <Button type="button" variant="secondary" onClick={clearFind}>
                Clear search
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-ink/60" aria-live="polite">
            {listBusy ? "Updating list…" : countLabel}
          </p>
        </div>

        {zeroDocuments ? (
          <EmptyState
            title="No documents uploaded"
            description="Upload a PDF, DOCX, or text file so Nyaya can read this Case. Processing continues in the background."
          />
        ) : noMatches ? (
          <EmptyState
            title={q ? `No documents match '${q}'.` : "No documents match the current filters."}
            description="Try a different name, or clear search to see all documents in this Case."
            action={
              <Button type="button" variant="secondary" onClick={clearFind}>
                Clear search
              </Button>
            }
          />
        ) : (
          <>
            <ul
              className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white"
              aria-busy={listBusy}
            >
              {docs.map((doc) => {
                const kind = fileKindLabel(doc.title);
                const uploaded = doc.createdAt
                  ? new Date(doc.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : null;
                const canOpen =
                  Boolean(doc.latestVersionId) &&
                  doc.processingState !== "scan_blocked" &&
                  doc.processingState !== "quarantined" &&
                  doc.processingState !== "malware_scan_failed";
                return (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{doc.title}</p>
                      <p className="mt-0.5 text-xs text-ink/55" title={processingLabel(doc)}>
                        {[kind, compactStatus(doc), uploaded ? `Uploaded ${uploaded}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {doc.processingError ? (
                        <p className="mt-1 text-xs text-[var(--ng-danger)]">
                          {doc.processingError}
                        </p>
                      ) : null}
                      {!canOpen ? (
                        <p className="mt-1 text-xs text-ink/55">
                          Original file is unavailable until processing finishes or the scan is
                          clear.
                        </p>
                      ) : null}
                    </div>
                    {canOpen ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={openingId === doc.id}
                          onClick={() => void openDoc(doc, "inline")}
                        >
                          {openingId === doc.id ? "Opening…" : "Open original"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={openingId === doc.id}
                          onClick={() => void openDoc(doc, "attachment")}
                        >
                          Download
                        </Button>
                        <OverflowMenu label="⋯">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setDocAId(doc.id);
                              setCompareOpen(true);
                            }}
                          >
                            Compare
                          </Button>
                        </OverflowMenu>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {nextCursor ? (
              <div className="mt-4">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={listBusy}
                  onClick={() => void loadMore()}
                >
                  {listBusy ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <p className="text-xs text-ink/55">
        After a file is ready, Nyaya may suggest timeline events, people, facts, and deadlines.
        Those stay suggested until someone reviews them — they are not confirmed by being extracted.
      </p>

      <section className="rounded-xl border border-line bg-white/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg text-ink">Compare versions</h2>
            <p className="mt-1 text-sm text-ink/70">
              Pick two ready documents (or versions) to surface material differences. Diffs are
              deterministic; any AI summary is a proposal — not auto-approved.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setCompareOpen(true)}>
            Compare documents
          </Button>
        </div>
      </section>

      <IntelligenceDialog
        open={compareOpen}
        title="Compare versions"
        description="Diffs are deterministic; any AI summary is a proposal — not auto-approved."
        onClose={() => setCompareOpen(false)}
        wide
      >
        {readyDocs.length < 2 ? (
          <p className="text-sm text-ink/60">
            Upload at least two processed documents to run a comparison.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
                Document A
                <select
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm"
                  value={docAId}
                  onChange={(e) => setDocAId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {readyDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
                Document B
                <select
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm"
                  value={docBId}
                  onChange={(e) => setDocBId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {readyDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                disabled={compareBusy || !docAId || !docBId || docAId === docBId}
                onClick={runComparison}
              >
                {compareBusy ? "Comparing…" : "Compare"}
              </Button>
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Past comparisons
                </p>
                {comparisons.length === 0 ? (
                  <p className="text-sm text-ink/55">None yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {comparisons.map((c) => (
                      <li key={c.comparison.id}>
                        <button
                          type="button"
                          className={`w-full rounded border px-2 py-1.5 text-left ${
                            selected?.comparison.id === c.comparison.id
                              ? "border-accent bg-accent-soft/50"
                              : "border-line bg-white"
                          }`}
                          onClick={() => selectComparison(c.comparison.id)}
                        >
                          {c.comparison.summary?.slice(0, 60) ?? "Comparison"} · {c.changes.length}{" "}
                          change(s)
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Changes</p>
                {selected ? <SuggestedBadge>Proposal</SuggestedBadge> : null}
                {selected?.summaryScore?.alignment ? (
                  <Badge>
                    Summary {selected.summaryScore.alignment}
                    {typeof selected.summaryScore.score === "number"
                      ? ` · ${Math.round(selected.summaryScore.score * 100)}%`
                      : ""}
                  </Badge>
                ) : null}
              </div>
              {!selected ? (
                <p className="text-sm text-ink/70">Select or run a comparison to view changes.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-ink/55">
                    Diffs are deterministic. Any AI summary is a proposal — verify claims against
                    the change list
                    {selected.summaryScore?.alignment &&
                    selected.summaryScore.alignment !== "aligned"
                      ? " (summary not fully aligned with the diff)"
                      : ""}
                    .
                  </p>
                  {selected.comparison.summary ? (
                    <p className="whitespace-pre-wrap text-sm text-ink/80">
                      {selected.comparison.summary}
                    </p>
                  ) : (
                    <p className="text-sm text-ink/60">
                      No AI summary — reviewing deterministic diffs.
                    </p>
                  )}
                  {selected.summaryScore?.unsupportedClaims?.length ? (
                    <div className="rounded border border-amber-700/25 bg-amber-50/70 px-3 py-2 text-xs text-ink/75">
                      <p className="font-semibold">Flagged summary claims (not in diff digest)</p>
                      <ul className="mt-1 list-inside list-disc">
                        {selected.summaryScore.unsupportedClaims.map((claim: string) => (
                          <li key={claim}>{claim}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(selected.changes ?? []).length === 0 ? (
                    <p className="text-sm text-ink/70">
                      No substantive paragraph differences detected.
                    </p>
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {selected.changes.map((c: any) => (
                        <li key={c.id} className="rounded border border-line p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Badge>{c.changeType}</Badge>
                            <Badge>{c.attention}</Badge>
                          </div>
                          {c.oldText ? (
                            <p className="mt-2 text-xs">
                              <span className="font-semibold text-ink/60">Old: </span>
                              {c.oldText}
                            </p>
                          ) : null}
                          {c.newText ? (
                            <p className="mt-1 text-xs">
                              <span className="font-semibold text-ink/60">New: </span>
                              {c.newText}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-ink/50">
          Full analysis tools remain on{" "}
          <Link href={`/app/cases/${matterId}/analysis`} className="text-accent underline">
            Analysis
          </Link>
          .
        </p>
      </IntelligenceDialog>
    </div>
  );
}
