# C1: Properties, the fleet list and the property detail page

Audited 2026-10-17 against `claude/helm-ui-ux-audit-7760d6` (HEAD b0c9e8b4). Read in full: `src/app/properties/page.tsx` and its 4 siblings, `src/app/properties/[id]/page.tsx` (2,941 lines) and all 39 siblings, the 8 sub-route pages named in the brief with their editors, all 10 files in `src/components/properties/`, `src/lib/helm-access.ts`, the properties block of `src/lib/helm-modules.ts`, `src/lib/property-flags-load.ts`, the capture catalog, and the responsive rules in `globals.css`. The September rebuild (four tabs plus Setup, header band, question-shaped Facts groups, one capture box, inline fact editing) is taken as given; nothing below re-proposes it. Line numbers are from this checkout.

The short version: the rebuild fixed where things live. What it did not fix is how many ways there are to change the same fact, how many closed folds stand between a phone in a driveway and the trash day, and how the staff role was threaded through with `owner &&` at eleven sites and missed six.

---

## Pages

### /properties

**Purpose.** The roster: every home we manage, on a map and in a list, with how much open work each one carries, and a way into each record.

**Entry points.** Masthead tab "Properties" (`helm-modules.ts:313`, `primary: true`). Cmd+K. The "← All Properties" link at the top of every detail page (`[id]/page.tsx:755`). Home-feed and work-board links go straight to detail pages, not here.

**Inventory, top to bottom.**
- `HelmHero`: eyebrow "Helm · Properties", headline "All Rising Tide properties.", description "N active, M prospects, K inactive. Helm-native data." (`page.tsx:95-108`).
- `PropertiesTabBar`: Properties | Prospects | Onboarding | Contracts (`PropertiesTabBar.tsx:10-15`).
- Two 12px text links: "Stay Cape Ann listing copy →", "Bedroom photos →" (`page.tsx:117-128`).
- The map: 420px (280px on phones, `globals.css:637`), CARTO tiles, Leaflet loaded from unpkg at runtime, wheel zoom off, zoom control bottom-right, Beverly deliberately off the initial frame (`PropertiesMap.tsx:31-40, 111-119`). Click a pin for a card: city eyebrow, name, address, owner last name, "N slips · N owner", "Open →".
- The list: one row per active property. Number, name (24px serif), subtitle (external title or address), a chip cluster, owner last name, and a right label that is `25% →` for an owner login and `Managed →` for staff (`page.tsx:345`). Chips: `N owner` (solid signal), `setup 3/18` or `ready` (readiness, only while not live), `N slips` (outline). Inactive rows follow under "Prospects, HQ & inactive" at 50% opacity.
- Error block and empty block.

Controls: 4 tab links, 2 text links, 1 map (zoom +/-, pin click, card link), N row links. No search, no filter, no sort. Zero buttons.

**New-hire friction.**
- The three chips are the only dynamic information on the row and all three are jargon with hover-only definitions: `2 owner` means "two open work slips flagged for owner input" (`page.tsx:278`), `5 slips` means five open work slips (`:313`), `setup 3/18` means three of eighteen launch steps done (`:297`). A phone never sees a `title` attribute.
- "Helm-native data." in the hero (`:96`) and the empty state telling the reader to "Run the migration at `supabase/migrations/20260430_create_properties.sql` in Helm's Supabase SQL Editor" (`:384-385`) are developer sentences on an operator page.
- The whole row is the link; the only affordance is the `→` on the far right. Fine on desktop, but on a phone the right label drops to its own grid cell (`globals.css:1151-1156`) and reads as a status word, not a link.
- The two tool links above the map are styled as plain 12px text with no border; they are the only entry to two whole modules (both are `hidden: true` in the registry, `helm-modules.ts:332, 346`).
- Loading state: if unpkg is unreachable the map shows "Loading map…" forever; there is no timeout and no fallback (`PropertiesMap.tsx:174-177, 216-233`).
- The tab bar's "Onboarding" tab and the list's readiness chip answer the same question in two places.

**Overlap.** Open-slip counts also appear on `/work` and on each property's header band. The readiness chip duplicates `/properties/onboarding`. The map card's "N slips · N owner" duplicates the row below it.

**Owner vs staff.** The fee is correctly hidden (`:345`). But `PropertiesTabBar` is not role-aware: a staff login sees "Prospects" and "Contracts", both of which the proxy bounces to `/not-available` (`helm-access.ts:72-73`). Two of the four tabs on the staff roster are dead. The same bar is rendered on `/properties/onboarding` (`onboarding/page.tsx:112`), so the dead tabs follow staff there.

**Proposals.**
1. (S) The staff tab bar shows Properties and Onboarding only; Prospects and Contracts render for owners. Pass the role into `PropertiesTabBar`.
2. (S) Chips say what they are: "2 waiting on owner", "5 open", "setup 3 of 18". Drop the hover titles.
3. (S) Replace "Helm-native data." and the migration-path empty state with nothing and "No properties yet." respectively.
4. (S) The two tool links become one quiet "Tools" row with borders, or move to the More menu; either way they stop looking like body text.

---

### /properties/[id]

**Purpose.** Everything about one house: who is in it, how to get in, what is open, what we know, who owns it, what the guest reads, and (while it is being set up) what is left to do.

**Entry points.** Every link from outside the route group is bare and lands on Now: `/work` (QueueClient.tsx:970, work/[id]/page.tsx:164), `/crm` (ContactDetail.tsx:282), `/statements` (page.tsx:1846, 2389), `/today` (page.tsx:147), `/turnovers/cleanings` (page.tsx:130), search (search/page.tsx:150, UniversalSearch.tsx:101), the home calendar (OccupancyCalendar.tsx:268), team activity (TeamActivity.tsx:324, 340), Ask Helm sources (ask/tools.ts:77-575). Forty-five `?tab=` deep links exist in `src` outside the page itself: `?tab=guest` 9, `?tab=facts` 9, `?tab=owner` 7, `?tab=guest#rates` 5, `#automations` 3, `#ops-notebook` 3, `?tab=setup` 2, `#notice-<id>` 2, and one each of `#listing`, `#home-guide-customize`, `#guest-placards`, `#guest-codes`, `?tab=documents`. The channels page and the cutover helper target Guest & listing anchors; the onboarding catalog targets `/edit#anchor`, `?tab=owner`, `?tab=facts` and the five tool pages (`onboarding-catalog.ts:211-947`).

**Inventory.**

*Above the tabs (identical on every tab).*
- "← All Properties" (`page.tsx:755`).
- Hero: eyebrow "Property", name at 44px, "external title · address, city", an Inactive badge when deactivated (`:773-810`).
- Header band (`PropertyMasthead.tsx`): live-state row with In the house / Next arrival / Next checkout / Last walked / Open work / Season; hot-facts rail with Guest code / Wi-Fi / Key-lockbox / Cleaner / Owner, each with a copy glyph `⧉`; an alert lane of up to five chips (SCA demo mode, fee mismatch, no live contract, notice window, permit expiry, stale SCA snapshot; `page.tsx:526-585`).
- Multi-month bookings: a bordered list of 30+ night stays spanning a month boundary, each with "$X net", "Dismiss" / "Restore", and "Split into installments" / "Edit split" opening `InstallmentEditor` (`MultiMonthBookingsSection.tsx:183-344`). Renders for everyone.
- The tab strip, sticky under the masthead: Now (badge: open slips), Facts, Owner & money (badge: CRM contact count), Guest & listing (badge: sends awaiting approval), Setup (badge `n/108`, only while `!(activated_at || firstStayStarted)`; `page.tsx:846-862`).

*Now.*
- Quick capture: explainer line, 2-row textarea with a mic, "Process with Helm", "Read as a room-by-room walk" (appears once there is text), "Listening…". Review phase: one card per routed item with a checkbox, a confidence dot, a destination chip such as "Utilities · Wi-Fi name" or "Internal note", an inline input, "Replaces current value: …", a high-stakes warning, "Make this a note instead", a Guest/Internal toggle, "from: '…'". Then "Apply N changes", "Back to edit", "Start over". Done phase: "Filed. 2 fields updated, 1 note added." and "Capture another" (`QuickCapture.tsx:401-611`). A walk hands off to `WalkthroughCapture` with its own review grouped by room, "Apply to the property", "Back".
- Action row: "Launch checklist 12/18 →" chip, rendered on every home including established ones (`page.tsx:869-891`).
- "Flagged at the house": open rows from two tables, each with a "Walk" or "Note" pill, an optional "Guest KB" pill, text, author, date, "Resolve" (`:901-988`). Capped at 12 with "showing 12".
- "Open Work": eyebrow counts ("7 open · 2 to bring · 3 this visit · 1 owner"), "+ New slip" (modal: Title, Category, Priority, Location, Scheduled date, Assignee, Description, Cancel / Create Work Slip), "Draft Owner Email", "Print →". Then the brief (lead word + clause per bullet, "Brief as of Oct 16, 9:04 PM"), then lanes: Needs restock as chips, This visit, Handyman run, Licensed pro or vendor, Owner to purchase or decide, Office follow-through as a one-line list. Each row: dot, title · detail, status chips, "Done" (two-tap) (`OpenWorkSection.tsx`).
- "Activity" (closed): 5 rows, "Full activity →".
- "Recent Inspections" (closed): "Plan a walk" → `/turnovers?property=`, rows → summary or resume.

*Facts.*
- Four launcher tiles: "Edit operational data" → `/edit`, "Channels" → `/channels/<id>` (status "Helm ✓" or "Guesty"), "Inspection layout" → `/layout`, "Fill blanks from Guesty" with a "Backfill from integrations" button and a result panel (`page.tsx:1218-1261`).
- Eight collapsibles, every one closed by default: Rental season (form), Climate automation (form, "Run now"), Guest door codes (Sync Seam devices, map a lock, "Issue test code (3 hrs)", codes on the lock with "Remove", upcoming stays with "Issue code" / "Revoke"), House policy (9 rows, blanks link to the form), Who serves this house, Operations notebook ("+ Add note" in the header; rows link to the edit page), The fact sheet (seven sub-collapsibles, also closed: Entry and credentials, Connectivity, House and systems, Trash parking and civic, Safety and permits, Emergency contact, Listing; each with "Edit these →" and "Add →" inline fields on blanks), Reference (12 IDs and dates, a paragraph about Perfection, "Open Perfection ↗").
- Between them, on an established home: "Setup is complete for 21 Horton. Open the launch checklist to review the 95 of 108 items on record." (`:1525-1538`).

*Owner & money.*
- "Owner" (open): a stat strip (Mgmt Fee, Cleaning Est, Bank, Owner; the first and third owner-only), "Edit owner info", a 2-column dl (Owner, Greeting, Emails, Phone, Mailing address, Preferred contact, Last contacted with an "I reached out" picker, Tax Cert ID with an inline Edit), "X also has" chips, "Additional owner contacts" (`OwnersEditor`: + Add contact, cards, Save owners, Discard changes), "Owner onboarding intake" (Generate onboarding link, Copy link, Preview ↗, ✉ Draft email to owner, a preview modal with Create Gmail draft / Copy instead / Cancel).
- "Contacts" (closed): CRM cards with "Full record →" and recent touches.
- "Management Agreement" (owner-only; open when something needs attention): parties, term, renewal, fee, negotiated terms, "Signed PDF ↗", "Contract page", "All contracts", "Draft renewal"; or the no-contract arm with "Draft renewal contract", "Contract workroom", "View contract ↗".
- "Documents" (closed): "+ Add document" reveals Label / Category / File / Upload; rows with "Open ↗" and a two-tap "Delete".
- "Recent Statements" (owner-only, closed): rows to `/statements/render`.

*Guest & listing.*
- Four or five launcher tiles: Draft listing, Caption photos, Sync to Guesty, Stay Cape Ann (status "Live ✓" / "Demo mode" / "Live, stale" / "In review"), Bedroom photos (`:2113-2171`).
- "Rates & taxes" (closed): a banner, the rate plan form (25 fields in six groups, "Save rate plan"), the tax form (9 fields, "Save tax config"), a day-overrides strip of five stat cells, a "Write a season" form (8 fields plus weekdays, "Write season"), "Clear overrides" (2 fields, "Clear range"), a quote tester (4 fields, "Price it", a breakdown).
- "Listing" (closed): a banner, the content form (8 textareas, 6 facts, the amenity catalog as checkboxes, Other amenities, Not included, "Save listing"), Rooms and beds (`RoomsEditor`), Photos (cards with ↑ ↓ Make hero Save Remove; Upload to gallery; Add by URL).
- "Automations" (closed): explainer, the switch ("Turn on" / "Turn off"), four readiness dots, "Send a test to [phone]", "Add a rule for this home" (form: 10 fields, channel exclusions, "Save for this home"), one card per rule with up to six buttons (Silence here, Require approval, Mark configured in Airbnb, Override for this home, Test, Remove override), the send log with Approve and send / Skip / Copy text / Mark pasted / Open in Airbnb / Skip this one / Show N past rows, a Merge fields fold.
- "Guest Deliverables" (closed; "+ New notice" in the header): an explainer, tiles for Welcome Guide (Open ↗ / Download PDF / Customize), Welcome Card, Wi-Fi Placard, Information Note (Gloucester), Trash Day Notice (Gloucester; Open ↗ / Download PDF / Whole fleet), then a `<details>` "Customize home guide" (4 fixed textareas, 2 picker slots each with Type / Custom title / Body, "Save changes"), then "Guest placards" with a second "+ New notice" and notice cards (Open ↗ / Download PDF / Edit).

*Setup (conditional).*
- "Walking the house? Dictate it into the capture box on Today." (`:1091-1100`).
- Eight stage collapsibles (Owner & deal, Financial rails, Compliance & safety, The home room by room [open, hosts `RoomsEditor`], Access & connectivity, Services & staffing, Inventory & outfitting, Listing & channels), each with a blurb and rows: title, "Open →", description and why, note, "✓ Auto" or Done / N/A toggles. 108 items.
- "Go-live gates" (closed): a paragraph and "Open launch checklist →".

Totals on a home in setup: 28 top-level collapsibles plus 8 nested, of which 2 are open by default (Owner, the room-by-room stage) and one conditionally (Management Agreement). Roughly 110 buttons and 140 form fields are reachable on the page without leaving it, nearly all inside closed folds.

**New-hire friction.**

*What the field asks, and how far it is.* From a bare link the page lands on Now. From there:
- Door code: 0 taps when a stay PIN or a Helm-named code exists, with copy. Otherwise "No code issued →" to Facts#guest-codes (1 tap, section auto-opens).
- Wi-Fi, key/lockbox location: 0 taps, with copy.
- Cleaner and number: 0 taps when `cleaner_phones` has a mapping. Otherwise "No cleaner mapped →" sends you to `/turnovers/schedule` (`PropertyMasthead.tsx:315`, `page.tsx:1370`), where there is no mapping control; there is no writer of `cleaner_phones` anywhere in `src` (grep: only `api/sync-quo/route.ts` reads it). The errand cannot be done in Helm.
- Who the owner is: 0 taps for an owner login. For staff, see Owner vs staff: often wrong.
- What is open: the count is 0 taps but its link 404s (`PropertyMasthead.tsx:264` → `/properties/<id>/work-slips`; only `work-slips/print/` exists). The list is a scroll down Now, under the capture box and the flags.
- Trash day, parking, gate or garage code, the arrival brief for crews: 3 taps (Facts, then The fact sheet, then the sub-group), and none of them is on the band. Trash day is also readable, three taps deep, inside Guest & listing > Guest Deliverables > the Trash Day Notice tile text (`page.tsx:2356-2362`), which is a strange place to go to learn it.
- Checkout time, pets, quiet hours: 2 taps (Facts, House policy), but see the three-stores problem below for which answer you get.

*Eight ways to change a fact, and no sign saying which.* Counted on this page alone: the edit form (`/edit`, 9 groups, ~76 fields); the inline "Add →" on the fact sheet, which only renders when the value is blank (`page.tsx:2821-2845`), so it fills but never corrects, despite `InlineField.tsx:33` saying "fills a blank or corrects a value"; Quick capture; Walk the house; the note form; Setup's Done / N/A toggles and `RoomsEditor`; Backfill from integrations (Guesty into Helm); Sync to Guesty (Helm into Guesty); plus the rate plan, tax, listing, climate, rental-season, door-code, owners, and home-guide forms. Nothing on the page says "to fix a wrong Wi-Fi password, go here". The tile copy that comes closest, "Wi-Fi, utilities, access, emergency contact, safety gear: the fields every deliverable and checklist on this page draws from" (`:1223`), is a description of the form, not a rule.

*Three vocabularies for the same fifty columns.* The edit form groups them as 01 Owner contact, 02 Property specs, 03 Utilities, 04 STR setup, 05 Property access & notes, 06 Emergency contact, 07 Inspection & safety, 08 House policy, 09 Billing (`edit/page.tsx:95-350`). Facts groups them as Entry and credentials, Connectivity, House and systems, Trash parking and civic, Safety and permits, Emergency contact, Listing (`page.tsx:2763-2769`). The capture review chip uses the catalog's sections: Utilities, Access & codes, Specs, STR setup, Inspection & safety, Owner contact (`property-capture-catalog.ts:33-92`). So the Wi-Fi password is "Connectivity" on Facts, "03 Utilities" on the form, and "Utilities · Wi-Fi password" in the capture review; the trash day is "Trash, parking and civic" on Facts, "07 Inspection & safety" on the form, and "Inspection & safety · Trash day" in capture. The page comment at `:2761-2762` admits the mismatch ("Linked at the larger half").

*Three stores for one policy.* "House rules" exists on `properties.house_rules` (Facts > House policy, form group 08), on `property_rate_plans.house_rules` ("the policy copy; the guest-facing listing text lives in the Listing section", `RatesPanel.tsx:216`), and on `property_listing_content.house_rules` ("the guest-facing text; the policy copy lives on Rates & taxes", `ListingPanel.tsx:112`). The House policy row has no hint at all. Checkout time, quiet hours, pets, max occupancy and cancellation each exist on both `properties` and the rate plan. Check-in exists three times: `default_checkin_time` is the cleaner's deadline (correctly labelled "Turnover deadline", `page.tsx:1321`), the rate plan's `checkin_time` is the guest's (`RatesPanel.tsx:189`), and the climate profile has its own `checkin_hour` (`ClimatePanel.tsx:130`). Bedrooms and bathrooms exist on `properties`, on the listing record, and as a count of `property_rooms`. The owner exists three times: the Owner block, "Additional owner contacts", and "Contacts" (the September note planned "three duplicate owner stores collapsed to one roster"; the page still renders all three, `page.tsx:1596-1807`).

*Note versus notice versus flag versus capture versus walk.* A "note" is a `property_notes` row (internal or guest-facing). A "notice" is a 4 x 6 printed placard. A "flag" is an open note or an open inspection note, shown on Now. A "capture" is the AI box that files notes or fields. A "walk" is either a field inspection (`Recent Inspections`, "Plan a walk", the "Walk" pill) or the room-by-room dictation ("Walk the house", "Read as a room-by-room walk"). The notes/new page is the only place the difference between note and notice is written down (`notes/new/page.tsx:53-57`), and it still says notes "only show on this page" when guest-facing ones feed the guest AI.

*One verb, two meanings.* Every open note is listed under "Flagged at the house" with a "Resolve" button, including a permanent fact such as "Fireplace flue sticks open" (the example in `NoteEditorForm.tsx:34`). "Resolve" on a fact reads as "done", strikes it through in the notebook, and, if it was guest-facing, silently drops it from the guest knowledge base, because `/api/kb-facts` reads `resolved_at IS NULL` (`kb-facts/route.ts:117-120`). There is no un-resolve control anywhere: `ResolveFlagButton` always passes `true` (`ResolveFlagButton.tsx:51`) and the edit page offers only Save and Delete. A new hire tidying the Now tab will delete guest facts.

*Stale tab names in live copy.* "Edit operational data in the Operations tab to refresh" (`page.tsx:2238`), "Add where the carts live under Operations" (`:2361`), "Dictate it into the capture box on Today" (`:1097`), "Used as the card title in the Property Notes accordion" (`NoteEditorForm.tsx:27`). None of those tabs or headings exist.

*Developer vocabulary in operator copy.* `SEAM_API_KEY` and "set in Vercel" (`ClimatePanel.tsx:85-86`, `GuestCodesPanel.tsx:65`), "Editing that one means editing `src/lib/forecast-operating-windows.ts`" (`RentalSeasonPanel.tsx:105`), "Stored on Vercel Blob under listings/<id>/" and "the seed script" (`ListingPanel.tsx:399, 422`), "property_tax_config" and "occupancy-tax.ts" (`RatesPanel.tsx:97, 240, 485`), "The automations tables are not reachable from this environment (service role unset, or the migration has not run here)" (`AutomationsPanel.tsx:66`), "Guesty hid +6% here" (`RatesPanel.tsx:165`).

*Explainer paragraphs standing in for UI.* Nineteen counted: the capture intro, the walk intro, the walk review intro, the Setup "Walking the house?" line, every Setup stage blurb, "Go-live gates", "Setup is complete for…", the door-codes intro, the climate intro, the rental-season intro, the Reference/Perfection paragraph, the automations intro, the rates banner, the tax explainer, the listing banner, the deliverables intro, the placards intro, the owners-editor intro, and the onboarding-intake hint. Most say what the section is instead of showing it.

*Cmd+F.* Tabs hide panels with `hidden` (`PropertyTabs.tsx:189`); find-in-page reaches one tab in four or five. Within the active tab, native `<details>` lets Chrome auto-open a match, so Facts' closed folds are searchable but the other tabs are not.

*Launchers.* Facts opens on four tiles and Guest & listing on four or five, each a bordered card with an eyebrow, a title, a sentence, and "Open →"; none shows content from the page it leads to except the Channels and Stay Cape Ann status words. The Facts tiles push the first real section (Rental season) below the fold.

*Three doors to the launch checklist* on an established home: the Now action chip, the Facts footer line, and the Setup tab's "Go-live gates" (while Setup shows). Two "+ New notice" buttons inside one section (`page.tsx:2231, 2412`).

*Controls whose effect is unclear.* "Issue test code (3 hrs)" programs a physical lock. "Remove" on a code "set outside Helm" deletes a code someone else put on the door, with a 3-second two-tap and no explanation of what Helm will do to the lock (`GuestCodesPanel.tsx:189-208`). "Revoke" on an upcoming stay's code has no confirmation at all (`:235-242`). "Run now" changes a thermostat. "Clear range" wipes every price override in the range "Seeded PriceLabs days go too" with a plain submit (`RatesPanel.tsx:396-408`). "Approve and send" sends a guest a text in one click (`AutomationsPanel.tsx:498`). "Dismiss" on a multi-month suggestion is team-wide (`MultiMonthBookingsSection.tsx:121-129`). "I reached out" writes a timestamp and a channel and nothing else, and overwrites the last one (`PropertyActivity.tsx:379`). "Draft renewal" posts a form with no preview of what it creates.

*Density.* The Automations rule card shows up to seven badges and six buttons per rule. The rate plan is 25 fields; the listing form is 16 fields plus the whole amenity catalog. The Reference block lists twelve identifiers nobody acts on. The Owner block's stat strip and its dl both say the owner's last name.

*Mobile.* The 40px gutter drops to 16px under 640px (`globals.css:347`), the hero shrinks (`:418-420`), and the band's `auto-fit, minmax(150px)` grid becomes two columns, so a phone sees the hero, then six rows of band cells, then a sticky tab strip that wraps to two lines (five uppercase tabs at 11px, `PropertyTabs.tsx:131`), before any content. `CollapsibleSection` rows, the lane rows and the forms wrap acceptably. The `InstallmentEditor` and the onboarding-invite modal are the only true modals besides New slip.

*Silent state.* `?tab=setup` on an established home falls to Now with no message (`PropertyTabs.tsx:76`); `OrderChecklistClient.tsx:124, 144` link there. `?tab=documents` still works only through the alias table.

**Overlap.** Open work: `/work` board, the print sheet, the band, the list page. Inspections: `/turnovers`, `/inspections`. Contacts: `/crm`. Door codes: `/channels/<id>` automations preview, the Field packet. Rates: `/channels/calendar` (day overrides), `/guests/quotes`. Listing content: `/listing-copy`, `/caption-photos`, `/properties/listing-copy-studio`. Trash day: the fact sheet, the edit form, the Trash Day Notice tile, `/properties/trash-notices`. The launch checklist: Now chip, Facts line, Setup gates, `/launch`, `/properties/onboarding`, the list-page chip. Owner contract: this page, `/properties/contracts`, `/prospects/<id>`.

**Owner vs staff.** Correctly hidden from staff: the Mgmt Fee and Bank stats, owner emails, Tax Cert ID, the onboarding intake row, Management Agreement, Recent Statements, the fee-mismatch alert, the fee on the list page. Not hidden:
- Multi-month bookings print "$X net" per stay and offer "Split into installments" to staff (`page.tsx:844`, no role gate). The editor saves to `/api/installments`, which is owner-only (`helm-access.ts:115`), so a staff save ends in a 403 after the work of filling the split. The dismiss and restore server actions check no session at all (`installment-actions.ts:82-91`).
- Documents lists the auto-filed executed contract, fee terms included, with a "Contract" pill and "Open ↗" (`page.tsx:2051-2057`, `DocumentsPanel.tsx:235-243`).
- The "Operating with no live contract" and "Non-renewal notice closes …" alerts render for staff and link to `?tab=owner`, where the section they point at is owner-only (`page.tsx:548-563` vs `:1818`).
- "X also has" prospect chips link staff to `/prospects/<id>`, an owner path (`page.tsx:1738-1758`).
- The band's Owner fact: for staff, `ownerEmail` is passed as null (`page.tsx:832`), and `PropertyMasthead.tsx:178-183` picks email as the channel whenever preferred contact contains "email", so every email-preferring owner renders as "Add owner contact →" for staff even with a phone on file.
- Rates & taxes, including base nightly and the direct markup, are fully editable by staff (`rates-actions.ts:78-80` checks sign-in only), while `/guests/quotes` is owner-only "because guest pricing is set by the owners" (`helm-access.ts:77-78`).
- The tab is still called "Owner & money" for a login that is not allowed to see money.

**Proposals.**
1. (M) The band answers the driveway questions without a tap: add Trash day (resolved through `civic.ts`, with the day source), Parking, and Gate/garage code to the hot-facts rail, and make Open work link to the Now list anchor. Keep the rail to one row on desktop by dropping Season into the live-state row's existing slot.
2. (M) One policy store. The nine House policy columns on `properties` become the only home for checkout time, pets, quiet hours, max occupancy, cancellation and house rules; the rate plan and the listing record read them, and their duplicate fields leave those forms. Check-in time is one guest value plus one cleaner deadline, named as such on both.
3. (M) Facts opens readable. The fact sheet renders open with its seven groups as plain headed lists (no sub-folds), the launcher tiles become one 11px "Tools" line at the bottom, and the five operational panels (Rental season, Climate, Door codes, Who serves, Notebook) keep their folds. Inline "Edit →" on populated rows, not only "Add →" on blanks.
4. (M) Split notes into facts and issues. A note row gets a kind: a fact (no Resolve, lives in the notebook and the guest KB) or an issue (Resolve, lives on Now). The flags list shows only issues; the notebook shows facts; "Resolve" never touches the KB. Rename the notebook "What we know".
5. (S) Finish the staff pass: gate the multi-month section, the contract document, the two contract alerts, the prospect chips; pass the owner phone to the band regardless of preferred channel; retitle the tab "Owner" for staff.

---

### /properties/[id]/activity

**Purpose.** The audit log for one house: every slip, inspection, note and contact touch, filterable by kind and range.

**Entry points.** "Full activity →" in the Now tab's Activity peek (`PropertyActivity.tsx:132`). URL only otherwise.

**Inventory.** Breadcrumb, eyebrow "Activity", name, one sentence, two chip rows (All / Work / Inspections / Notes / Contact; 30 days / 90 days / 1 year / All), the list (max 250), "← Back to 21 Horton". 9 chip links, 0 buttons.

**Friction.** The breadcrumb reads "Properties / Properties / 21 Horton / Activity": `HelmBreadcrumb` prepends the Properties section crumb and the trail starts with Properties again (`activity/page.tsx:94-100` vs `HelmBreadcrumb.tsx:23-28`). Rows for notes have no link (`PropertyActivity.tsx:363-368`). Glyph legend (`+ ✓ z → ⚑ ◷ ✎ ✕ ☎`) is never explained. Otherwise this page is fine.

**Overlap.** The Now peek. `/work/<id>` and `/crm/<id>` histories.

**Owner vs staff.** Nothing owner-only.

**Proposals.** (S) Drop the leading Properties crumb from the trail. Fine beyond that.

---

### /properties/[id]/edit

**Purpose.** The long form for the house's stored facts: owner contact, specs, utilities, STR setup, access, emergency contact, safety, policy, billing.

**Entry points.** Facts tiles ("Edit operational data"), the seven "Edit these →" group links with `#anchor`, House policy blanks (`#times`, `#policy`), the band's "Add Wi-Fi" (`#wifi`) and "Add key location" (`#arrival`), the permit alert (`#permit`), the Owner block's "Edit owner info" and the Cleaning Est / Bank stats, 31 onboarding-catalog items, `/fieldwork/packets` (`packets/page.tsx:296`), `launch-readiness.ts:68`.

**Inventory.** Breadcrumb ("21 Horton / Edit operational data"), eyebrow, name, a three-sentence intro, nine numbered groups (01-09) of ~76 fields with italic hints, a draft-restore banner when a local draft differs, "Save changes" and "Cancel" at the bottom. Save redirects to `?tab=facts` or the allowlisted `return_tab` (`actions.ts:149-152`).

**Friction.**
- The page title says "operational data" and the breadcrumb says "Edit operational data", but group 01 is the owner's name and phone and group 09 is the bank account. The word "operational" is doing no work.
- "Leave a field blank to clear it" (`edit/page.tsx:88`) is the only place on the whole property surface where clearing a value is possible, and it is said once, in an intro paragraph.
- Hints carry rules the UI should enforce: "Yes / No", "email / phone / text", "Garage / Driveway / Street", "Smart Lock / Key Box / Other" are free-text fields with example values (`:105, 119, 120, 171, 183`). Preferred contact is parsed by the band with `.includes('email')` (`PropertyMasthead.tsx:179`), so "E-mail" would miss.
- The trash-day hint says "Auto-derived from address for Gloucester" (`:231`) but the form shows the stored column, not the derived day, so an empty field on a Gloucester home looks unset when the card and the kb-facts pipe already know Friday.
- "Edit owner info" from the detail page links to the top of the form, not `#owner` (`page.tsx:1630`).
- Group names are the form's own third vocabulary (see above).
- Mobile: rows are `auto-fit, minmax(200px)`, so a phone gets one field per row and roughly 76 rows; nothing wrong, just long. The form has no section jump list.

**Overlap.** The capture box and the inline fields write the same columns; Backfill fills six of them; `/properties/[id]/stay-cape-ann` and the onboarding intake form (`/onboarding/<token>`) write others.

**Owner vs staff.** Owner emails and bank last 4 are omitted for staff and preserved on a staff save (`:55-58, 100, 331`). Correct.

**Proposals.**
1. (S) Constrain the enumerated fields (preferred contact, guest access method, basement, smart TV, currently listed) to selects; delete the matching hints.
2. (S) Show the derived trash day as placeholder text in the Trash pickup day field, and show "Blank clears this field" as the field-level affordance (an inline "Clear" on populated fields) instead of a sentence in the intro.
3. (S) Rename the page and breadcrumb to "Edit 21 Horton"; use the Facts group names as the form's group names so the two vocabularies become one.

---

### /properties/[id]/layout

**Purpose.** Order, remove and add the cards a field inspection walks through at this house.

**Entry points.** Facts tile "Inspection layout". `/inspections` does not link here (grep: no `/layout` link outside the properties group). URL only otherwise.

**Inventory.** Breadcrumb ("21 Horton / Inspection layout"), eyebrow, name, a 3-sentence intro (plus a pullout-bed sentence), a sticky status bar ("12 cards" / "All changes saved" / "Standard layout, edit to customize" / "Saving…" / errors with "Retry saving"), the deck (grip, number, title, category or "Custom", description, ↑ ↓ ×), "+ Add a card" which opens "From the standard set" chips and "Write your own" (title, description, "Add card").

**Friction.**
- "Card", "deck", "standard set", "Custom" are inspection vocabulary that the page never ties to what an inspector sees on their phone. "Changes save automatically" is the right model but the intro is the only place it is said; the status bar carries it well once you notice it.
- Drag is grip-only; touch users rely on the arrows, which is fine.
- The breadcrumb's property crumb goes to `?tab=facts` (`layout/page.tsx:104`), which is where the tile is; consistent.
- The "Standard layout" status label at `LayoutEditor.tsx:183` is joined with an em dash, which the house style bans.

**Overlap.** The pullout-bed auto-card logic repeats on the edit form hint (`edit/page.tsx:135`).

**Owner vs staff.** Nothing owner-only. This is squarely the operations manager's page.

**Proposals.** (S) Replace the intro with a one-line "Cards run in this order on every walk" under the status bar. Otherwise fine.

---

### /properties/[id]/notes/new and /notes/[noteId]/edit

**Purpose.** Write down one thing we know about the house (internal, or guest-facing for the guest AI); edit or delete it later.

**Entry points.** "+ Add note" in the Operations notebook header, the notebook's empty-state link, every notebook row (edit), every "Note" flag's text (edit), `property-flags-load.ts:129`.

**Inventory.** New: breadcrumb, "New note.", a 3-sentence intro, Title (required), Body, Tag, a boxed checkbox "Guest-facing knowledge" with two sentences, "Create note" / "Cancel" (→ `?tab=facts`). Edit: the same form with "Save changes", a meta line, and "Permanently delete this note. Cannot be undone." with "Delete note" behind a `confirm()`.

**Friction.**
- The edit page cannot resolve or un-resolve; the only resolve control is on Now, and only while the note is open.
- "Tag: free-form category for filtering" promises a filter that exists nowhere (`NoteEditorForm.tsx:55`); the notebook has no filter.
- "Used as the card title in the Property Notes accordion" names a heading that no longer exists (`:27`).
- The intro says notes "only show on this page"; a guest-facing note is sent to the guest AI every 30 minutes.
- "Guest-facing knowledge" is the fourth name for the same bit (the capture box says "Guest" / "Internal", the flags list says "Guest KB", the notebook row says "Guest").
- A full page round-trip for a one-line note, when the capture box on Now files a note without leaving.

**Overlap.** Quick capture, Walk the house and the inspection app all write `property_notes` or `inspection_notes`.

**Owner vs staff.** Nothing owner-only.

**Proposals.** (S) Inline the note form inside the notebook section (title + body + guest toggle), keep the page only for edit/delete, and add Resolve / Reopen to the edit page. (S) One word for guest-facing everywhere: "Guest KB".

---

### /properties/[id]/notices/new and /notices/[noticeId]/edit

**Purpose.** Write a 4 x 6 Stay Cape Ann placard for one house-specific quirk; edit or delete it.

**Entry points.** Both "+ New notice" buttons in Guest Deliverables, "Edit" on each placard card.

**Inventory.** New: breadcrumb, "New notice.", a 2-sentence intro, Eyebrow, Title (required), Body (required), "Create notice" / "Cancel" (→ `?tab=guest`). Edit: the same with "Save changes", then "Danger zone" with a sentence and "Delete notice" behind `confirm()`.

**Friction.**
- "Eyebrow" is a typesetting term; the hint ("Short kicker that sits above the title") explains one jargon word with another (`NoticeEditorForm.tsx:28`).
- There is no preview. The body hint warns "anything longer overflows a 4 x 6 placard" (`:55`) but the only way to see it is to save, go back, and Open ↗.
- "Danger zone" is GitHub vocabulary on a placard editor.
- The edit page's breadcrumb goes to the bare property URL (lands on Now), the new page's to `?tab=guest` (`notices/[noticeId]/edit/page.tsx:47` vs `notices/new/page.tsx:44`).

**Overlap.** The trash-day card, the Wi-Fi placard and the welcome card are the same physical object made from data instead of prose.

**Owner vs staff.** Nothing owner-only.

**Proposals.** (S) Live preview beside the form (the renderer is a server component; render it from the form's current values on the client with the same CSS). (S) "Eyebrow" becomes "Small heading (optional)"; "Danger zone" becomes nothing.

---

### /properties/[id]/notice/[noticeId]

**Purpose.** The printable placard itself, public for Puppeteer, 384 x 576px navy frame and cream panel.

**Entry points.** "Open ↗" on a placard card, `/api/property-pdf`.

**Inventory.** One card. No controls.

**Friction.** None for the operator: it is a document. Opened in a tab from Helm it has no way back, which is right for a print surface. Fine.

---

## The cluster as a whole

### The five biggest structural problems

1. **The same fact has up to eight write paths, three vocabularies and three stores.** Eight ways in on one page (edit form, inline Add, Quick capture, Walk the house, note form, Setup toggles, Backfill, the domain forms); three group schemes for the same 50 columns (`edit/page.tsx:95-350`, `page.tsx:2763-2769`, `property-capture-catalog.ts:33-92`); three "House rules" (`page.tsx:1328`, `RatesPanel.tsx:216`, `ListingPanel.tsx:112`), three check-ins (`page.tsx:1321`, `RatesPanel.tsx:189`, `ClimatePanel.tsx:130`), three bedroom counts, three owner rosters (`page.tsx:1596-1807`). A new hire cannot know which one the cleaner schedule, the guest AI or staycapeann.com will read, and the hints that try to say so contradict each other.

2. **Facts is a wall of closed folds and the band is missing the field's questions.** Fifteen folds on Facts, zero open by default (`page.tsx:1263-1589`); trash day, parking, gate code and the arrival brief are three taps deep and absent from the band; the band's two most frequent errands are broken: "N slips →" 404s (`PropertyMasthead.tsx:264`) and "No cleaner mapped →" leads to a page with no mapping control and no writer of `cleaner_phones` exists (`:315`). "Last walked" goes to the wrong tab (`:247`).

3. **The staff role was threaded through with `owner &&` and misses six places.** Multi-month revenue and a split editor that ends in a 403 (`page.tsx:844`, `helm-access.ts:115`), the executed contract in Documents (`:2051`), two contract alerts pointing at a hidden section (`:548-563`), prospect chips to a bounced path (`:1738`), the email-preferring owner rendered as "Add owner contact →" (`:832`, `PropertyMasthead.tsx:178`), and the list page's two dead tabs (`PropertiesTabBar.tsx:10-15`). Staff can also edit pricing the access model reserves for owners (`rates-actions.ts`).

4. **"Note" means both a fact and an issue, and "Resolve" deletes guest knowledge.** One table feeds a queue (Flagged at the house) and a knowledge base (Operations notebook); the only verb is Resolve, there is no reopen, and resolving a guest-facing note removes it from `/api/kb-facts` (`kb-facts/route.ts:120`) with no warning (`ResolveFlagButton.tsx:38-61`). Around it sit five near-synonyms (note, notice, flag, capture, walk) with one definition on one sub-page.

5. **Guest & listing is a PMS console wearing a print-deliverables tab, written in developer vocabulary.** Rates (25 + 9 + 10 fields), Listing (16 + catalog), Automations (6 buttons per rule, a 10-field rule form, a send log) sit under one tab with the welcome card and the Wi-Fi placard; the copy names env vars, source files, tables and scripts (`ClimatePanel.tsx:85`, `RentalSeasonPanel.tsx:105`, `ListingPanel.tsx:399, 422`, `RatesPanel.tsx:97, 240, 485`, `AutomationsPanel.tsx:66`); and live copy still refers to the "Operations tab", "Today", and the "Property Notes accordion" (`page.tsx:1097, 2238, 2361`, `NoteEditorForm.tsx:27`).

### Vocabulary a new hire meets here

| Term | Meaning (from the code) | Defined in the UI? |
|---|---|---|
| slip, work slip | a `work_slips` row: one task at one house | No ("N slips", "+ New slip") |
| lane | derived bucket for a slip: Needs restock, This visit, Handyman run, Licensed pro or vendor, Owner to purchase or decide, Office follow-through (`work-slip-lanes.ts:35-42`) | Labels shown; the word "lane" never appears |
| brief | the nightly model-written bullets about a home's open work | "Brief as of …" only |
| owner (chip), owner action | a slip waiting on the owner to purchase/approve/schedule/decide/reimburse | Hover title only |
| flag | an open `property_notes` or `inspection_notes` row on Now | No |
| Walk / Note (pills) | source table of a flag: field inspection vs written note | No |
| note | `property_notes` row, internal or guest-facing | notes/new intro only |
| notice, placard | a 4 x 6 printed card | notices/new intro only |
| Guest KB, Guest-facing knowledge, Guest (pill), Guest/Internal (toggle) | the note is sent to the guest AI | Four names, one hint |
| capture, Quick capture | the AI box that routes text into fields and notes | Intro paragraph |
| walk, Walk the house | (a) a field inspection, (b) room-by-room dictation | No; both meanings used |
| fact sheet, Facts | the stored columns on `properties` and `property_access` | Tab name only |
| high-stakes | an entry column a cleaner follows (`isHighStakesColumn`) | Warning text at apply time |
| Launch checklist, go-live gates, Setup, readiness, "ready", `setup 3/18` | the 18-step launch list and the 108-item onboarding catalog | No; three doors |
| onboarding intake | the public owner form at `/onboarding/<token>` | One hint line |
| Helm-run, Guesty-run, calendar authority, cut over | which system owns the calendar (`isHelmRun`) | Tile copy, partially |
| rate plan, day override, season, CTA, CTD, direct markup, long-stay exemption, CIF | pricing records on `property_rate_plans`, `property_rate_days`, `property_tax_config` | Field hints; CTA/CTD only as "(CTA)" |
| merge fields, rail, OTA paste, approve-or-auto, silence here | automation engine terms | Partially, inside the section |
| snapshot, demo mode, in review, PR open | Stay Cape Ann launch states | Tile status words |
| pressure test, test code, issue, revoke, map a lock, Sync Seam devices | Seam lock operations | Intro paragraph |
| Run now (climate), comfort / idle setpoints, pre-condition | thermostat automation | Intro paragraph |
| touch, I reached out, Full record | CRM contact events | No |
| Cleaning Est, "manual fallback" | per-turn cleaning cost used until real cleanings land | Stat sub-label |
| Multi-month booking, split, installment, dismissed suggestion | revenue recognition across months | One sentence while unsplit |
| Backfill from integrations | fill blank columns from SCA snapshot or Guesty | Tile copy |
| Perfection | the legacy inspection app | Reference paragraph |
| Reference, Helm ID, Perfection ID, Code | identifiers | No |
| Trash notes (location only), carts handled by us | the location sentence and the "we roll the carts" flag | Edit hints |
| Arrival brief (crew) | the how-to-get-in paragraph printed on Field packets | Edit hint |
| STR permit, STR registration, tax cert, MassTaxConnect | compliance identifiers | No |
| HQ, Prospect, Inactive, Managed | `properties.kind` and `is_active` | Row labels only |

### Pages to merge, demote or delete

- **Merge** the three policy stores into the nine House policy columns (above). **Merge** the three owner rosters into one list with a primary row. **Merge** the two note vocabularies into facts and issues.
- **Demote** the Facts launcher tiles and the Guest & listing launcher tiles to a single "Tools" line per tab; they are navigation, not content, and they push the first section below the fold.
- **Demote** Reference to a one-line footer ("Helm ID · Guesty ID · Last synced"); the Perfection paragraph and button go when Perfection does.
- **Demote** "Go-live gates" to the Setup tab header (it is one link and a paragraph).
- **Delete** the second "+ New notice" (`page.tsx:2412`), the Facts "Setup is complete" line once the Now chip exists (or the Now chip on established homes), and the "Owner" stat that repeats the dl below it (`:1626`).
- **Delete** the Multi-month bookings section from the property page for staff; for owners, it belongs with the statement it changes.
- **Merge** `/notes/new` into the notebook section as an inline form; keep the edit page.
- **Demote** "Who serves this house" to the band's cleaner cell plus one line in the fact sheet until a mapping control exists; a section whose empty state cannot be fixed in Helm should not look like one that can.

### Plain bugs

1. `PropertyMasthead.tsx:264`: "N slips →" links to `/properties/<id>/work-slips`, which has no page; only `work-slips/print/` exists. 404 on every property with open work.
2. `PropertyMasthead.tsx:247`: "Last walked" links to `?tab=owner`; Recent Inspections is on Now (`page.tsx:1007`).
3. `PropertyMasthead.tsx:315`, `page.tsx:1370`: "No cleaner mapped" sends to `/turnovers/schedule`; no cleaner-to-property mapping control exists anywhere in `src` (only `api/sync-quo/route.ts` reads `cleaner_phones`).
4. `PropertiesTabBar.tsx:10-15`, used by `page.tsx:110`, `onboarding/page.tsx:112`: Prospects and Contracts tabs shown to staff bounce to `/not-available` (`helm-access.ts:72-73`).
5. `page.tsx:832` + `PropertyMasthead.tsx:178-183`: for staff, an owner with preferred contact "email" shows "Add owner contact →" even with a phone on file.
6. `page.tsx:548-563`: the no-contract and notice-window alerts render for staff and link to `?tab=owner`, where Management Agreement is owner-only (`:1818`).
7. `page.tsx:1738-1758`: "also has" prospect chips link staff to `/prospects/<id>`, an owner path.
8. `page.tsx:844`: Multi-month bookings ungated; staff see per-stay net revenue and a "Split into installments" editor whose save hits owner-only `/api/installments` (`helm-access.ts:115`). `installment-actions.ts:82-91`: dismiss and restore have no session check.
9. `page.tsx:2051-2057`: Documents shows the auto-filed executed contract to staff.
10. `activity/page.tsx:96`: duplicated "Properties" breadcrumb (section crumb plus trail).
11. Stale tab names in live copy: `page.tsx:1097` ("Today"), `:2238` ("Operations tab"), `:2361` ("under Operations"); `NoteEditorForm.tsx:27` ("Property Notes accordion").
12. `page.tsx:384-385`: empty state instructs the user to run a migration file in the Supabase SQL Editor.
13. `PropertiesMap.tsx:174-177, 216-233`: Leaflet from unpkg with no failure state; "Loading map…" is permanent if the CDN is blocked.
14. `page.tsx:1630`: "Edit owner info" links to `/edit` without `#owner`.
15. `ResolveFlagButton.tsx:38-61` with `kb-facts/route.ts:117-120`: Resolve on a guest-facing note silently removes it from the guest knowledge base; no reopen control exists (`togglePropertyNoteResolved` is only ever called with `resolveOnly = true`).
16. `InlineField.tsx:33` claims to correct values; `page.tsx:2821-2845` only mounts it on blanks.
17. `GuestCodesPanel.tsx:235-242`: "Revoke" on a stay's door code has no confirmation; `RatesPanel.tsx:396-408`: "Clear range" wipes seeded PriceLabs overrides on a plain submit.
18. `NoteEditorForm.tsx:55`: the Tag hint promises filtering that no surface implements.
19. `rates-actions.ts:78-80` vs `helm-access.ts:77-78`: staff edit nightly rates and the direct markup on the property page while quotes are owner-only.
20. `PropertyTabs.tsx:76` with `OrderChecklistClient.tsx:124, 144`: `?tab=setup` on an established home silently lands on Now.
