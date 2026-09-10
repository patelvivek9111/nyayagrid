# Reviewer instructions

NyayaGrid is an **attorney-assistance** system. It is not autonomous counsel, not a filing system, and not a substitute for checking the file.

## Before you start

1. Confirm the packet is labeled SYNTHETIC. Stop if you see real client names or confidential files.
2. Read the source documents for your assigned matter(s) in `sources/` (or the V2 PDFs).
3. Then look at NyayaGrid output (live Case UI or a facilitator `outputs/` folder).
4. Do **not** ask the facilitator for “the right answer,” hidden ground truth, or benchmark keys until you have submitted scores.

## How to judge

- Check underlying sources where a conclusion matters.
- Do not assume generated text is correct because it sounds professional.
- For every criticism, quote or pinpoint the source (filename + passage) **or** state that no source exists.
- Distinguish:
  - **Grounding failure** — fact/exhibit/authority not in the file, or missing when the file answers it.
  - **Legal disagreement** — you would analyze the issue differently though the product stayed inside the sources and labeled uncertainty.
- Stylistic wording, verbosity, and UX friction are MINOR unless they hide a material gap.
- Record time actually saved versus doing the same task by hand, including time spent checking sources.
- Record anything that reduces trust, even if the answer happened to be right.

## Expected caution

NyayaGrid should abstain or hedge when the file is silent, conflicted, or missing an exhibit. A confident answer with no citation for a material fact is a defect.

**Would you rely on this without checking sources?** The expected answer is generally **NO**.

## What to turn in

For each assigned matter and each in-scope workflow:

- `forms/reviews.csv` row (or the matching markdown form)
- `forms/issues.csv` rows for every CRITICAL / MAJOR / MINOR issue
- would-use-in-practice: YES / WITH_CHANGES / NO
- minutes spent

If a workflow was not run, score NA and say so. Do not invent a score.
