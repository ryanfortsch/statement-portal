-- Testimonials from direct (staycapeann.com) guests, 2026-10-31.
--
-- A direct guest has no OTA review page. Since #148 (stay-concierge) the
-- review sweep asks a direct guest after a stellar stay; with this table the
-- ask links a form on staycapeann.com (/review/<token>) instead of a fixed
-- link. The concierge mints one row per stay through POST
-- /api/testimonials/invite (status 'invited'), the form reads and submits
-- through /api/testimonials/<token> (status 'submitted'), and the operator
-- approves or hides it on the Reviews tab. Approved rows render ahead of the
-- live Guesty reviews on the home's listing page, read through GET
-- /api/testimonials?listing=<guesty listing id>. The form's thank-you page
-- then offers the Google Business Profile link (GOOGLE_REVIEW_URL), Dotti's
-- choice of 2026-10-31: "the text links the site form and the form's
-- thank-you page offers the Google link".
--
-- Additive. Nothing deployed before this change reads it. Apply before the
-- Helm deploy that carries src/app/api/testimonials, or the concierge's mint
-- answers 503 and the sweep skips the stay unrecorded until the next pass.

create table if not exists public.guest_testimonials (
  id uuid primary key default gen_random_uuid(),

  token text not null unique,                 -- 32 hex chars, the form's credential
  reservation_id text not null unique,        -- one testimonial per stay (Guesty reservation id)
  property_id text not null references public.properties(id),
  guest_first text not null default '',       -- from the reservation, for the form's greeting
  guest_name text not null default '',        -- as the guest wrote it on the form
  show_name boolean not null default true,    -- false: shown as "A Stay Cape Ann guest"
  check_in date,
  check_out date,
  channel text not null default 'Direct',

  status text not null default 'invited'
    check (status in ('invited', 'submitted', 'approved', 'hidden')),
  rating smallint check (rating is null or rating between 1 and 5),
  body text not null default '',

  invited_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,                     -- approve or hide
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_guest_testimonials_property_status
  on public.guest_testimonials(property_id, status);

alter table public.guest_testimonials enable row level security;
grant all on public.guest_testimonials to service_role;
