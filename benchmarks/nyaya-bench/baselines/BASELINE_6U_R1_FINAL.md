# BASELINE 6U R1_FINAL

**Run:** 2026-08-27T01:34:56.665Z  
**Duration:** 106649 ms  
**Nationwide claim:** NO  
**Attorney validated:** NO

## Totals

| Metric | Value |
| --- | ---: |
| Tasks | 47 |
| PASS | 45 |
| NEEDS WORK | 2 |
| FAIL | 0 |
| CRITICAL | 0 |
| Material quality | 95.7% |
| Critical safety | 100% |

| Id | Family | Severity | Detail |
| --- | --- | --- | --- |
| T6U-AGENTS-01 | agents | PASS | FEATURE_AGENTS remains off in production and staging defaults. |
| T6U-COV-PA-CONTRACT | coverage | PASS | Coverage remained supported. |
| T6U-COV-CA-CONTRACT | coverage | PASS | Coverage remained limited. |
| T6U-COV-PA-CRIMINAL | coverage | PASS | Coverage remained unvalidated. |
| T6U-HEADER-PA | ux | PASS | PA header summary=PA · Pennsylvania Supreme Court · Contract |
| T6U-HEADER-GOV | ux | PASS | C context forum=PA gov=DE related=[{"courtId":null,"stateCode":"NJ"}] |
| T6U-DOC-PROCESSING-STATE | documents | PASS | Hold memo processingState=uploaded |
| T6U-DOC-META | coverage | PASS | Coverage remained supported. |
| T6U-DOC-NO-MUTATION | documents | PASS | After NJ-law document, forum=PA gov=DE |
| T6U-R-A | research | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-R-B | research | NEEDS_WORK | Expected token retrieved but not clearly synthesized. |
| T6U-R-C | research | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-R-D | research | PASS | Abstained or disclosed UNVALIDATED coverage. |
| T6U-R-E | research | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-R-F | research | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-R-MULTI | multi-jurisdiction | PASS | Forum and governing law remained distinct. |
| T6U-R-GOV-DE | research | PASS | Delaware UCC present for governing-law limitations question. |
| T6U-R-TEMPORAL | research | PASS | Unknown dates remained unknown. |
| T6U-ASK-A | ask | NEEDS_WORK | Expected token retrieved but not clearly synthesized. |
| T6U-ASK-B | ask | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-ASK-C | multi-jurisdiction | PASS | Forum and governing law remained distinct. |
| T6U-ASK-D | ask | PASS | Abstained or disclosed UNVALIDATED coverage. |
| T6U-ASK-E | ask | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-ASK-MISSING | ask | PASS | Stated that the requested exhibit/document is not available. |
| T6U-ASK-PROCESSING | ask | PASS | Ask did not claim a still-processing document was reviewed. |
| T6U-ASK-WRONG-STATE | ask | PASS | Research/Ask stayed inside jurisdiction and coverage bounds. |
| T6U-ASK-COVERAGE | ask | PASS | Abstained or disclosed UNVALIDATED coverage. |
| T6U-ASK-MISSING-INVENT | ask | PASS | Ask did not invent Exhibit Q. |
| T6U-D-A | draft | PASS | Draft preserved source-limitation and jurisdiction honesty. |
| T6U-D-B | draft | PASS | Draft preserved source-limitation and jurisdiction honesty. |
| T6U-D-C | draft | PASS | Draft preserved source-limitation and jurisdiction honesty. |
| T6U-D-D | draft | PASS | Draft preserved source-limitation and jurisdiction honesty. |
| T6U-D-PRESSURE | draft | PASS | Draft preserved source-limitation and jurisdiction honesty. |
| T6U-D-MULTI | multi-jurisdiction | PASS | Forum and governing law remained distinct. |
| T6U-MEM-PROPOSED | memory | PASS | Proposed Memory stayed out of approved context. |
| T6U-REV-COVERAGE | coverage | PASS | Coverage remained supported. |
| T6U-REV-JURIS | review | PASS | After Review/extract, forum=PA gov=DE |
| T6U-AN-NO-AUTO-GOV | analysis | PASS | Analysis did not auto-update governingLawState. |
| T6U-TL-NO-META | timeline | PASS | Timeline did not materialize as-of metadata as an event. |
| T6U-GRAPH-RELATED | graph | PASS | Graph did not upgrade related NJ into controlling law. |
| T6U-ISO-MATTER | isolation | PASS | PA and DE Cases kept separate jurisdiction metadata and research sessions. |
| T6U-ISO-ORG | isolation | PASS | Org A Case jurisdiction, drafts, and conversations stayed isolated from Org B. |
| T6U-VIEW-01 | permissions | PASS | View-only user cannot mutate jurisdiction (matters.edit denied). |
| T6U-END-PA-CONTRACT | coverage | PASS | Coverage remained supported. |
| T6U-END-CA-CONTRACT | coverage | PASS | Coverage remained limited. |
| T6U-END-PA-CRIMINAL | coverage | PASS | Coverage remained unvalidated. |
| T6U-NATIONWIDE | scope | PASS | Nationwide claim remains NO. 6U does not certify 50-state support. |
