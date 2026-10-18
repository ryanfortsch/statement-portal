-- Playbook: rewrite "Turnovers and the six-stage cleaning lifecycle" (seeded
-- by 20261017120000_seed_playbook_operations.sql) for the board as it reads
-- after the Phase 3 turnover PRs: one line per house per day, the cleaner
-- verdict on the row, the rail only on lock-monitored homes, Cleanings folded
-- into the board, and the board and the schedule linking each other.
--
-- Same slug, so every link to the entry keeps working. Guarded so it never
-- clobbers an in-app edit: the body is replaced only while it still equals the
-- seeded "Initial version". The new body is snapshotted as a revision once.

update public.playbook_entries e
set
  title = 'The turnover board, one line per house per day',
  summary = 'What a turnover is, how to read one line of the board at 9 AM, and what opening a row shows.',
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = $md$A **turnover** is the gap between one guest leaving a house and the next one arriving: a clean and a walk stand between them. The **Turnovers** board (the Pipeline tab) shows every house that turns today and tomorrow, one line each. The range tabs widen it to 3, 7, 14 or 30 days.

## Reading one line

> **21 Horton** · Out 10:00 · In 4:00 · SAME DAY · Cleaner booked 10:30 · Not walked · **START WALK**

| Part | What it says | Where Helm gets it |
|---|---|---|
| **House** | Tap the name to open the row | |
| **Out · In** | When the last guest leaves and the next one arrives. A weekday shows when it is not the day the row sits under ("Out Sat · In 4:00"). **Same day** means both happen that day. **Vacant** means nobody arrives within the next month. | The checkout schedule, late checkouts and extensions included, and the home's guest check-in time |
| **Cleaner** | Cape Ann Elite's own booking for that checkout: **Cleaner booked 10:30**, **No cleaner booked**, **Cleaner before checkout**, **Cleaner after check-in**, **Not announced yet**. Then **Cleaning now** (a cleaner keyed in; smart-lock homes only), **Cleaned 1:40**, or **Clean not confirmed** once the checkout day has passed with no word. | Their Jobber reminder texts to the Quo line, the cleaner's text, the lock, or you |
| **Walk** | **Walked**, **Walking**, **Walk today · Delaney** (planned), **Field · name** (a contractor packet has it), **Needs walk** (cleaned, and the guest arrives within about a day and a half), **Not walked** | Helm walks and Field packets |
| **Verb** | One action: **Start walk**, **Plan walk** (not due yet), **Resume**, **Summary**, or **Review** (a Field walk came back) | |

A row sits under the day the house next turns: the checkout day, when the crew cleans, and otherwise the arrival day. A clean that is due and not confirmed moves to **Today**, whatever its dates.

## The strip

Above the rows, a count of each state that wants a person (No cleaner booked, Cleaner after check-in, Cleaner before checkout, Clean not confirmed, Cleaning now, Walking, Needs walk), in the same words as the rows. Each count jumps to the first row showing it.

## Opening a row

Tap the house name. The open row names who is **Leaving** and who is **Arriving**, then the stages:

- On a home with a smart lock, the **six-stage rail**: Checked out, Cleaner in, Cleaning, Cleaned, Walked, Guest-ready. The lock tells Helm when the cleaner's code (2222) opens the door.
- On every other home, three steps: **Out**, **Cleaned**, **Walked**. Helm learns the clean when the cleaner texts the 24/7 line, or when you press **Mark cleaned**, then **Confirm**.

Below the stages: **+ Plan walk** (a date and a person), the prep slips for this stay, the home's open slips to print, the Field packet, **Mark ready** (closes a turnover you handled another way; **Undo ready** reopens it) and **Checkout schedule**, the same checkout on the schedule, where its time or date moves. Walked and ready rows fold under **Done** at the bottom.

## Around the board

- **The checkout schedule** (Schedule tab) is the list the cleaners are texted. Each of its rows opens to **On the board** and comes back here. See [The cleaner schedule, the daily digest and Rosa's page](/playbook/cleaner-schedule-and-the-daily-digest).
- **From Cape Ann Elite** (the link under the board) holds only what no row can show: a visit booked where nobody checks out, and days they have not announced yet. On the home page, each **Cleanings to check** flag opens its house's row here.
- **Walk a home now**, under the list, starts a walk with no check-in behind it.
- A Field packet covering a walk: see [Field packets, from publish to pay](/playbook/field-packets-from-publish-to-pay).$md$
where e.slug = 'turnovers-and-the-cleaning-lifecycle'
  and e.body_md = (
    select r.body_md
    from public.playbook_revisions r
    where r.entry_id = e.id and r.change_note = 'Initial version'
    order by r.created_at
    limit 1
  );

-- Snapshot the rewrite as a revision, once.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select id, title, body_md, 'The board, one line per house per day', 'dotti@risingtidestr.com'
from public.playbook_entries
where slug = 'turnovers-and-the-cleaning-lifecycle'
  and body_md like '%one line each%'
  and not exists (
    select 1 from public.playbook_revisions r
    where r.entry_id = public.playbook_entries.id
      and r.change_note = 'The board, one line per house per day'
  );
