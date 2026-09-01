-- Statement emails: the work-notes section becomes an owner-REQUEST section.
--
-- The section shipped in #1408 as a recap of what we handled. Its actual job
-- is the other direction: maintenance and purchase asks the owner has to
-- approve, plus items we want to flag. That is a curated list, not an
-- automatic one, so the operator's per-item picks and edits have to persist
-- next to the rest of the close-out state.
--
--   owner_request_items    jsonb, keyed by work_slip id:
--                            { "<slip_id>": { "include": bool,
--                                             "text": "<operator copy>" } }
--                          Absent id  -> fall back to the suggestion
--                          (flagged-for-owner slips ride along, the rest
--                          stay out) with the generated line.
--   email_include_handled  the old recap, demoted to an opt-in sub-section.
--                          Default off: requests lead.
--
-- email_include_work_slips keeps its name and its meaning ("include the
-- section"), so existing rows and Draft All need no backfill.

alter table public.close_tasks
  add column if not exists owner_request_items jsonb;

alter table public.close_tasks
  add column if not exists email_include_handled boolean not null default false;
