-- Hand-applied cleaning credits that survive the rebuild.
--
-- /api/ingest and /api/fill-gap wipe a statement's cleaning_events and
-- rebuild them from the bank CSV, so a credit the operator applied by
-- hand (Mark Duplicate) lived only on the wiped row and the next
-- re-upload billed the owner the gross again. Matching the credit back
-- by heuristics was tried and removed (#1472). This table is the durable
-- version: the ruling is its own row keyed on the charge's bank identity
-- (family, posting date, amount), loaded on every rebuild and re-applied
-- by src/lib/cleaning-credit-overrides.ts. No unique key on the identity:
-- two identical charges (same day, same flat rate) may each carry one.
--
-- RLS-locked to the service role (house pattern); every read and write
-- goes through the API routes.

create table if not exists cleaning_credit_overrides (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  month text not null,
  family text not null check (family in ('cleaning', 'linen', 'laundry')),
  charge_date date not null,
  charge_amount numeric not null check (charge_amount > 0),
  credit_amount numeric not null check (credit_amount > 0 and credit_amount <= charge_amount),
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists cleaning_credit_overrides_property_month
  on cleaning_credit_overrides (property_id, month);

alter table cleaning_credit_overrides enable row level security;

revoke all on cleaning_credit_overrides from anon, authenticated;

grant all on cleaning_credit_overrides to service_role;

comment on table cleaning_credit_overrides is
  'Operator-applied cleaning credits, keyed on the charge''s bank identity so a rebuild re-applies them. Written by PATCH /api/cleaning-events/:id, removed by /api/resolve-gap remove_credit_override.';

-- Backfill: every hand credit currently on file. An auto-netted refund
-- carries the netter's marker in its reason and is re-derived from the
-- CSV on every rebuild, so it is not an override. Idempotent: a row with
-- the same identity and credit is not inserted twice.
insert into cleaning_credit_overrides
  (property_id, month, family, charge_date, charge_amount, credit_amount, reason, created_by, created_at)
select ps.property_id,
       sp.month,
       case ce.source
         when 'bank-linen' then 'linen'
         when 'bank-laundry' then 'laundry'
         else 'cleaning'
       end as family,
       ce.bank_charge_date,
       ce.amount,
       least(ce.credit_amount, ce.amount),
       ce.credit_reason,
       'backfill 2026-09-07',
       coalesce(ce.created_at, now())
from cleaning_events ce
join property_statements ps on ps.id = ce.property_statement_id
join statement_periods sp on sp.id = ps.period_id
where coalesce(ce.credit_amount, 0) > 0
  and ce.bank_charge_date is not null
  and ce.amount > 0
  and ce.source in ('matched', 'bank', 'corroborated', 'bank-linen', 'bank-laundry')
  and coalesce(ce.credit_reason, '') not like '%(auto-netted at %'
  and not exists (
    select 1 from cleaning_credit_overrides o
    where o.property_id = ps.property_id
      and o.month = sp.month
      and o.charge_date = ce.bank_charge_date
      and abs(o.charge_amount - ce.amount) <= 0.005
      and abs(o.credit_amount - least(ce.credit_amount, ce.amount)) <= 0.005
  );
