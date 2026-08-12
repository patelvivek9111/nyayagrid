import { and, desc, eq, type Database, documents, documentVersions } from "@nyayagrid/database";
import type { StorageProvider } from "./storage";

const DEFAULT_EXPIRES_SECONDS = 300;
const MAX_EXPIRES_SECONDS = 3600;

/**
 * Content types that must never be served with an `inline` disposition: a browser rendering
 * these inline from a signed URL on our own storage domain amounts to us hosting arbitrary
 * attacker-controlled HTML/script for anyone who leaks the (short-lived) link.
 */
const DANGEROUS_INLINE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
]);
const DANGEROUS_INLINE_EXTENSIONS = [".html", ".htm", ".xhtml", ".svg", ".xml"];

function asciiFallbackFilename(filename: string): string {
  const stripped = filename
    .replace(/[\r\n]/g, " ")
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .trim();
  return stripped || "document";
}

/**
 * Builds a safe `Content-Disposition` header value: an ASCII-safe `filename` fallback plus an
 * RFC 5987 `filename*` for full Unicode support, so no unsanitized filename ever reaches a raw
 * header value (which could otherwise enable header injection or path tricks).
 */
export function safeContentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const fallback = asciiFallbackFilename(filename);
  const encoded = encodeURIComponent(filename.trim() || "document");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Chooses the download disposition, forcing `attachment` for content types/extensions that are
 * dangerous to render inline (HTML, SVG, XML) regardless of what the caller preferred.
 */
export function resolveContentDisposition(
  contentType: string,
  filename: string,
  preferred: "attachment" | "inline" = "attachment",
): string {
  const normalizedType = (contentType.split(";")[0] ?? contentType).trim().toLowerCase();
  const lowerName = filename.toLowerCase();
  const isDangerous =
    DANGEROUS_INLINE_CONTENT_TYPES.has(normalizedType) ||
    DANGEROUS_INLINE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  return safeContentDisposition(filename, isDangerous ? "attachment" : preferred);
}

export type SignDocumentDownloadParams = {
  storage: StorageProvider;
  storageKey: string;
  filename: string;
  contentType: string;
  expiresInSeconds?: number;
  disposition?: "attachment" | "inline";
};

export type SignedDocumentDownload = {
  url: string;
  contentDisposition: string;
  expiresInSeconds: number;
  expiresAt: string;
};

function clampExpiresInSeconds(requested?: number): number {
  return Math.min(Math.max(1, requested ?? DEFAULT_EXPIRES_SECONDS), MAX_EXPIRES_SECONDS);
}

/** Pure signing helper: no authorization or database access. Callers must authorize first. */
export async function signDocumentDownload(
  params: SignDocumentDownloadParams,
): Promise<SignedDocumentDownload> {
  const expiresInSeconds = clampExpiresInSeconds(params.expiresInSeconds);
  const contentDisposition = resolveContentDisposition(
    params.contentType,
    params.filename,
    params.disposition,
  );
  const url = await params.storage.getSignedDownloadUrl({
    key: params.storageKey,
    expiresInSeconds,
    contentDisposition,
  });
  return {
    url,
    contentDisposition,
    expiresInSeconds,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
}

export class DocumentDownloadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentDownloadError";
    this.code = code;
  }
}

export type DocumentDownloadAuthContext = {
  userId: string;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId?: string;
};

/**
 * Injected authorization check (e.g. `requireMatterAccess` from @nyayagrid/permissions). Kept as
 * a callback rather than a direct import so this package never depends on @nyayagrid/permissions
 * — permissions' own test suite depends on @nyayagrid/documents, and a direct dependency the
 * other way would create a package cycle. Should throw/reject to deny access.
 */
export type DocumentDownloadAuthCheck = (ctx: DocumentDownloadAuthContext) => Promise<void> | void;

/** Processing states from which a document must never be downloadable. */
const BLOCKED_DOWNLOAD_STATES = new Set(["scan_blocked", "quarantined", "malware_scan_failed"]);

export type AuthorizeAndSignDocumentDownloadParams = {
  db: Database;
  storage: StorageProvider;
  userId: string;
  organizationId: string;
  matterId: string;
  documentId: string;
  /** Defaults to the latest version when omitted. */
  documentVersionId?: string;
  authCheck: DocumentDownloadAuthCheck;
  expiresInSeconds?: number;
  disposition?: "attachment" | "inline";
};

export type AuthorizedDocumentDownload = SignedDocumentDownload & {
  documentId: string;
  documentVersionId: string;
  filename: string;
};

/**
 * Authorizes (via the injected `authCheck`) and then signs a short-lived download URL for a
 * document version, scoped to the given organization/matter and refusing to sign documents that
 * are quarantined, malware-blocked, or otherwise unsafe to serve.
 */
export async function authorizeAndSignDocumentDownload(
  params: AuthorizeAndSignDocumentDownloadParams,
): Promise<AuthorizedDocumentDownload> {
  await params.authCheck({
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
    documentVersionId: params.documentVersionId,
  });

  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) {
    throw new DocumentDownloadError("NOT_FOUND", "Document not found in scope");
  }
  if (BLOCKED_DOWNLOAD_STATES.has(doc.processingState)) {
    throw new DocumentDownloadError(
      "DOWNLOAD_BLOCKED",
      `Document cannot be downloaded while in state "${doc.processingState}"`,
    );
  }

  const versionRows = await params.db
    .select()
    .from(documentVersions)
    .where(
      params.documentVersionId
        ? and(
            eq(documentVersions.id, params.documentVersionId),
            eq(documentVersions.documentId, params.documentId),
            eq(documentVersions.organizationId, params.organizationId),
          )
        : and(
            eq(documentVersions.documentId, params.documentId),
            eq(documentVersions.organizationId, params.organizationId),
          ),
    )
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);
  const version = versionRows[0];
  if (!version) {
    throw new DocumentDownloadError("NOT_FOUND", "Document version not found");
  }

  const signed = await signDocumentDownload({
    storage: params.storage,
    storageKey: version.storageKey,
    filename: version.originalFilename,
    contentType: version.contentType,
    expiresInSeconds: params.expiresInSeconds,
    disposition: params.disposition,
  });

  return {
    ...signed,
    documentId: doc.id,
    documentVersionId: version.id,
    filename: version.originalFilename,
  };
}
