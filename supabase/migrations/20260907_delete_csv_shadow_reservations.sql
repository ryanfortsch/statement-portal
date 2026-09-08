-- Delete the CSV shadow rows in guesty_reservations.
--
-- BACKGROUND. Both CSV write paths built rows whose guesty_reservation_id is
-- 'csv:<confirmation_code>', and the upsert conflicts on that id. For a booking
-- Guesty's API had already supplied, the ids differ, so the upsert did not
-- update the authoritative row: it inserted a twin. Two rows, one booking. Two
-- places read this table by confirmation code with no tie-break, so whichever
-- row came back last won; when the twin won, the stay dropped onto the fallback
-- pricing path and half the cancellation guard went quiet.
--
-- The minting was stopped in #1514 (src/lib/guesty-csv-rows.ts). This removes
-- the rows already on file.
--
-- THE RULE. Delete a csv: row only when an API-sourced row for the same
-- confirmation code carries AT LEAST as much money on BOTH fields. That is what
-- makes the deletion lossless, and it is deliberately narrower than "delete
-- every twin": the audit reported the twins as uniformly empty, and one of them
-- is not. HMMH98X35B (30 Woodward, Airbnb, 2026-05-01 to 05-04) has
-- total_paid 1109.48 / owner_net 832.12 on the CSV row and zeroes on the API
-- row, so the CSV row is the only record of what that booking paid. This
-- statement deliberately leaves it in place; deleting it would destroy data.
--
-- SAFETY. Statement money lives on `reservations`, not here, so no stored
-- owner_payout can move. Nine of the ten statements referencing these codes are
-- already sent and therefore frozen. Verified before and after: 26 April-June
-- payouts, all unchanged.
delete from guesty_reservations c
where c.guesty_reservation_id like 'csv:%'
  and exists (
    select 1 from guesty_reservations a
    where a.confirmation_code = c.confirmation_code
      and a.guesty_reservation_id not like 'csv:%'
      and coalesce(a.total_paid, 0)               >= coalesce(c.total_paid, 0)
      and coalesce(a.owner_net_revenue_guesty, 0) >= coalesce(c.owner_net_revenue_guesty, 0)
  );
