-- The walk is free (Dotti, 2026-11-14). Every partner home is walked before it
-- lists on staycapeann.com (the listing bar's walk line, partner_listings
-- .walked_on), so the walk is not a paid service and a host cannot ask about
-- it (src/lib/partner-host-services.ts). Four services remain.
--
-- An open or answered walk ask, if a host made one, is closed with a reason,
-- and kept. The check then names the four; it is validated only when no walk
-- row exists, so nothing is deleted. Fails whole if the constraint has moved.

update public.partner_service_asks
   set status = 'closed', closed_at = now(), closed_by = 'helm: the walk is free'
 where service = 'verified_walk' and status in ('open', 'answered');

alter table public.partner_service_asks drop constraint partner_service_asks_service_check;

do $$
begin
  if exists (select 1 from public.partner_service_asks where service = 'verified_walk') then
    alter table public.partner_service_asks add constraint partner_service_asks_service_check
      check (service in ('photo_shoot', 'guest_app', 'turnovers', 'guest_messages')) not valid;
  else
    alter table public.partner_service_asks add constraint partner_service_asks_service_check
      check (service in ('photo_shoot', 'guest_app', 'turnovers', 'guest_messages'));
  end if;
end $$;
