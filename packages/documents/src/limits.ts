import { MAX_UPLOAD_BYTES } from "@nyayagrid/validation";

export { MAX_UPLOAD_BYTES };

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/** Hard ceiling on characters kept from a single document's extracted text. */
export const MAX_EXTRACTED_CHARS = envInt("MAX_EXTRACTED_CHARS", 2_000_000);
/** Hard ceiling on pages processed from a single document. */
export const MAX_PAGES = envInt("MAX_PAGES", 2000);

export const DEFAULT_SCAN_TIMEOUT_MS = envInt("MALWARE_SCAN_TIMEOUT_MS", 30_000);
export const DEFAULT_EXTRACTION_TIMEOUT_MS = envInt("EXTRACTION_TIMEOUT_MS", 60_000);
export const DEFAULT_OCR_TIMEOUT_MS = envInt("OCR_TIMEOUT_MS", 60_000);

export class UploadLimitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UploadLimitError";
    this.code = code;
  }
}

export function assertUploadSizeAllowed(byteSize: number): void {
  if (byteSize <= 0) {
    throw new UploadLimitError("EMPTY_FILE", "File is empty");
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new UploadLimitError(
      "FILE_TOO_LARGE",
      `File exceeds the maximum upload size of ${MAX_UPLOAD_BYTES} bytes`,
    );
  }
}

const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
]);

const ARCHIVE_EXTENSIONS = [".zip", ".7z", ".rar", ".tar", ".gz", ".tgz"];

// Local zip file signature ("PK\x03\x04"), empty archive ("PK\x05\x06"), and spanned archive
// ("PK\x07\x08") magic numbers — catches a mislabeled/renamed zip even when the declared
// content-type and extension both claim otherwise.
const ZIP_MAGIC_NUMBERS = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

function looksLikeZipArchive(buffer: Buffer): boolean {
  return ZIP_MAGIC_NUMBERS.some(
    (magic) => buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic),
  );
}

/**
 * Phase 9 does not support archive uploads at all (no zip-bomb / nested-archive handling yet).
 * Rejects by declared MIME type, filename extension, and zip magic bytes so a relabeled archive
 * cannot slip through. Pass `allowArchives: true` only once archive extraction is implemented.
 */
export function rejectZipBombsOrArchives(params: {
  contentType: string;
  filename: string;
  buffer?: Buffer;
  allowArchives?: boolean;
}): void {
  if (params.allowArchives) return;
  const lowerName = params.filename.toLowerCase();
  const isArchiveExtension = ARCHIVE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const isArchiveMime = ARCHIVE_MIME_TYPES.has(params.contentType.toLowerCase());
  const isArchiveMagic = params.buffer ? looksLikeZipArchive(params.buffer) : false;
  if (isArchiveExtension || isArchiveMime || isArchiveMagic) {
    throw new UploadLimitError(
      "ARCHIVE_NOT_ALLOWED",
      "Archive and compressed files are not permitted in Phase 9",
    );
  }
}

export function truncateExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

export function assertPageCountAllowed(pageCount: number): void {
  if (pageCount > MAX_PAGES) {
    throw new UploadLimitError(
      "TOO_MANY_PAGES",
      `Document has ${pageCount} pages, exceeding the maximum of ${MAX_PAGES}`,
    );
  }
}

export class OperationTimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

/** Races `promise` against a timeout, rejecting with OperationTimeoutError if it fires first. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OperationTimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
