-- Guest-message mined slips + maintenance-run scoping.
--
-- 1) from_guest_message_key: idempotency key for work slips mined by AI from
--    guest message threads (src/lib/messages-to-slips.ts). Shape
--    "guestmsg:<conversation_id>:<issue_slug>" where the slug is a stable
--    kebab identifier for the UNDERLYING issue (e.g. "side-door-lock"),
--    NOT a message id: one guest message can report several issues, and a
--    thread re-fetch that renumbers message ids must not mint new keys.
--    Mirrors the existing from_quo_message_id / from_gmail_message_id
--    partial-unique pattern: one slip per reported issue, ever -- a
--    dismissed slip stays dismissed and blocks re-filing.
--
-- 2) run_scope / run_scope_note / effort_minutes: AI triage of open
--    maintenance slips by who should do the work (src/lib/maintenance-runs.ts):
--      'inspector'  a field inspector can knock it out during a routine stop
--      'handyman'   needs a dedicated maintenance run (real tools, parts, time)
--      'pro'        licensed/specialty trade -- schedule a vendor
--    Text columns (no enum), validated app-side like the later-era columns
--    (block_type et al). effort_minutes is the AI's on-site estimate used by
--    the run planner's "substantive enough" gate.

alter table public.work_slips
  add column if not exists from_guest_message_key text,
  add column if not exists run_scope text,
  add column if not exists run_scope_note text,
  add column if not exists effort_minutes integer;

create unique index if not exists work_slips_from_guest_message_key_uniq
  on public.work_slips(from_guest_message_key)
  where from_guest_message_key is not null;

create index if not exists work_slips_run_scope_idx
  on public.work_slips(run_scope)
  where run_scope is not null;
