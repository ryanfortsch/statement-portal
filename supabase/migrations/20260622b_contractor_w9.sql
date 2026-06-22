-- Contractor W-9, stored in Helm (no QuickBooks). This holds the most sensitive
-- PII in the system (a TIN/SSN), so:
--   * one row per contractor (contractor_id is the PK),
--   * the TIN is stored ENCRYPTED (app-level AES-256-GCM, see field-crypto.ts) —
--     only tin_last4 is kept in the clear for display,
--   * RLS is on with NO policy (deny-by-default): reachable ONLY via the
--     service-role client, never the browser anon key.

create table if not exists public.contractor_w9 (
  contractor_id      uuid primary key references public.contractors(id) on delete cascade,
  legal_name         text not null,
  business_name      text,
  tax_classification text not null,         -- Individual / Sole proprietor, LLC, S-corp, ...
  address_line       text not null,
  city               text not null,
  state              text not null,
  zip                text not null,
  tin_type           text not null check (tin_type in ('ssn', 'ein')),
  tin_encrypted      text not null,         -- AES-256-GCM payload (iv.tag.ciphertext)
  tin_last4          text,                  -- clear, for display only
  signed_name        text not null,
  signed_at          timestamptz not null default now(),
  signed_ip          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.contractor_w9 enable row level security;
-- No policy on purpose: deny-by-default. Read/written only by the service role.
