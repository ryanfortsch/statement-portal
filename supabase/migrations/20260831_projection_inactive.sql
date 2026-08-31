-- Prospect demotion: mark a funnel prospect Inactive without deleting it.
--
-- A prospect that never signed and is no longer a viable opportunity (went
-- with another manager, decided not to rent, went quiet for good) gets
-- demoted out of the active funnel instead of hard-deleted. Everything on
-- the record stays: projection inputs, deliverables, contract draft,
-- onboarding intake. Reactivating clears both columns.
--
-- inactive_at IS NULL -> live in the funnel (or promoted; promoted rows
--                        never set this, property_id owns that state).
-- inactive_at set     -> hidden from Active Prospects, the forecast
--                        model's prospect contribution, and the morning
--                        brief; listed in the Inactive section instead.
alter table public.projections
  add column if not exists inactive_at timestamptz,
  add column if not exists inactive_reason text;
