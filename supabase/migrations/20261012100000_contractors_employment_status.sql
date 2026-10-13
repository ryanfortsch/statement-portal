-- A contractor record can now belong to an EMPLOYEE.
--
-- The first W-2 hire (the Operations Manager, 2026-11-01) was an inspection
-- contractor first. Her record carries 800+ work slips and 60+ paid packets
-- and must stay, but from her start date she must never again be awarded or
-- claim a paid packet, be texted "new work near you", or earn a streak bonus:
-- every one of those is a second payment on top of a salary.
--
-- 'contractor' is the default, so every existing row is unchanged. Flipping a
-- row to 'employee' is an owner action on the roster (setContractorEmployment
-- in src/app/fieldwork/packets/actions.ts). canClaim() in src/lib/field-types.ts
-- is the gate the rest of the Field module reads.
--
-- Additive and reversible. Safe against the currently deployed code, which
-- never selects the column.
alter table public.contractors
  add column if not exists employment_status text not null default 'contractor'
    check (employment_status in ('contractor', 'employee'));

comment on column public.contractors.employment_status is
  'contractor (1099, claims paid packets) or employee (W-2: keeps the record and the work board, never a paid packet, never a streak bonus, never a new-work text).';
