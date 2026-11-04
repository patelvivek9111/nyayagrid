# OCR production gate (WP-04)

## Implemented adapters

| `OCR_PROVIDER`   | Adapter                  | Requirement                                                          |
| ---------------- | ------------------------ | -------------------------------------------------------------------- |
| `none` (default) | `UnsupportedOcrProvider` | Image-only PDFs stay at `requires_ocr` — no fabricated text          |
| `http`           | `HttpOcrProvider`        | Requires `OCR_ENDPOINT` (+ optional `OCR_API_KEY`, `OCR_TIMEOUT_MS`) |
| `tesseract`      | `TesseractOcrProvider`   | Optional `tesseract.js` dependency; returns unsupported if missing   |

`FEATURE_OCR` alone does not extract text — ingest also requires a configured provider (`ocr-resolve.ts`).

## Pipeline behavior

- Native PDF text → extract + chunk (no OCR).
- Image-only / empty text layer → `requires_ocr` or OCR attempt → `ocr_failed` on empty/error (never marked complete with fabricated text).
- Malformed “PDF” uploads without `%PDF` magic are rejected at upload (`assertPdfIntegrity`).

## Production certification status

- **Implementation:** COMPLETE for adapters + config allowlist.
- **Live load-test / managed OCR endpoint certification:** NOT DONE in WP-04 (no paid OCR calls required for unit gates).
- Advertise OCR as production-ready only after endpoint load-test and ops sign-off.
