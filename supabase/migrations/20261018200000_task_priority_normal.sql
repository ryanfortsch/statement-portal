-- ── task_priority: add 'normal' ─────────────────────────────────────
--
-- One priority scale for work slips and office to-dos (tasks). Slips have
-- always said low / normal / high; tasks said low / medium / high, and the
-- Work board's bulk bar quietly rewrote "Normal" to "medium" for them.
-- This adds 'normal' to the task enum, placed after 'medium' so the enum's
-- sort order stays low < (medium) < normal < high: every task reader orders
-- by priority descending and must keep high first.
--
-- Postgres refuses to use a new enum value in the transaction that adds it,
-- so the row rewrite and the new default are the next file,
-- 20261018200100_task_priority_normal_rows.sql. Apply this one first.
--
-- 'medium' stays in the enum (an enum value cannot be dropped in place);
-- nothing writes it after the code change that reads this lands.

alter type public.task_priority add value if not exists 'normal' after 'medium';
