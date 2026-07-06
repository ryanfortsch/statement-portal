-- ── work_slips: guest-request source + reservation linkage ─────────────
--
-- Guest gear requests ("we'll need a pack and play and a high chair")
-- approved in the messaging flow now open a prep work slip automatically.
-- stay-concierge POSTs to /api/work-slips after the operator approves the
-- reply, so a promise made to a guest becomes a dated, assignable task.
--
-- from_guest_request_key: idempotency key for the auto-creation, shaped
--   "gear:<guesty_reservation_id>" (falls back to the approval id when the
--   reservation is unknown). One slip per stay: a retry or a second gear
--   message on the same reservation merges into the existing slip instead
--   of duplicating. Mirrors from_quo_message_id / from_review_id.
--
-- guesty_reservation_id: first-class stay linkage, so the Operations
--   turnover rail can surface the slip against the exact check-in it
--   preps for (not just the property). Nullable; general-purpose - any
--   future per-stay slip source can use it.

alter table work_slips add column if not exists from_guest_request_key text;
alter table work_slips add column if not exists guesty_reservation_id text;

create unique index if not exists work_slips_from_guest_request_key_uniq
  on work_slips (from_guest_request_key)
  where from_guest_request_key is not null;

-- The turnover rail looks slips up by reservation.
create index if not exists work_slips_guesty_reservation_id_idx
  on work_slips (guesty_reservation_id)
  where guesty_reservation_id is not null;
