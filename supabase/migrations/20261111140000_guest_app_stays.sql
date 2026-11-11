-- The Stay Cape Ann guest app, phase 2: one short-lived link per stay
-- (2026-11-11).
--
-- Phase 1 (guest_app_homes) gave each home one permanent link, printed in
-- the house, and so it carries no access code. This table is the other
-- half: /h/s/<token>, minted for ONE reservation, which shows the home's
-- app plus "Your stay" (the guest's dates, arrival steps and the stay's own
-- Seam door code) only inside the stay's window:
--
--   opens  10:00 AM Eastern the day before check-in, the hour the arrival
--          message already texts the code;
--   closes at the guest's checkout (House policy checkout, or a paid late
--          checkout), Eastern.
--
-- Before the window the link shows the home's app and the hour the stay
-- opens; after it, a thank-you page; a cancelled stay or a revoked link
-- shows the same "this link has moved" page as a retired home link.
--
-- What the row holds, and what it never holds:
--   * the token (the credential, 128 random bits, independent of the home
--     token so the printed card can never be turned into a stay link), the
--     stay it belongs to (the canonical bookings row at mint time; reads
--     follow duplicate_of), revocation, and two counters;
--   * NO dates and NO code. The window is read live from the stay, so a
--     date change moves it and a cancellation ends it, and the code is read
--     live from guest_access_codes, so a revoked or reissued PIN is what the
--     page shows next. The code never appears in the page's HTML at all: the
--     guest taps "Show my door code" and it comes back from a POST.
--
-- Service role only. RLS on with no policies; the Data API grant is in this
-- migration (new tables stopped receiving one on 2026-10-30).

create table if not exists public.guest_app_stays (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (token ~ '^[a-f0-9]{32}$'),
  property_id text not null references public.properties(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  revoked_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0),
  last_opened_at timestamptz,
  code_shown_count integer not null default 0 check (code_shown_count >= 0),
  code_shown_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);

comment on table public.guest_app_stays is
  'One short-lived guest app link per stay (/h/s/<token>): the home''s app plus the stay''s arrival steps and Seam door code inside the stay window. Holds the token, the stay and counters; never dates and never a code. src/lib/guest-app-stays-db.ts.';

-- One live link per stay: a second mint returns the first.
create unique index if not exists guest_app_stays_live_booking
  on public.guest_app_stays (booking_id)
  where revoked_at is null;
create index if not exists guest_app_stays_property_idx
  on public.guest_app_stays (property_id);

alter table public.guest_app_stays enable row level security;
-- The tokens are credentials: no public-key path at all, not just no policy.
revoke all on public.guest_app_stays from anon, authenticated;
grant all on public.guest_app_stays to service_role;

-- The counters. One statement each, so two phones at once both count; a
-- revoked link counts nothing.
create or replace function public.guest_app_stay_seen(p_token text, p_code boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.guest_app_stays
     set open_count = open_count + case when p_code then 0 else 1 end,
         last_opened_at = case when p_code then last_opened_at else now() end,
         code_shown_count = code_shown_count + case when p_code then 1 else 0 end,
         code_shown_at = case when p_code then coalesce(code_shown_at, now()) else code_shown_at end
   where token = p_token
     and revoked_at is null;
$$;

revoke all on function public.guest_app_stay_seen(text, boolean) from public, anon, authenticated;
grant execute on function public.guest_app_stay_seen(text, boolean) to service_role;
