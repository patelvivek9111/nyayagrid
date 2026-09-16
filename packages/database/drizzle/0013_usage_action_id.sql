-- Customer-action accounting: group multiple model-call rows under one user action.
-- Null = legacy rows created before action grouping (counted as one action per row).

ALTER TABLE "ai_usage_events" ADD COLUMN "usage_action_id" uuid;
CREATE INDEX "ai_usage_events_usage_action_idx" ON "ai_usage_events" ("usage_action_id");
