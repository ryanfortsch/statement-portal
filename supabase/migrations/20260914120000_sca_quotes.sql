-- Stay Cape Ann custom quotes.
--
-- One row per custom quote or booking request the team composes in Helm
-- (/guests/quotes) and sends to a guest. The guest opens the hosted page on
-- staycapeann.com (/quote/<token>), accepts the rental agreement, and pays on
-- the property's own Stripe account; staycapeann.com creates the Guesty
-- reservation at the NEGOTIATED price (POST /v1/reservations-v3 with
-- accommodationFare + cleaningFee) and reports back through the bridge
-- (/api/sca-quotes/<token>/events), which stamps the acceptance here.
--
-- Why Helm owns the record and staycapeann.com owns the payment: Helm has the
-- database, the operator identity, the property registry, and the guest
-- send rails (Resend as Allie, the Quo GUESTS line); staycapeann.com holds
-- the per-property Stripe secret keys, Stripe Elements, the Guesty write
-- client, the rental-agreement filing, and the refund webhook. Helm never
-- touches a Stripe secret (locked decision, 2026-06-02). The charge is a
-- plain PaymentIntent described "<title> - <check_in> to <check_out>" with
-- no helm_request_key, so stripe-sync pairs it to the reservation as stay
-- principal exactly like any other Stay Cape Ann booking. Zero statements
-- code changes.
--
-- Money is integer cents. tax_rate is the OWED occupancy rate for the
-- property on the day the quote was composed (src/lib/occupancy-tax.ts
-- owedOccupancyTaxRate); tax applies to accommodation minus discount, plus
-- cleaning, plus extras flagged taxable, and is zero when tax_exempt (31+
-- night stays). payment_plan 'split' collects deposit_cents at acceptance and
-- balance_cents on the same hosted page any time before balance_due_on.
--
-- Property fields are snapshotted (property_title, guesty_listing_id) because
-- the quote is a record of what was offered; property_id keeps the soft
-- link for the operator list.
--
-- Service-role only, like every Helm table: RLS on, no policies. The public
-- page authorizes by exact token match through the bridge route.

create table if not exists public.sca_quotes (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,                       -- 32 hex, crypto.randomBytes(16)
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'voided')),

  -- Property (soft link + snapshot)
  property_id text references public.properties(id) on delete set null,
  guesty_listing_id text not null,
  property_title text not null,                     -- external, guest-facing ("Stay at Rocky Neck")
  property_internal_name text,                      -- staff only, never rendered to the guest

  -- Stay
  check_in date not null,
  check_out date not null,
  nights integer not null,
  guests integer not null default 2,

  -- Guest
  guest_first_name text not null default '',
  guest_last_name text not null default '',
  guest_email text,
  guest_phone text,

  -- Money (integer cents)
  currency text not null default 'USD',
  nightly_cents integer,                            -- display only: the nightly figure shown to the guest
  accommodation_cents integer not null default 0,
  cleaning_cents integer not null default 0,
  extra_lines jsonb not null default '[]'::jsonb,   -- [{ "label": "Pet fee", "cents": 15000, "taxable": true }]
  discount_label text,
  discount_cents integer not null default 0,
  tax_exempt boolean not null default false,
  tax_rate numeric not null default 0,              -- 0.117 or 0.147 (owed rate), 0 when exempt
  tax_cents integer not null default 0,
  total_cents integer not null default 0,

  -- Payment plan
  payment_plan text not null default 'full' check (payment_plan in ('full', 'split')),
  deposit_cents integer,
  balance_cents integer,
  balance_due_on date,

  -- Calendar overrides the operator explicitly approved
  override_calendar boolean not null default false,  -- book nights the calendar shows closed/unreleased (never booked nights)
  override_terms boolean not null default false,     -- ignore min/max-night rules

  -- Copy
  message text,                                     -- note from Allie shown on the hosted page and in the email
  cancellation_terms text,                          -- snapshot of the cancellation wording the guest accepted
  terms_version text,
  internal_notes text,                              -- staff only, never rendered
  reference_quote jsonb,                            -- Guesty's own quote at compose time, for the operator's reference
  expires_at timestamptz,

  -- Lifecycle
  sent_at timestamptz,
  last_sent_at timestamptz,
  sent_via text[] not null default '{}',            -- 'email' | 'sms' | 'link'
  viewed_at timestamptz,
  view_count integer not null default 0,
  accepted_at timestamptz,
  accept_ip text,
  agreement_version text,
  agreement_accepted_at timestamptz,
  stripe_account_key text,
  stripe_payment_intent_id text,
  deposit_paid_at timestamptz,
  balance_payment_intent_id text,
  balance_paid_at timestamptz,
  balance_reminder_sent_at timestamptz,
  guesty_reservation_id text,
  guesty_confirmation_code text,
  guesty_total_cents integer,                       -- what Guesty computed for the reservation; compare to total_cents
  amount_paid_cents integer,                        -- what the card was charged on the first leg, as reported by staycapeann.com
  balance_paid_cents integer,                       -- what the card was charged on the balance leg
  accept_error text,
  accept_error_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  voided_at timestamptz,

  -- Last composer save (price, dates, guest, copy). updated_at cannot answer
  -- "edited since it was sent?" because the trigger bumps it on every bridge
  -- event (a repeat guest view, an accept failure); edited_at moves only when
  -- the operator saves. The hosted page echoes it back on accept, so a quote
  -- edited after the guest opened the page is refused rather than charged.
  edited_at timestamptz,

  -- Where the quote came from (a 2027 pre-release request, a /book inquiry, or by hand)
  source_kind text,
  source_ref text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sca_quotes_property_checkin_idx on public.sca_quotes (property_id, check_in);
create index if not exists sca_quotes_status_idx on public.sca_quotes (status);
create index if not exists sca_quotes_listing_dates_idx on public.sca_quotes (guesty_listing_id, check_in, check_out);

alter table public.sca_quotes enable row level security;
revoke all on public.sca_quotes from anon, authenticated;
grant all on public.sca_quotes to service_role;

comment on table public.sca_quotes is
  'Stay Cape Ann custom quotes composed in Helm, accepted and paid on staycapeann.com/quote/<token>. Service-role only.';

create trigger sca_quotes_updated_at before update on public.sca_quotes
  for each row execute function public.update_updated_at_column();
