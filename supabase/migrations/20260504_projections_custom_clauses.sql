-- Per-deal contract addenda.
--
-- The seven standard contract terms (deposit, fees, days, etc.) are already
-- editable on the prospect detail page. This adds a way to attach
-- prospect-specific custom clauses that get rendered as a "Rider" page in the
-- contract, after Sale Protection and before Liability/Indemnification.
--
-- Stored as a JSONB array of {title, body} so the form can iterate freely
-- without schema migrations per clause.

alter table public.projections
  add column custom_clauses jsonb;
