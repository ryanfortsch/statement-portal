-- Contractor opt-out for the "new work posted" texts.
--
-- notifyContractorsOfPacket already texts eligible in-trade contractors when a
-- packet publishes (via Quo). This adds a per-contractor preference so they can
-- turn those texts off from their profile. Opt-OUT: default true (everyone
-- receives), they uncheck it to stop. The notify query gates on this.

alter table public.contractors
  add column if not exists sms_opt_in boolean not null default true;
