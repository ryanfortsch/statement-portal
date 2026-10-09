-- Properties: a home where we (or someone we arrange) roll the City carts to
-- the curb and back, so the guest only ever fills them.
--
-- 16 Waterman is the live case. Its trash_notes has said so since the cart
-- cutover ("We move this home's carts to the curb, so guests never need to"),
-- but a sentence is not a switch. The trash-day fridge card
-- (src/lib/trash-notice.ts) lays the set-out out as two dated instructions,
-- and for this home "roll both carts out to the curb" is the wrong one.
-- civic.ts reads this flag and words the two lines for that home instead;
-- the lids clause and the holiday clause print unchanged, because what goes
-- in the cart is still the guest's.
--
-- Additive and idempotent. Deployed code that predates the column ignores it.
alter table public.properties
  add column if not exists carts_handled_by_us boolean not null default false;

comment on column public.properties.carts_handled_by_us is
  'True when we, not the guest, roll the City carts to the curb and back. The trash-day notice words its two steps for that; civic.ts owns the wording.';

update public.properties
   set carts_handled_by_us = true
 where id = '16_waterman'
   and city ilike 'Gloucester%'
   and trash_notes ilike '%we move this home''s carts%'
   and carts_handled_by_us = false;
