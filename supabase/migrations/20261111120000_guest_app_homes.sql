-- The Stay Cape Ann guest app: one permanent link per home (2026-11-11).
--
-- A guest scans the QR code in the house, or taps the link in a message,
-- and lands on /h/<token>: Wi-Fi, checkout, trash night, how the house
-- works, safety, and Cape Ann nearby. Guesty's own guest app has no such
-- link: every Guesty link is minted per reservation and expires at
-- checkout, so there is nothing to print. This table is that link.
--
-- What the row holds, and what it never holds:
--   * the token (the credential: knowing it is what lets a phone read the
--     home's Wi-Fi password), whether the link is on, and an optional
--     welcome note in the host's own words;
--   * an open counter, so the property page can say whether guests use it;
--   * NO facts about the house. Every fact the app shows is read live from
--     where it already lives (properties, property_access for the Wi-Fi
--     password, property_rooms, guest-facing property_notes), the same
--     sources /api/kb-facts sends the guest AI, so the app and the concierge
--     never tell a guest two different things.
--   * NO door, gate, garage, alarm or thermostat code, ever. The link is
--     printed on a card in the house and outlives every stay.
--
-- Rotating the token (New link on the property page) is how a leaked link
-- is retired: every printed QR code for that home stops working at once.
--
-- Service role only. RLS on with no policies; the Data API grant is in this
-- migration (new tables stopped receiving one on 2026-10-30).

create table if not exists public.guest_app_homes (
  property_id text primary key references public.properties(id) on delete cascade,
  token text not null unique check (token ~ '^[a-f0-9]{16,64}$'),
  enabled boolean not null default true,
  welcome_note text check (welcome_note is null or char_length(welcome_note) <= 600),
  open_count integer not null default 0 check (open_count >= 0),
  last_opened_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.guest_app_homes is
  'One permanent guest app link per home (/h/<token>). Holds the token, the on/off switch, a welcome note and an open counter; never a fact about the house and never an access code. src/lib/guest-app-db.ts.';

alter table public.guest_app_homes enable row level security;
grant all on public.guest_app_homes to service_role;

-- One link for every managed home that is live today, so a card can be
-- printed the day this ships. A home added later gets its row from the
-- property page (Turn on the guest app).
insert into public.guest_app_homes (property_id, token)
select p.id, encode(gen_random_bytes(8), 'hex')
from public.properties p
where p.is_active = true
  and coalesce(p.kind, 'managed') = 'managed'
on conflict (property_id) do nothing;

-- The counter. One statement, so two phones opening the app at once both
-- count; only an enabled link counts.
create or replace function public.guest_app_opened(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.guest_app_homes
     set open_count = open_count + 1,
         last_opened_at = now()
   where token = p_token
     and enabled = true;
$$;

revoke all on function public.guest_app_opened(text) from public, anon, authenticated;
grant execute on function public.guest_app_opened(text) to service_role;
