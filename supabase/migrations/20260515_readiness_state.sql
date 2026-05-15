-- Readiness checklist state on prospects.
--
-- The Property Readiness Checklist (room-by-room punch list rendered at
-- /projections/<id>/readiness) is now an interactive walkthrough tool —
-- the analyst opens it on their phone during a property visit, taps to
-- check items off, and types into the walkthrough-notes fields (supply
-- closet location, smart-lock code, cleaner access, etc.). All state
-- persists per prospect so a walkthrough can be paused + resumed.
--
-- Single jsonb column keeps it cheap (no per-item rows) and matches the
-- pattern used by other prospect-scoped blobs (gmail_touches,
-- contract_overrides, onboarding_data, custom_clauses).
--
-- Shape:
--   {
--     "checked": ["Coffee mugs", "Pots & pans", ...],
--     "notes": {
--       "supply_closet": "Upstairs hall closet",
--       "smart_lock": "August / 1234#",
--       "cleaner_access": "Lockbox under deck, code 0815",
--       ...
--     },
--     "updated_at": "2026-05-15T13:42:11.231Z"
--   }
--
-- Nullable: existing prospects have no readiness data until the analyst
-- first taps an item or types a note.

alter table public.projections
  add column readiness_state jsonb;
