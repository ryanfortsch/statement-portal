-- Owner-only read-back in Helm Channex Staging. Does not mutate anything.
begin read only;
with receipt as (select summary from helm_pilot_installation.message_queue),
 inventory as (select helm_booking_inventory_read('HELMTEST-calderwood') s),
 checks as (
 select 1 n, 'Queue creation rehearsal: ' || case when summary @> '{"workflows":6,"new_schedules":5,"held_identity_preserved":true,"already_sent_imported":1,"future_guest_jobs":3,"future_cleaner_batches":2,"fictional_cleaner_recipient_jobs":4,"key_code_held":true,"repeat_is_idempotent":true,"late_failure_atomic":true,"source_history_replay_blocked":true,"owner_only_handoff":true,"fixture_rolled_back":true,"existing_rows_preserved":true}'::jsonb then 'PASS' else 'FAIL' end result from receipt
 union all select 2,'New schedules created / existing held identity preserved: ' || (summary->>'new_schedules') || ' / ' || (summary->>'held_identity_preserved') from receipt
 union all select 3,'Retained test jobs: ' || ((select count(*) from automation_channex_jobs)+(select count(*) from automation_cleaner_jobs))
 union all select 4,'Active send controls: ' || ((select count(*) from properties where automations_enabled)+(select count(*) from message_automations where enabled)+(select count(*) from automation_channex_routes where enabled)+(select count(*) from automation_cleaner_batches where enabled)+(select count(*) from cleaner_schedule_recipients where enabled))
 union all select 5,'Connected booking channels: ' || count(*) from channel_listings
 union all select 6,'Calendar capture / plan / journal: ' || (s->>'captureVersion') || ' / ' || (s->>'planVersion') || ' / ' || (s->>'journalVersion') from inventory
 union all select 7,'Inventory publishing: ' || (s->'configuration'->>'publishEnabled') from inventory
 union all select 8,'Preserved bookings / sends: ' || (select count(*) from bookings) || ' / ' || (select count(*) from automation_sends)
 union all select 9,'Provider calls in rehearsal: ' || (summary->>'provider_calls') from receipt
)
select result as "Isolated queue verification" from checks order by n;
rollback;
