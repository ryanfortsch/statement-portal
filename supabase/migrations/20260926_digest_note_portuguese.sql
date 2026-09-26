-- The operator's special instruction, rendered for the people who read it.
--
-- Dotti, 2026-09-26, looking at a digest card with "NOTE: YOU CAN DO 3
-- LOCUST, 19 RACKLIFFE, 225 WASHINGTON on MONDAY" typed into Special
-- instructions: "shouldn't the special instructions get integrated into
-- the draft and processed smoothly and in portuguese so you see what's
-- going to be sent beforehand?"
--
-- Three things were wrong and all three were invisible from the card:
--
--   1. the note went out in whatever the operator typed. The schedule
--      above it is Portuguese; the instruction under it was English, to a
--      crew that reads Portuguese.
--   2. it was appended raw at send time, so shouted text stayed shouted.
--   3. it never appeared in "The text that goes out", so the one string
--      the operator was asked to approve was not the string Rosa got.
--
-- The note is still stored as typed -- those are her words and the record
-- of what she asked for. The bilingual rendering is stored beside it,
-- derived once when the note is saved, so the card can show the real tail
-- before anyone taps Approve. operator_note_src stamps the exact typed
-- text the pair came from: when it and operator_note disagree, the
-- rendering is stale and gets re-derived before sending.

ALTER TABLE cleaner_schedule_digests
  ADD COLUMN IF NOT EXISTS operator_note_pt TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS operator_note_en TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS operator_note_src TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN cleaner_schedule_digests.operator_note IS
  'The special instruction exactly as the operator typed it. Never sent raw; see operator_note_pt.';
COMMENT ON COLUMN cleaner_schedule_digests.operator_note_pt IS
  'The instruction in Brazilian Portuguese. This is what the cleaners actually read.';
COMMENT ON COLUMN cleaner_schedule_digests.operator_note_en IS
  'The instruction tidied up in English, printed under the Portuguese so the operator can check the translation.';
COMMENT ON COLUMN cleaner_schedule_digests.operator_note_src IS
  'The operator_note text the _pt/_en pair was derived from. Differs from operator_note => stale, re-derive before sending.';
