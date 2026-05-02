-- Entity layer (2/3): lift property_id onto reservations directly.
--
-- Today reservations are chained under property_statement_id, so any "show
-- me reservations at 21 Horton" query has to detour through monthly
-- statements. As Operations, Guest Intel, and Revenue come online they all
-- want a direct property_id on the reservation. Denormalizing it here is
-- cheaper than forcing every read through a join.
--
-- The column is nullable for now so existing inserts don't break. The
-- ingest route gets a one-line change to populate it on new writes; once
-- that's been live for a cycle we can backfill any stragglers and add
-- NOT NULL in a follow-up migration.

alter table public.reservations
  add column if not exists property_id text;

-- Backfill from the existing chain.
update public.reservations r
set property_id = ps.property_id
from public.property_statements ps
where r.property_statement_id = ps.id
  and r.property_id is null;

alter table public.reservations
  add constraint reservations_property_id_fkey
  foreign key (property_id) references public.properties(id);

create index if not exists idx_reservations_property_id
  on public.reservations(property_id);

-- Most cross-module queries will be "reservations at property X within a
-- date window" (Operations, Revenue, Guest Intel). Compound index makes
-- that cheap.
create index if not exists idx_reservations_property_check_in
  on public.reservations(property_id, check_in);
