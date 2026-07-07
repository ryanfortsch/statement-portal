-- Dismissals for the "Split into installments" suggestions on
-- /properties/[id]. A multi-month booking that doesn't need a split (the
-- canonical case: the owner's own long stay, $0 net) otherwise sits in the
-- Multi-month bookings card forever as a suggestion nobody will act on.
--
-- Dismissal is GLOBAL per booking (unique confirmation_code), not per-user:
-- once someone on the team decides a stay doesn't need a split, it should
-- stop nagging everyone. Restoring = deleting the row (the card offers an
-- inline "show dismissed / restore" path, so a mistaken dismiss is one tap
-- to undo).
--
-- Deliberately NOT auto-dismissing $0-net stays: staycapeann direct
-- bookings show TOTAL_PAID = 0 in Guesty while the real money lives in the
-- property's own Stripe account, and those are exactly the long stays that
-- DO need installment splits. The operator decides; Helm just remembers.

create table public.installment_suggestion_dismissals (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  property_id text not null,
  dismissed_by_email text,
  created_at timestamptz not null default now()
);

-- Project-standard permissive RLS: access is gated at the Auth.js layer in
-- the app; the anon key needs read/insert/delete for the client-side card.
alter table public.installment_suggestion_dismissals enable row level security;
create policy "anyone can read installment_suggestion_dismissals"
  on public.installment_suggestion_dismissals for select using (true);
create policy "anyone can insert installment_suggestion_dismissals"
  on public.installment_suggestion_dismissals for insert with check (true);
create policy "anyone can delete installment_suggestion_dismissals"
  on public.installment_suggestion_dismissals for delete using (true);
