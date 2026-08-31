-- Property outfitting order checklist: per-property have-counts for the
-- order list at /properties/<id>/order-checklist.
--
-- The catalog and the quantity math live in code
-- (src/lib/order-checklist.ts: Fix Linens sheet sets at 2.5x per bed size,
-- bath towels at 2.5x max guests, plus the readiness punch list). This
-- table only persists one jsonb blob per property, the same label-keyed
-- shape as projections.readiness_state:
--   { "have": { "Queen sheet sets": 3, ... },
--     "notes": { "order_notes": "..." },
--     "updated_at": "..." }
--
-- RLS-locked to the service role (house pattern from
-- property_onboarding_items): reads and writes go through
-- src/lib/order-checklist-db.ts.

create table if not exists property_order_checklist (
  property_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

alter table property_order_checklist enable row level security;

revoke all on property_order_checklist from anon, authenticated;

grant all on property_order_checklist to service_role;
