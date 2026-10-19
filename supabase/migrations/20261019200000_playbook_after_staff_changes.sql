-- Playbook: three published entries, brought up to date with the
-- 2026-10-19 changes. The first staff hire learns from these, and Ask Helm
-- reads them.
--
--   field-packets-from-publish-to-pay   staff send a packet back, invite
--                                       applicants and run the roster
--                                       (#2002); trades are paid Fridays
--                                       (#2004)
--   the-four-messaging-queues           a card's wait line names only what
--                                       needs a person (#1988); Stripe lookup
--                                       on a guest card for every login (#2003)
--   the-three-quo-lines                 the CRM is called Contacts (#2001)
--
-- Each edit is a replace() of whole sentences, not a new body, so the rest
-- of an entry stays exactly as it reads. An entry changes only while every
-- sentence it replaces is still there word for word, so an entry reworded in
-- the app since 2026-10-18 is left alone, and a second run changes nothing.
-- Each changed entry is snapshotted as a revision once.

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = replace(replace(replace(replace(e.body_md,
    $o$- **Paid**: Ryan recorded the payment; the contractor gets a receipt email.$o$,
    $n$- **Paid**: Ryan recorded the payment; the contractor gets a receipt email. Trades are paid Fridays: a trip approved by Wednesday is paid that Friday, and the portal shows each approved trip's payday. Creative is paid monthly.$n$),
    $o$- **Send back for changes** returns a submitted packet to in progress with a note to the contractor. It sits beside Approve.$o$,
    $n$- **Send back for changes** returns a submitted packet to in progress with a note to the contractor. Anyone on the team can send one back.$n$),
    $o$The decision and the pay stay with Ryan: Approve, Send back for changes, Final pay, Bonus, Raise pay and Mark paid are owner actions, and a staff login does not see the pay figures. Staff build, publish, assign and release.$o$,
    $n$The decision and the pay stay with Ryan: Approve, Final pay, Bonus, Raise pay and Mark paid are owner actions, and a staff login does not see the pay figures. Staff build, publish, assign, release and send back for changes.

## The roster

On **Roster**, anyone on the team invites or declines an applicant, records a **Background** check, can **Pause** and **Reactivate** a contractor, grants the **property board**, and can **Resend invite**. Pay, the W-9, **Rotate link**, **Retire** and bringing back a retired contractor stay with the owners.$n$),
    $o$under **Applicants** at the top of **Roster**, where an owner invites them.$o$,
    $n$under **Applicants** at the top of **Roster**, where anyone on the team can invite them.$n$)
where e.slug = 'field-packets-from-publish-to-pay'
  and strpos(e.body_md, $o$- **Paid**: Ryan recorded the payment; the contractor gets a receipt email.$o$) > 0
  and strpos(e.body_md, $o$- **Send back for changes** returns a submitted packet to in progress with a note to the contractor. It sits beside Approve.$o$) > 0
  and strpos(e.body_md, $o$The decision and the pay stay with Ryan: Approve, Send back for changes, Final pay, Bonus, Raise pay and Mark paid are owner actions, and a staff login does not see the pay figures. Staff build, publish, assign and release.$o$) > 0
  and strpos(e.body_md, $o$under **Applicants** at the top of **Roster**, where an owner invites them.$o$) > 0;

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = replace(replace(e.body_md,
    $o$A card that is waiting on something says why in one line under its header, such as a send that failed and will try again.$o$,
    $n$A card that is waiting on something says why in one line under its header: a send that failed, or a guest who wrote again after the draft.$n$),
    $o$approving the guest card files the note as a waiting card on the **Team** tab, where it needs its own approve. Nothing reaches the crew unattended.$o$,
    $n$approving the guest card files the note as a waiting card on the **Team** tab, where it needs its own approve. Nothing reaches the crew unattended.

On a guest card, **Stripe lookup** opens the stay's payment in the home's own Stripe account: whether the guest paid, and how much.$n$)
where e.slug = 'the-four-messaging-queues'
  and strpos(e.body_md, $o$A card that is waiting on something says why in one line under its header, such as a send that failed and will try again.$o$) > 0
  and strpos(e.body_md, $o$approving the guest card files the note as a waiting card on the **Team** tab, where it needs its own approve. Nothing reaches the crew unattended.$o$) > 0;

update public.playbook_entries e
set
  updated_by_email = 'dotti@risingtidestr.com',
  updated_at = now(),
  body_md = replace(e.body_md,
    $o$- Every completed call shows in the caller's **Activity** on their CRM record.$o$,
    $n$- Every completed call shows in the caller's **Activity** on their record in **Contacts**.$n$)
where e.slug = 'the-three-quo-lines'
  and strpos(e.body_md, $o$- Every completed call shows in the caller's **Activity** on their CRM record.$o$) > 0;

-- Snapshot each changed entry as a revision, once. An entry left alone still
-- equals its latest revision, so it gets none.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select e.id, e.title, e.body_md, 'Matches the app after the 2026-10-19 changes', 'dotti@risingtidestr.com'
from public.playbook_entries e
where e.slug in (
    'field-packets-from-publish-to-pay',
    'the-four-messaging-queues',
    'the-three-quo-lines'
  )
  and not exists (
    select 1 from public.playbook_revisions r
    where r.entry_id = e.id and r.body_md = e.body_md
  );
