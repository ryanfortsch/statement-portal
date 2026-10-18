-- Playbook: "Import guest contacts from a CSV". The column map used to print
-- on its own /guests/import page; the import is now a file input under
-- Contacts' Manage list menu (2026-10-18), and the reference moves here,
-- where the menu's "Columns" link points.
--
-- Additive and idempotent: a new slug, never an update to an existing entry.

insert into public.playbook_entries (slug, title, category, summary, body_md, tags, status, pinned, created_by_email)
values
(
  'import-guest-contacts-from-a-csv',
  'Import guest contacts from a CSV',
  'guests',
  'Bring a Squarespace Profiles export into the guest list: where the import lives, which columns Helm reads, and what it does with each one.',
  $md$The guest list behind The Weekly and the Insider List lives on **Growth, Contacts**. Guesty keeps it current on its own: Helm syncs guest emails from Guesty every morning, and **Manage list, Sync from Guesty** runs the same sync now.

A CSV import is for a list that came from somewhere else, almost always a **Squarespace Profiles** export from before the move.

## Importing

1. On **Contacts**, open **Manage list**.
2. Under **Import a CSV**, pick the file and press **Import**.
3. The menu says how many contacts it imported, and how many rows it could not read.

A contact who is already on the list is matched by email and updated, never duplicated. Importing the same file twice is safe.

## The columns Helm reads

- **Email**: the key. Lowercased; a row with no email is skipped.
- **First Name** and **Last Name**: the contact's name.
- **Subscriber Since**: when they joined. Falls back to **Created On** when empty.
- **Subscriber Source**: kept as written, as the contact's source note.
- **Mailing Lists**: split on commas; each list becomes a tag.
- **Accepts Marketing**: true makes the contact subscribed, false unsubscribed. Unsubscribed people are still imported so the history is kept, and no campaign reaches them.

Every other column is ignored.

## Two things it does on its own

- A Booking.com relay address (the long `@guest.booking.com` kind) is tagged so the Insider List and Weekly Subscribers audiences skip it.
- The import is logged once, with who ran it and how many rows went in.
$md$,
  array['guests','contacts','import','squarespace'],
  'published',
  false,
  'dotti@risingtidestr.com'
)
on conflict (slug) do nothing;
