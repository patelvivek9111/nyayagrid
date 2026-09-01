# NYAYA-BENCH TEST SET V2

**SYNTHETIC / FICTIONAL TEST DATA ONLY.**

V2 contains **16 matters, 128 PDFs, and 400 benchmark tasks**.

## Design
- Long-form main agreements are approximately 12-18+ pages.
- Each matter has two amendments, misleading email evidence, deposition testimony, an access log, payment records, and meeting minutes.
- Tests cover amendments/supersession, future-effective terms, misleading emails, genuine and false contradictions, missing exhibits, cross-document evidence chains, difficult timelines, numeric precision, entity resolution, and adversarial hallucination/quotation traps.

## Critical separation
`scenarios/` may be ingested by NyayaGrid.
`hidden_ground_truth/` MUST NOT be ingested or shown to NyayaGrid before it answers.

## Recommended use
1. Ingest one scenario's `documents/`.
2. Run prompts from `tasks.json`.
3. Save raw NyayaGrid outputs/citations.
4. Grade against the matching hidden ground-truth file.
5. Treat fabricated facts, quotations, or citations as high-severity failures.
