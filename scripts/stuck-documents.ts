#!/usr/bin/env npx tsx
/**
 * List documents stuck in non-terminal processing states.
 * Prints ids, state, and age only — never titles or file contents.
 *
 *   npm run beta:stuck-documents
 */
import postgres from "postgres";

const STUCK_MINUTES = Number(process.env.STUCK_DOCUMENT_MINUTES ?? "15");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
try {
  const rows = await sql<{
    id: string;
    processing_state: string;
    age_minutes: number;
  }[]>`
    select
      id,
      processing_state,
      extract(epoch from (now() - updated_at)) / 60 as age_minutes
    from documents
    where processing_state in (
      'uploaded',
      'awaiting_malware_scan',
      'unscanned_development',
      'scan_clean',
      'extracting_text',
      'requires_ocr',
      'chunking',
      'embedding',
      'indexed'
    )
      and updated_at < now() - (${STUCK_MINUTES}::text || ' minutes')::interval
    order by updated_at asc
    limit 200
  `;
  console.log(
    JSON.stringify({
      stuckMinutes: STUCK_MINUTES,
      count: rows.length,
      documents: rows.map((row) => ({
        id: row.id,
        processingState: row.processing_state,
        ageMinutes: Math.round(Number(row.age_minutes)),
      })),
    }),
  );
} finally {
  await sql.end({ timeout: 2 });
}
