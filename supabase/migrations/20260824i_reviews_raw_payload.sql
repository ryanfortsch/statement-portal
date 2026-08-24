-- Keep the channel's own review payload alongside the parsed columns.
--
-- Guesty's /v1/reviews feed returns each channel's raw review verbatim and
-- publishes no normalized fields of its own. Helm parsed only Airbnb's
-- shape, so every VRBO and Booking.com review stored a null rating and null
-- text and disappeared from the Reviews surfaces, which filter unrated rows.
-- src/lib/guesty-review-normalize.ts now speaks each dialect, and this
-- column keeps the source payload so a channel it reads wrong can be given
-- an exact mapping without waiting for the next review to come in.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS raw_review JSONB;

COMMENT ON COLUMN reviews.raw_review IS
  'Guesty rawReview payload as delivered by the channel. Parsed into the rating/text/category columns by src/lib/guesty-review-normalize.ts.';
