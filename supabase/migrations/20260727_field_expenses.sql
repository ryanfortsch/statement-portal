-- Receipt reimbursement on field work. A contractor completing a task can
-- record what they spent (drain-o, batteries) with the receipt photo; the
-- amount rides the slip, and the packet carries the recomputed total so
-- payout math (base + bonus + receipts) works from packet columns alone.
alter table public.work_slips
  add column if not exists expense_cents int;
alter table public.inspection_packets
  add column if not exists expenses_cents int not null default 0;
