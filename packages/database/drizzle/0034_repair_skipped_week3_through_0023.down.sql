-- Intentionally no-op: rolling back would drop live week3/civil/discovery/motion
-- objects and is not safe on shared staging after product data exists.
SELECT 1;
