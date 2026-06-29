-- Playbook: add the "Create a new listing in Guesty" SOP. This is the listing-
-- creation step of onboarding (nickname, title, address, photo archival) and is
-- deliberately a separate, focused entry from "Onboard a new property", which
-- scopes itself to the money path (Chase -> Stripe -> link Stripe in Guesty).
-- The two cross-link so either entry leads to the other.

insert into public.playbook_entries (slug, title, category, summary, body_md, tags, status, pinned, created_by_email)
values
(
  'create-a-new-listing-in-guesty',
  'Create a new listing in Guesty',
  'onboarding',
  'Add a property as a Guesty listing: set the nickname and title, enter the address, and archive the photos to Google Drive before they go up.',
  $md$Every property starts as a listing in Guesty. This is the first thing you do when standing up a new property, before the money path (Chase, Stripe, then linking Stripe in Guesty). The running example here is **84 Thatcher Road**.

## 1. Start the listing

Guesty, **Listings**, then **Add new listing** (the button in the top right).

## 2. Nickname (our internal name)

The nickname is our internal name: **street number plus street name, with no suffix** (no St, Ave, Rd, or Ln). 84 Thatcher Road becomes **84 Thatcher**. This is the name the team uses everywhere internally, so get it right here.

## 3. Title (what guests see)

The title is the guest-facing listing name. The format is **"Stay at" plus the closest iconic landmark**. 84 Thatcher Road sits by Good Harbor Beach, so the title is **Stay at Good Harbor Beach**. It is fine if other listings already share a similar "Stay at ..." name. Pick the landmark that fits the property; duplicates are okay.

## 4. Address

Enter the full street address.

## 5. Photos: archive first, then upload

Photographers drop a property's photos into **Dropbox**. Before you upload anything to Guesty, archive them to the company's canonical home so we always own a copy:

1. Open the Rising Tide **Google Drive**, then **Marketing**, then **Photographs and Video**.
2. Create a new folder for the listing, named with the internal name (for 84 Thatcher Road, the folder is **84 Thatcher**).
3. Download the property's photos from Dropbox.
4. Move them into the Google Drive folder you just created.
5. Now upload those photos from there to the Guesty listing.

## Definition of done

- The listing exists in Guesty with the nickname, title, and address set.
- The photos are archived in Google Drive (Marketing, Photographs and Video, then the internal-name folder) and uploaded to the Guesty listing.
- Continue with the money path: see [Onboard a new property](/playbook/onboard-a-new-property) for the Chase, Stripe, and link-Stripe-in-Guesty steps.$md$,
  array['guesty','listings','photos','onboarding','dropbox','google-drive'],
  'published',
  false,
  'dotti@risingtidestr.com'
)
on conflict (slug) do nothing;

-- Seed an initial revision so the history panel reads correctly from the first save.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select id, title, body_md, 'Initial version', created_by_email
from public.playbook_entries
where slug = 'create-a-new-listing-in-guesty'
  and not exists (
    select 1 from public.playbook_revisions r where r.entry_id = public.playbook_entries.id
  );

-- Reciprocal cross-link: point "Onboard a new property" at the listing-creation
-- entry as its first step. Append-only and guarded so it is idempotent and never
-- clobbers a later in-app edit (it only runs while the link is absent).
update public.playbook_entries
set body_md = body_md || E'\n\nBefore the money path above, the property needs a Guesty listing. See [Create a new listing in Guesty](/playbook/create-a-new-listing-in-guesty) for the nickname, title, address, and photo steps.'
where slug = 'onboard-a-new-property'
  and body_md not like '%create-a-new-listing-in-guesty%';

-- Snapshot that cross-link edit as a revision, once.
insert into public.playbook_revisions (entry_id, title, body_md, change_note, by_email)
select id, title, body_md, 'Linked to: Create a new listing in Guesty', 'dotti@risingtidestr.com'
from public.playbook_entries
where slug = 'onboard-a-new-property'
  and body_md like '%create-a-new-listing-in-guesty%'
  and not exists (
    select 1 from public.playbook_revisions r
    where r.entry_id = public.playbook_entries.id
      and r.change_note = 'Linked to: Create a new listing in Guesty'
  );
