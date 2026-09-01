import type { DocumentProcessingState } from "@nyayagrid/validation";

const ALLOWED_TRANSITIONS: Record<DocumentProcessingState, DocumentProcessingState[]> = {
  uploaded: ["awaiting_malware_scan", "quarantined", "failed"],
  quarantined: ["awaiting_malware_scan", "failed"],
  awaiting_malware_scan: [
    "scan_clean",
    "scan_blocked",
    "malware_scan_failed",
    "unscanned_development",
    "failed",
  ],
  malware_scan_failed: ["awaiting_malware_scan", "failed"],
  unscanned_development: ["extracting_text", "failed"],
  scan_clean: ["extracting_text", "failed"],
  scan_blocked: ["failed"],
  extracting_text: ["requires_ocr", "chunking", "extraction_failed", "failed"],
  requires_ocr: ["extracting_text", "failed"],
  extraction_failed: ["extracting_text", "requires_ocr", "failed"],
  chunking: ["embedding", "extracting_text", "failed"],
  embedding: ["indexed", "extracting_text", "failed"],
  indexed: ["ready", "failed"],
  ready: [],
  failed: ["awaiting_malware_scan", "extracting_text"],
};

export function canTransitionDocumentState(
  from: DocumentProcessingState,
  to: DocumentProcessingState,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionDocumentState(
  from: DocumentProcessingState,
  to: DocumentProcessingState,
): DocumentProcessingState {
  if (!canTransitionDocumentState(from, to)) {
    throw new Error(`Invalid document processing transition: ${from} -> ${to}`);
  }
  return to;
}
