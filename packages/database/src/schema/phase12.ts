import { pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Conservative coverage labels for a jurisdiction + practice-area pair.
 * Absence of a row means UNVALIDATED. Phase 6S does not certify any state.
 */
export const jurisdictionCoverage = pgTable(
  "jurisdiction_coverage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateCode: text("state_code"),
    forumType: text("forum_type").notNull().default("state"),
    practiceArea: text("practice_area"),
    status: text("status").notNull().default("unvalidated"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("jurisdiction_coverage_scope_uidx").on(
      table.stateCode,
      table.forumType,
      table.practiceArea,
    ),
    index("jurisdiction_coverage_state_idx").on(table.stateCode),
  ],
);
