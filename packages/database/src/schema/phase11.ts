import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./index";

/**
 * Separately recorded consent that customer data may be used for model training.
 * Absence of an active row means no consent. NyayaGrid still does not train on customer data
 * in this build even when a row exists — the row is the contractual/audit record only.
 */
export const trainingConsents = pgTable(
  "training_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    statement: text("statement").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByUserId: uuid("withdrawn_by_user_id").references(() => users.id),
  },
  (table) => [
    index("training_consents_organization_idx").on(table.organizationId),
    index("training_consents_active_idx")
      .on(table.organizationId)
      .where(sql`${table.withdrawnAt} IS NULL`),
  ],
);

export type TrainingConsent = typeof trainingConsents.$inferSelect;
