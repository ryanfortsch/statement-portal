-- The month-close handoff.
--
-- Three days before the monthly statement close the operations manager sends
-- clean field data: repair costs, card charges by home, and cleaning issues.
-- This table is that handoff. She adds items through the month on
-- /fieldwork/close, marks the month sent, and each item waits for an owner.
--
-- NOTHING HERE TOUCHES A PAYOUT. An item reaches a statement only when an
-- owner files it through /api/receipts, the one receipt writer, with its
-- double-deduction, sent-statement and freeze guards; the row then carries
-- that receipt's id. A cleaning issue is noted on the period or dismissed
-- with a note. Staff can add, delete and send their own items; filing and
-- dismissing are owner actions (src/app/api/close-handoff/[id]/route.ts).
--
-- Photos live in the private expense-receipts bucket under handoff/..., read
-- back through a signed URL like a receipt's own file.
--
-- Service-role only: RLS on, no policies, like sca_quotes. Additive.
create table if not exists public.close_handoff_items (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  property_id text not null,
  kind text not null check (kind in ('repair', 'card_charge', 'cleaning_issue')),
  description text not null,
  vendor text,
  amount numeric(10, 2) check (amount is null or amount > 0),
  charge_date date,
  file_path text,
  status text not null default 'open' check (status in ('open', 'sent', 'filed', 'dismissed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  receipt_id uuid
);

create index if not exists close_handoff_items_month_status_idx
  on public.close_handoff_items (month, status);
create index if not exists close_handoff_items_property_month_idx
  on public.close_handoff_items (property_id, month);

alter table public.close_handoff_items enable row level security;

comment on table public.close_handoff_items is
  'Field data for the monthly statement close (repair costs, card charges by home, cleaning issues). open: added, not yet sent. sent: the field marked the month sent. filed: an owner filed it as a receipt (receipt_id) or noted it on the period. dismissed: an owner set it aside (resolution_note). Never writes a payout itself.';
