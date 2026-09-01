/**
 * Case Documents multi-file upload queue.
 * One existing POST per file. Not a bulk ingest API. Not content/vector search.
 */

import { MAX_UPLOAD_BYTES } from "@nyayagrid/validation";

/** UX cap per file-picker selection — not a storage/backend content limit. */
export const DOCUMENT_UPLOAD_BATCH_MAX = 50;

/** Simultaneous HTTP uploads. Inngest ingest concurrency is unchanged. */
export const DOCUMENT_UPLOAD_CONCURRENCY = 4;

export const DOCUMENT_UPLOAD_MAX_BYTES = MAX_UPLOAD_BYTES;

export type DocumentUploadPhase = "waiting" | "uploading" | "received" | "failed";

export type DocumentUploadItem = {
  id: string;
  filename: string;
  phase: DocumentUploadPhase;
  error: string | null;
  retryable: boolean;
  accepted: boolean;
};

export type UploadHttpInterpretation = {
  phase: "received" | "failed";
  accepted: boolean;
  retryable: boolean;
  error: string | null;
};

export function takeFileSelection<T>(files: T[], max = DOCUMENT_UPLOAD_BATCH_MAX): {
  selected: T[];
  omitted: number;
} {
  if (files.length <= max) return { selected: files, omitted: 0 };
  return { selected: files.slice(0, max), omitted: files.length - max };
}

export function canCancelWaitingUpload(item: Pick<DocumentUploadItem, "phase" | "accepted">): boolean {
  return item.phase === "waiting" && !item.accepted;
}

export function canRetryUpload(item: Pick<DocumentUploadItem, "phase" | "retryable" | "accepted">): boolean {
  return item.phase === "failed" && item.retryable && !item.accepted;
}

export function interpretUploadHttpResult(
  status: number,
  serverMessage?: string | null,
): UploadHttpInterpretation {
  if (status === 202) {
    return { phase: "received", accepted: true, retryable: false, error: null };
  }
  if (status === 429) {
    return {
      phase: "failed",
      accepted: false,
      retryable: true,
      error: "Upload temporarily limited. Retry this file.",
    };
  }
  if (status === 503) {
    return {
      phase: "failed",
      accepted: false,
      retryable: false,
      error:
        serverMessage?.trim() ||
        "File was stored but processing could not be started. It is not marked received.",
    };
  }
  return {
    phase: "failed",
    accepted: false,
    retryable: true,
    error: serverMessage?.trim() || (status === 0 ? "Network error. Retry this file." : "Upload failed"),
  };
}

export function clientRejectReason(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "File is empty.";
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    return `File exceeds the ${Math.round(DOCUMENT_UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit.`;
  }
  return null;
}

export const FOLDER_UPLOAD_UNSUPPORTED =
  "Folder upload is not supported. Drop individual files instead.";

export const NON_FILE_DROP_IGNORED = "Only files can be added. Text and links are not uploaded.";

export type DropItemProbe = {
  kind: string;
  isDirectory?: boolean;
  file?: File | null;
};

/** Top-level files only. Directories are skipped, never walked. */
export function collectDroppedFiles(probes: DropItemProbe[]): {
  files: File[];
  hasDirectory: boolean;
  hasNonFile: boolean;
  note: string | null;
} {
  const files: File[] = [];
  let hasDirectory = false;
  let hasNonFile = false;
  for (const probe of probes) {
    if (probe.kind !== "file") {
      hasNonFile = true;
      continue;
    }
    if (probe.isDirectory) {
      hasDirectory = true;
      continue;
    }
    if (probe.file) files.push(probe.file);
  }
  let note: string | null = null;
  if (hasDirectory) note = FOLDER_UPLOAD_UNSUPPORTED;
  else if (hasNonFile && files.length === 0) note = NON_FILE_DROP_IGNORED;
  return { files, hasDirectory, hasNonFile, note };
}

export function dragLooksLikeFiles(types: ArrayLike<string> | undefined): boolean {
  return Array.from(types ?? []).includes("Files");
}

export function buildUploadItemsFromFiles(
  files: File[],
  createId: () => string,
): Array<DocumentUploadItem & { file: File }> {
  return files.map((file) => {
    const local = clientRejectReason(file);
    return {
      id: createId(),
      file,
      filename: file.name,
      phase: local ? "failed" : "waiting",
      error: local,
      retryable: false,
      accepted: false,
    };
  });
}

export function omittedSelectionNote(omitted: number, max = DOCUMENT_UPLOAD_BATCH_MAX): string | null {
  if (omitted <= 0) return null;
  return `Only the first ${max} files from this selection were added.`;
}

export function uploadPhaseLabel(phase: DocumentUploadPhase): string {
  if (phase === "waiting") return "Waiting";
  if (phase === "uploading") return "Uploading";
  if (phase === "received") return "Received";
  return "Failed";
}

export function summarizeUploadBatch(items: Pick<DocumentUploadItem, "phase">[]): {
  received: number;
  failed: number;
  waiting: number;
  uploading: number;
  done: boolean;
  summary: string | null;
} {
  const received = items.filter((i) => i.phase === "received").length;
  const failed = items.filter((i) => i.phase === "failed").length;
  const waiting = items.filter((i) => i.phase === "waiting").length;
  const uploading = items.filter((i) => i.phase === "uploading").length;
  const done = items.length > 0 && waiting === 0 && uploading === 0;
  let summary: string | null = null;
  if (done) {
    if (failed === 0) {
      summary =
        received === 1
          ? "1 file received. Processing continues in the background."
          : `${received} files received. Processing continues in the background.`;
    } else if (received === 0) {
      summary = failed === 1 ? "1 file failed to upload." : `${failed} files failed to upload.`;
    } else {
      summary = `${received} file${received === 1 ? "" : "s"} received · ${failed} failed`;
    }
  }
  return { received, failed, waiting, uploading, done, summary };
}

/**
 * Run async tasks with a hard cap on simultaneous work.
 * Returns the observed peak in-flight count (for tests).
 */
export async function runWithConcurrency(
  concurrency: number,
  tasks: Array<() => Promise<void>>,
): Promise<{ peakInFlight: number }> {
  const limit = Math.max(1, Math.floor(concurrency));
  let index = 0;
  let inFlight = 0;
  let peakInFlight = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      const task = tasks[current];
      if (!task) return;
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        await task();
      } finally {
        inFlight -= 1;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return { peakInFlight };
}
