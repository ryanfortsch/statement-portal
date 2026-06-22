-- Guest-facing flag on property notes.
--
-- A note marked guest_facing = true is part of the property's
-- guest-messaging knowledge base (the kind of thing a guest would be
-- told: "the beach is a 4-minute walk", "the downstairs shower runs
-- hot for a minute"). guest_facing = false (default) is internal ops
-- knowledge (vendor codes, quirks only staff need).
--
-- This is what makes property_notes double as Helm's guest-messaging
-- knowledge base. The Quick Capture feature routes dictated/typed
-- fragments here with the flag set per the AI's read of the content.
-- A future bridge can sync guest_facing notes into the stay-concierge
-- per-listing markdown KB; for now the flag captures the intent and
-- surfaces guest knowledge distinctly on the property page.

alter table public.property_notes
  add column if not exists guest_facing boolean not null default false;

create index if not exists property_notes_guest_facing_idx
  on public.property_notes(property_id) where guest_facing = true;
