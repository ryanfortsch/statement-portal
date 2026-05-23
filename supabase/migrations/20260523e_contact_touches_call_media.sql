-- Store the full Quo call record on the touch: transcript + recording URL.
-- The webhook used to ignore call.transcript.completed /
-- call.recording.completed (only a 140-char AI summary survived). These
-- merge onto the touch the earlier call.completed created (by quo_call_id).
alter table contact_touches add column if not exists quo_transcript text;
alter table contact_touches add column if not exists quo_recording_url text;
