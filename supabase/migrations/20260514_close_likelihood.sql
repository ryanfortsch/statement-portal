-- Close-likelihood on prospects.
--
-- A user-entered confidence percentage (0–100) capturing the analyst's gut
-- on how likely the deal is to close. Surfaces in the identity strip on the
-- prospect detail page and as a per-row badge on the Prospects list — it's
-- a primary at-a-glance metric for triaging the funnel ("which of my 12
-- prospects am I about to lose?"), so it needs to be visible everywhere a
-- prospect shows up.
--
-- Nullable: existing prospects have no value until the analyst fills one in.
-- The UI renders "—" + a "Set likelihood" affordance when null.

alter table public.projections
  add column close_likelihood_pct integer
    check (close_likelihood_pct is null or (close_likelihood_pct >= 0 and close_likelihood_pct <= 100));
