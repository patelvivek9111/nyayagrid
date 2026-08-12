# Matter Intelligence lifecycle

AI extraction proposes structured matter intelligence from ready document chunks.

```
Ready document version
→ extract_matter_intelligence (idempotent per version)
→ validate source chunk IDs in org+matter scope
→ conservative dedupe / source merge
→ persist proposed timeline events, facts, entities, deadlines
→ human review (approve / edit+approve / reject)
→ verified intelligence available to Timeline, Overview, Nyaya Q&A, Summary
```

Rules:

1. Proposed items are never shown as verified facts.
2. Approval requires provenance for AI-origin records.
3. Deadlines are extracted only from document evidence; Phase 3 does not calculate procedural court deadlines.
4. Manual events are labeled `origin=manual` and are not falsely marked AI-extracted.
5. Matter summaries are AI-generated from verified intelligence only and are not attorney-authored.
