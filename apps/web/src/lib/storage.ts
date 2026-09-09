import { createStorageProviderFromEnv } from "@nyayagrid/documents/storage";

const globalForStorage = globalThis as unknown as {
  __ngStorage?: ReturnType<typeof createStorageProviderFromEnv>;
};

/** Isolated from `@/lib/infra` so readiness does not load pdfjs / DOMMatrix. */
export function getStorage() {
  if (!globalForStorage.__ngStorage) {
    globalForStorage.__ngStorage = createStorageProviderFromEnv();
  }
  return globalForStorage.__ngStorage;
}
