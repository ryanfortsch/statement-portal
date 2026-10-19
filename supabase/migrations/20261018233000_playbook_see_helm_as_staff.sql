-- Playbook: "See Helm as staff". The avatar menu now carries View as staff
-- (2026-10-18), so an owner can walk the staff view before the first staff
-- hire signs in. This entry says the switch exists and what it does.
--
-- Additive and idempotent: a new slug, never an update to an existing entry.

insert into public.playbook_entries (slug, title, category, summary, body_md, tags, status, pinned, created_by_email)
values
(
  'see-helm-as-staff',
  'See Helm as staff',
  'general',
  'An owner can walk Helm exactly as a staff login sees it, and come straight back, from the menu under your initial.',
  $md$A staff login sees operations and not money: no statements, books, forecast, revenue or payments, no contracts, prospects or owner messaging, no guest quotes or creative pay. **View as staff** lets an owner check that view without a second account.

## Switching

1. Click your initial at the top right of any page.
2. Choose **View as staff**. The page loads again as a staff login sees it.
3. A dark strip under the masthead says **Viewing Helm as staff** on every page. Click **Back to owner view** in the strip, or in the same menu, to return.

## What changes

- The masthead, the section tabs, the home feed and Ask Helm are the staff ones, and owner money on the pages staff keep is hidden.
- An owner page (Statements, Books, the Forecast and the rest) lands on **This part of Helm is for the owners**, as it does for staff. **Back to owner view** from there takes you to the page you asked for.
- Owner actions are refused, as they are for staff. Switch back to do owner work.

## What does not change

- You are still signed in as yourself. Work assigned to you, meetings you logged and anything you save stay yours.
- It lasts until you switch back or close the browser, and only in this browser.
- It only ever takes an owner down to staff. A staff login has no switch and gains nothing from it.
$md$,
  array['helm','staff','access','owners'],
  'published',
  false,
  'dotti@risingtidestr.com'
)
on conflict (slug) do nothing;
