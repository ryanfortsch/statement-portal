# F2: Library cluster (Playbook, CRM, Channels) plus /book

Audited 2026-10-17 against worktree `helm-ui-ux-audit-7760d6`. Read-only. Every page.tsx and sibling in `src/app/crm`, `src/app/channels`, `src/app/playbook`, plus `src/components/Markdown.tsx`, `HelmModuleNavMore.tsx`, the relevant `src/lib` modules and the four memory notes named in the brief.

## The nav verdict first

The More menu (`src/components/HelmModuleNavMore.tsx:48-52`) is a flat, title-only list pinned in the order Playbook, CRM, Channels, Search (`src/lib/helm-modules.ts:832`). Sixteen visits in ninety days is the right number for a shelf that holds a five-entry manual, a ledger whose live traffic arrives through other pages, and a PMS whose write powers apply to zero or one home.

| Module | Verdict | Why |
|---|---|---|
| **Playbook** | Keep in More, but it is not where Delaney learns the job yet | Five seeded entries, six `TODO` placeholders in the one entry Dotti asked for, no inbound link from any operational page. It earns its place only once it has content. |
| **CRM** | Split: the two triage queues move to Messaging or the home feed; the contact ledger stays in More | The only daily-ops work on `/crm` is resolving unknown Quo numbers and Quo address-book suggestions. Everything else (meetings, touches, owner contacts) is reached from the home feed and property pages, not from the menu. |
| **Channels** | Demote from More to the property page's Channels tile and a single owner-facing "Cutover" page until a Cape Ann home is Helm-run | It is a fleet-wide read surface and a one-home write surface. For a staff member it is a decoy: three ways to put a hold on a calendar, two of which do not reach the OTAs. |

Details and evidence follow, per page, then the cluster findings.

---

## CRM

### /crm

**Purpose.** The list of owners, vendors and leads Rising Tide deals with, with the last thing said to each, plus the place where a stranger's phone number from Quo gets a name.

**Entry points.** More menu (`helm-modules.ts:703-709`). Home feed: Meetings card header (`ForMeFeed.tsx:271-275`), inbound-touch rows with no contact id (`ForMeFeed.tsx:745`). Property page: "Add one in CRM" when no contacts are linked (`PropertyCrmSection.tsx:45`). Cmd+K and `/search` index `contacts` (`src/lib/search.ts:98`). Ask Helm cites `/crm/<id>` (`ask/tools.ts:127,784`).

**Inventory, top to bottom.**
1. HelmHero: "The contacts ledger." plus a one-line description (`crm/page.tsx:121-126`).
2. Status line(s) "Updated X. View contact" after an accepted suggestion (`CrmListClient.tsx:191-196`).
3. "From your Quo address book · N" box: per row a name, phone, reason, a type `<select>` (Owner/Vendor/Lead/Other, only for `add_contact`), a primary button labelled "Add to Helm" / "Add email" / "Add org" / "Accept", and "Skip" (`:197-265`).
4. "New numbers reaching out · N" box: per row the phone, a line badge (GUESTS / RISING TIDE 24/7 / OWNERS), an optional "Guest · name · property · arriving today" badge, the last message, a `<select>` "Attach to existing…", and three buttons "Attach", "Add as new", "Dismiss" (`:267-382`).
5. Toolbar: five count pills (All, Owners, Vendors, Leads, Other), a search box, three outline buttons "Sync Replies", "Sync Quo", "Sync Contacts", and "+ New Contact" (`:384-429`). Ten controls in one wrapping row.
6. The list: name, organisation, first email, linked property names, last touch ("channel · "summary" · 3d ago"), a type chip, and the text "Open →" (`:431-512`).
7. Modal "New Contact" / "Add as contact": Type, Name, Emails textarea, Phone, Organization, Linked properties (`<select multiple>` with "Hold ⌘ to select multiple."), Tags, Notes, Cancel / Create Contact (`:698-874`).

Controls: 5 pills, 1 search, 4 buttons, per-row 1 select + 3 buttons (unknowns) and 1 select + 2 buttons (suggestions), 1 modal with 8 fields.

**New-hire friction.**
- *Jargon never defined on the page*: "touch" (a logged contact), "Lead" (a prospective owner, which overlaps the owner-gated `/properties/prospects`), "Other", "Sync Replies" (polls Gmail for replies from known contacts, `SyncGmailButton.tsx:9-11`), "Sync Quo" (14-day backfill of Quo messages, `SyncQuoButton.tsx:9-13`), "Sync Contacts" (reconciles the Quo address book, `SyncQuoContactsButton.tsx:8-9`). The three sync buttons are belt-and-braces for a webhook and two crons; their tooltips are the only explanation and tooltips do not exist on a phone.
- *Two triage boxes with different verbs for the same decision*: suggestions use Add to Helm / Skip (`:246-254`), unknowns use Attach / Add as new / Dismiss (`:354-372`). "Skip" and "Dismiss" both mean "hide forever": `dismissUnknownNumber` sets `status='dismissed'` (`actions.ts:286-290`) and there is no UI to see dismissed rows again. No confirmation on either.
- *The guest trap is handled but only by a badge*: there is no guest contact type (`src/lib/crm.ts:10`), so a GUESTS-line texter who is not matched to a booking can be filed as a Lead by "Add as new" (default type `lead`, `:530`). The comment at `:296-301` knows this; the UI relies on the operator reading a small badge.
- *Default type on "+ New Contact" is Owner* (`:628`). The most common new contact for an ops manager is a vendor or cleaner.
- *`<select multiple>` with a Mac-only hint* (`:792-805`, repeated in `ContactDetail.tsx:401-415`). Unusable on a phone, wrong on Windows.
- *"Open →" is text, not a control* (`:505-507`); the whole row is already a link.
- *Density*: with both triage boxes populated the list starts below two bordered panels and a ten-control toolbar.
- *Mobile*: toolbar wraps to roughly five rows; each unknown-number row carries a select and three buttons; the list grid `'1fr auto auto'` (`:461`) squeezes the type chip and "Open →" against the name.
- *Silent cap*: `contact_touches` for 60 days is fetched with no limit or paging (`crm/page.tsx:45-49`) and `contacts` with `select('*')` (`:42`). PostgREST stops at 1000 rows. Quo ingest writes a touch per message and call, so the "last touch" line will silently go missing on older contacts once the fleet's 60-day volume passes 1000. See bugs.

**Overlap.** Meetings and inbound touches also render on the home feed (`ForMeFeed.tsx`). Contacts and their recent touches render inline on every property page (`PropertyCrmSection.tsx:14-18`). Contact touches appear in `TeamActivity.tsx:344-378`. Leads duplicate the owner-gated prospects pipeline conceptually. Unknown-number triage is the only place in Helm an unidentified text on the 24/7 line gets resolved, yet the texts themselves are answered on `/contractor-messaging` and `/cleaner-messaging`.

**Owner vs staff.** Open to staff (`helm-access.test.ts:102`). No money on the page. Leads (prospects) are visible to staff here but the prospects module is owner-only; the two ledgers can disagree and staff cannot see the one that drives decks.

**Would an ops manager open it instead of Messaging?** No. Replies are drafted and sent in the four messaging queues; the CRM only records that they happened (automatically, via the Quo webhook and the Gmail poll). The one thing Delaney must come here for is the unknown-number queue, which is a messaging problem filed under Relationships.

**Simplification proposals.**
1. (M) The two triage boxes become one card on `/messaging` (or the home feed's For Me list) with one verb set: Attach, New contact, Not ours. `/crm` opens straight on the list.
2. (S) The three sync buttons fold into one "Refresh" that runs all three and reports one line; the crons already cover the steady state.
3. (S) "+ New Contact" defaults to Vendor; the type pill that is active pre-selects the type.
4. (S) Linked properties become checkboxes, not a multi-select; the ⌘ hint goes.
5. (S) Page the 60-day touch read with `selectAllPaged`, or cap it per contact in SQL.

### /crm/[id]

**Purpose.** One contact: who they are, meetings with them, open work on their homes, and the log of every call, text and email.

**Entry points.** Row click on `/crm`. Home feed meeting rows and inbound-touch rows (`ForMeFeed.tsx:745,814`). Property page contact rows (`PropertyCrmSection.tsx:125,160`), `PropertyActivity.tsx:406-414`, `TeamActivity.tsx:369-378`. The meeting reminder text links here (`src/lib/meetings.ts:162`). Cmd+K.

**Inventory.**
1. "← All Contacts" (`[id]/page.tsx:89-100`).
2. Hero: type eyebrow, name at 38px, organisation, tag chips (`ContactDetail.tsx:198-235`).
3. Info block: Emails (mailto links), Phone (tel link), Linked properties (chips to `/properties/<id>`), Notes; footer "Added by X on date"; buttons **Delete** (confirm) and **Edit** (`:238-350`). Edit swaps the block for an 8-field form with Cancel / Save (`:352-473`).
4. **Meetings**: form with Date, Time, Property, What, a Where line, a Note line, checkbox "Text me the evening before", button "Add Meeting"; list of upcoming with an × per row (soft cancel, no confirm); `<details>` "N past" (`ContactMeetings.tsx:114-246`).
5. **Open Work** (only when properties are linked): "N active across M properties · K owner action", **Draft Email** (owners only, disabled when no owner-action slips), rows linking to `/work/<id>` with priority dot, assignee or "Unclaimed", an "Owner" chip, and a raw status (`:490-588`).
6. **Touches**: form Channel (Email/Phone/Text/In person/Other), Summary, Notes, "Log Touch", "Discard activity draft"; list of touches with channel pill ("Email reply" for inbound), summary, notes, Recording link, `<details>` Transcript, "X · 3d ago · via Quo", and an × on your own outbound touches (`:590-766`).

**New-hire friction.**
- *"Touches" is the page's own word for the activity log*; nothing else in Helm uses it. The form says "Log Touch".
- *Delete-touch × has no confirmation* (`:740-759`) and runs `deleteContactTouch` immediately (`actions.ts:154-171`). Scoped to the author, but still a hard delete one pixel from the row.
- *Meeting × is a soft cancel with no confirm* (`ContactMeetings.tsx:318-329`); the page has no way to see or restore a cancelled meeting.
- *"Draft Email" is owner-specific and lives inside Open Work*, not beside the contact's email (`:506-510`); it opens a Gmail draft of owner-action items, which the label does not say. The button then reads "Open Gmail draft" and a second link "Open saved Gmail draft" appears beneath it (`ContactDraftEmailButton.tsx:47-49`): two controls for one result.
- *"Unclaimed" and raw statuses* like `in_progress` with the underscore replaced (`:555,581`) leak the work-slip vocabulary into a contact page.
- *Em dash in UI copy* at `:651` (the Notes placeholder joins its two halves with one) and as the empty-value glyph at `:258,271,295`.
- *Mobile*: the two-column `dl` (`:242`) and the three-up touch form row (`:601`) do not collapse; the linked-properties multi-select repeats the ⌘ hint.

**Overlap.** Open Work duplicates the property page's Open Work section per linked home. Touches duplicate `PropertyCrmSection` and `TeamActivity`.

**Owner vs staff.** Open to staff. No money. Owner contacts are visible; so are their notes.

**Simplification proposals.**
1. (S) Rename "Touches" to "Activity" everywhere (the discard button already says "activity draft"); the log form becomes one line: channel, summary, Log.
2. (S) Confirm on delete-touch, or drop the × and keep the log append-only like `playbook_revisions`.
3. (S) Move Draft Email up beside the email address, label it "Email the owner their open items".
4. (M) Collapse the page to Info, Activity (meetings and touches in one dated list, soonest meeting pinned), Open Work.

---

## Channels

**Is it live for the fleet or a pilot for one home, and does the UI say?** Both, and only partly. Every page reads the whole active registry (`listFleetProperties()` defaults to active homes, `src/lib/fleet.ts:75-90`) and the `bookings` table, which the Guesty backfill and the iCal feeds fill for every home. So the Coverage grid, the multi-calendar, the bookings list and each per-home hub are fleet-wide and populated. The write powers are not: price and min-stay edits and quotes are refused on a Guesty-run home (`calendar-actions.ts:98-105, :217-221`), while blocks and manual bookings are accepted on any home with a footnote that they live "in Helm only until the flip" (`calendar-actions.ts:193-196`, `MultiCalendarGrid.tsx:656-661`). As seeded, no home is Helm-run: 65 Calderwood's registry row keeps `calendar_authority='guesty'` until someone flips it (`supabase/migrations/20260926210000_calderwood_registry.sql:30-31`). The UI tells you per row with a Guesty / Shadow / Helm badge (`calendar-model.ts:563-575`) and per page in the footer ("17 homes · 0 on Helm", `channels/page.tsx:108`), and the landing stat strip says "all on Guesty" (`:171`). What it never says is the sentence a new hire needs: *on a home Guesty runs, nothing you write here reaches Airbnb, VRBO or Booking.com.* That sentence exists only inside drawers and footnotes after the click.

### /channels

**Purpose.** The fleet's channel dashboard: who runs each home's calendar, whether each OTA feed is being read and is reading Helm back, pending direct inquiries, double-bookings, and the sync log.

**Entry points.** More menu. Property page tile "Channels" (`properties/[id]/page.tsx:1226-1235`). Onboarding catalog steps "Wire channel iCal imports" and "Mint the iCal export" (`onboarding-catalog.ts:1031-1047`). `/today` "Helm-run homes" attention rows (`today/page.tsx:603`). The `/book` inquiry email links to `/channels/bookings/<id>` (`book/[propertyId]/actions.ts:89-90`). Sync and backfill API routes redirect here.

**Inventory.**
1. Hero with a two-sentence description (`channels/page.tsx:70-75`).
2. A teal rounded Tailwind card "65 Calderwood · Read-only pilot →" (`:77-82`), the only element on the page in that visual language.
3. Optional banners: backfilled count; inquiry conflict (`:87-97`).
4. Stat strip: Homes, Channel rows, Feeds connected, Upcoming stays, Stays this month (`:159-178`).
5. Actions bar: "Multi-calendar →", "Channel wiring" (or "Wire the first feed"), "Bookings", "Airbnb requests" (only when `AIRBNB_REQUEST_QUEUE_ENABLED`), "+ Booking", "+ Block", "Run sync now", "Backfill from Guesty" (`:181-195`). Eight controls.
6. "Direct inquiries · N pending" with Confirm / Decline chips per row and an explainer paragraph (`:389-427`).
7. "Double-bookings · N" with an explainer (`:437-466`).
8. Coverage grid: region chips (only when more than one region), a legend sentence "left dot: Helm's last import · right dot: the OTA's last pull", one row per home with an authority badge and four dot-pairs, then a three-line explainer about iCal lag (`:200-290`).
9. "Upcoming · next 14 days" rows (`:357-387`).
10. "Recent sync runs": five mini stats (Last fleet sync, Feeds ok/failed, Deferred cancels, Reclassified, Cancel guards) and a run log (`:481-518`).

**New-hire friction.**
- *Jargon per screen*: authority, shadow, feed, import, pull, export, Channel rows, cancel guard, deferred cancel, reclassified, aggregate feed, echo. None defined except by the hover title on a dot.
- *"Backfill from Guesty" is a one-time migration tool* ("One-time copy of every guesty_reservations row... Idempotent", `SyncButtons.tsx:109`) living permanently in the primary actions row.
- *The pilot card looks like it belongs to another app* (Tailwind teal, rounded, `:78`), and the page it opens (`/channels/pilot`) has its own Arial, teal top bar and sidebar (`pilot/workspace.module.css`). Three visual systems inside one module once `/channels/requests` is counted.
- *Three explainer paragraphs on one page* (`:285-287`, `:422-424`, `:460-463`), each standing in for a label.
- *Confirm on an inquiry has no confirmation step* (`:408-412`); the database refuses overlaps but a confirmed inquiry on a Guesty-run home becomes a Helm-only stay that the OTAs cannot see.
- *Mobile*: the stat strip is inline `repeat(5, 1fr)` (`:170`) without the responsive `rt-helm-stat-strip` class the Playbook uses; the Coverage grid is `'1fr 130px repeat(4, 104px)'` (`:221`), about 700px minimum, with no scroll wrapper, so it clips on a phone.

**Overlap.** Upcoming stays: `/turnovers` and the home page's 7-day calendar both read `bookings` through `operations.ts:462-467`; `/channels/[id]` and `/channels/bookings` show the same rows. Double-bookings are also a cutover preflight check. Direct inquiries overlap with the SCA custom-quote flow on `/guests/quotes` (owner-only), which is the path that actually takes money and writes Guesty.

**Owner vs staff.** Open to staff. No money on this page.

**Simplification proposals.**
1. (S) Remove "Backfill from Guesty" from the bar; keep it behind the Guesty row on the wiring page or as an API-only tool.
2. (S) One sentence at the top of the page, in place of the hero description: "N homes. Guesty runs K of them: nothing written here reaches their OTAs." Delete the three explainer paragraphs; the dot legend stays.
3. (M) Give the pilot card and `/channels/pilot` the Helm masthead and palette, or retire the pilot workspace now that the hub shows the same reconciliation (`AttentionPanel`).
4. (S) The stat strip and Coverage grid get the responsive class and an `overflow-x: auto` wrapper.

### /channels/[propertyId]

**Purpose.** One home's channel hub: who runs its calendar, the cutover switch and its preflight, every feed's health, the export links, its stays, scheduled message sends, and links to rates, listing and automations on the property page.

**Entry points.** Coverage grid name (`channels/page.tsx:259`), multi-calendar row label (`MultiCalendarGrid.tsx:265`), wiring card title (`listings/page.tsx:132`), booking rows, property page Channels tile, onboarding catalog, `/today`.

**Inventory.** Hero (`:174-184`); six buttons in one row: "← Channels", "Property record →", "Month grid →", "Public booking page ↗", "+ Booking", "+ Block" (`:186-196`); four stats (`:198-205`); **Needs attention** panel with up to nine item kinds, each a title, a 60 to 110 word "why" paragraph and links or a submit button (`:499-679`); **Cutover** panel: headline "Guesty runs this home." / "Helm runs this home.", a mode paragraph, a result banner, the preflight ledger (red/green rows with "fix →"), "Read Guesty's calendar ahead" (`:258-268`), "Guesty holds to re-enter before the first tick" (`:274-281`), the **Flip to Helm** form (two required checkboxes, a typed property id, button) and the **Revert to Guesty** form with a ~120-word paragraph (`:285-334`), then **History** (`:337-361`); **Calendar**: prev / Today / next, month grid, "Full month grid →" (`:366-379`); **Channels** feed rows: Airbnb, VRBO, Booking.com, Direct, Guesty, each with import dot, subtitle, "open in X ↗", rates owner, pull dot, "☑ imports Helm" toggle, "sync", "wiring →" (`:382-394, :765-868`), with a Mass-cancel / Empty-feed alert and the button "These cancellations are real" (`:881-936`); **Helm → channels** export block with a ~110-word paragraph and one Copy URL per OTA (`:396-421`); **Upcoming** and **Recent** stays tables (`:424-439`); **Automation sends · next 14 days** (`:442-473`); three tiles to the property page (`:476-483`).

Roughly 25 distinct controls on a Guesty-run home, more with attention items.

**New-hire friction.**
- *The page is a runbook rendered as a UI.* Nine attention-item kinds, each with a paragraph, an eight-check preflight, a flip, a revert, a read-ahead, a hold re-entry list. For the fifteen Cape Ann homes none of this applies today, yet the Cutover panel with its signal-orange rule and the Revert form render on every home (`:210-363`; Revert is merely disabled when Guesty runs the home, `:326-332`).
- *Vocabulary*: tick, flip, cutover, preflight, shadow, carry / carried season, untwinned, orphaned, echo, extranet, unfiltered feed, aggregate feed, mirror, closure, hold kind, mass-cancel guard, empty-feed guard, deferred. The `AttentionPanel` alone uses most of these.
- *Explainer copy*: the Revert paragraph (`:323`) is the longest single sentence block in Helm; the export block (`:401`) is a second. Both stand in for a two-line label and a "Learn more".
- *Destructive actions without a dialog*: "These cancellations are real" cancels every held row on the feed and syncs (`listings/actions.ts:268-325`); "Release" cancels a Booking.com closure (`:339-378`); "☑ imports Helm" is a one-click toggle whose consequence (the OTA is treated as reading Helm's export; cancel guards and Booking.com echo logic change) is invisible. None confirm. The copy around each is honest but long.
- *The feed row's "sync" and "wiring →" are 11px underlined text* styled like footnotes (`:846-853`), yet "sync" runs a fetch and rewrites bookings.
- *State through the query string*: `?flipped=`, `?flip_note=`, `?flip_error=` (`:166-168`), `#cutover`, `#attention`, `#calendar`. A refresh keeps the banner; a shared link carries it.
- *Mobile*: the Cutover grid `minmax(0, 1.4fr) minmax(280px, 1fr)` (`:213`) and the feed row `'150px 1fr 220px 190px auto'` (`:801`) cannot fit in a 295px content column; no breakpoints on this page.

**Cutover panel safety: can a click here disconnect a live listing from Guesty?** No. `flipToHelm` (`src/lib/cutover.ts:902-945`) runs the preflight, calls the `flip_calendar_authority` RPC (a registry column), cancels Guesty-aggregate block rows inside Helm's own `bookings` table (`:985-1000`), writes Helm's calendar mirror and trims it. It never calls the Guesty API or any OTA; the "disconnected in Guesty" checkbox (`[propertyId]/page.tsx:299-302`) is the operator attesting that they already did that by hand. Four more guards: the Flip form only renders when every data check is green (`:290-313`), and on a Cape Ann home with no direct OTA feed wired the "OTA feeds importing" and "OTAs reading Helm" checks are red; two required acknowledgements; the property id must be typed exactly (`cutover-actions.ts:60-62`); and the proxy gives staff the page but the preflight blocks the flip regardless of role. What the flip *does* change silently: every Guesty pass skips the home afterwards (`src/lib/pms-guards.ts:1-20`), so Guesty reservations stop reaching `guesty_reservations`, and with it the statement ingest, for that home. That consequence is not on the panel.

The asymmetry is **Revert to Guesty**: on a Helm-run home it is one click, no preflight, no acknowledgement, no typed id, no confirm (`cutover-actions.ts:101-110`), and it pauses every automation for the home (`[propertyId]/page.tsx:323`). Flipping back requires all eight checks green again. Cheap to do, expensive to undo.

**Overlap.** The stays tables duplicate `/channels/bookings?property=`; the month grid duplicates `/channels/[id]/calendar`; the feed rows duplicate `/channels/listings`; the export links duplicate `/channels/listings`; automation sends duplicate `/channels/bookings/[id]`; the three tiles are the property page's Guest & listing tab.

**Owner vs staff.** Open to staff. The Rates tile prints base nightly and cleaning fee (`:479`). The month grid prints every night's price and lets staff edit prices on a Helm-run home. `/guests/quotes` is owner-gated because "guest pricing is set by the owners" (`helm-access.ts:77-78`); the same pricing is writable here for staff. Not redacted, not gated.

**Simplification proposals.**
1. (M) On a Guesty-run home the hub collapses to: badge, the four feed rows, the export links, upcoming stays. The Cutover panel, Revert form, attention panel and read-ahead appear only when the operator opens "Prepare cutover" (or only on owner role).
2. (S) Revert to Guesty gets the same typed-id gate as Flip.
3. (S) "These cancellations are real" and "Release" get a confirm naming the count.
4. (S) The feed row's text-buttons become real buttons; "wiring →" drops (the row already is the wiring).
5. (M) Replace the nine attention paragraphs with one line per item and a "why" disclosure.

### /channels/[propertyId]/calendar

**Purpose.** One home, one month, every night with price, minimum, CTA/CTD, the stay or hold on it, and why a vacant night is not for sale; bulk-set a range (Helm-run only).

**Entry points.** Hub "Month grid →" and "Full month grid →" (`[propertyId]/page.tsx:190,374`), double-booking rows (`channels/page.tsx:446`), StayCard "Month grid" (`MultiCalendarGrid.tsx:810`), booking record (`bookings/[id]/page.tsx:115`).

**Inventory.** Hero with instruction sentence (`calendar/page.tsx:122-127`); nav: "← hub", "Multi-calendar →", prev / Today / next (`:129-138`); four stats Booked nights, Held, Open to sell, Average open rate (`:140-151`); the month grid (`PropertyMonthCalendar.tsx`); "Why a vacant night is not for sale" table (`:158-174`); "Set a range" form with From, To, four tick-to-change fields (Nightly rate, Minimum nights, Closed "Helm sales only", Note) and "Apply to range" (`:176-231`), replaced on a Guesty-run home by a sentence pointing to the hub (`:185-189`).

**New-hire friction.**
- *Closed vs hold vs block*: "Closed stops Helm's own sales only... To close nights on every channel, hold them" (`:221-224`). Three words for taking a night off sale, with different reach. The drawer says it again (`MultiCalendarGrid.tsx:626`).
- *CTA / CTD* appear as marks (`PropertyMonthCalendar.tsx:135-137`) with no expansion.
- *Interaction is mouse-only*: `onMouseDown` / `onMouseEnter` (`PropertyMonthCalendar.tsx:156-175`), shift-click to quote. Drag-to-hold and shift-quote do not exist on a phone; the footer sentence promising them (`:275-278`) is wrong there.
- *Analytics chrome*: "Average open rate" and "Open to sell" are rollups nobody asked for on a per-home grid.
- *The bulk form's "tick to change" pattern* (`:206-219`) is explained by a sentence (`:194-196`) rather than by the form.

**Overlap.** The same cells and drawers as the multi-calendar row and the hub's compact grid.

**Owner vs staff.** Prices visible and, on a Helm-run home, editable by staff.

**Simplification proposals.**
1. (S) Delete the stat strip; the grid is the stat.
2. (S) Touch support (pointer events) or hide the drag promise on narrow screens.
3. (S) Rename "Closed" to "Off sale on staycapeann.com" at the control, not in a sentence after it.

### /channels/calendar

**Purpose.** The fleet multi-calendar: one row per home, a month of columns, prices on vacant nights, bars for stays, drag to hold.

**Entry points.** Hub actions bar (`channels/page.tsx:185`), wiring page, bookings page, property page Rates panel link "month grid" (`properties/[id]/RatesPanel.tsx:318`), StayCard.

**Inventory.** Hero (`calendar/page.tsx:165-170`); nav row with "+ Booking", "+ Block" (`:172-183`); three filter groups, Region (All plus each region), Authority (All / Guesty / Helm), Channel (All plus five) (`:185-204`); conflict and error banners; legend (`:265-289`); the grid (`MultiCalendarGrid.tsx`): click a vacant night opens a drawer with three tabs "Price and rules", "Block these nights", "Quote" (`:568-572`); click a bar opens a StayCard with "Open record", "Property hub", "Month grid" (`:777-814`); explainer paragraph (`:226-228`).

**New-hire friction.**
- *The Price tab is disabled on every Guesty-run home* with a signal note (`:576-579`), so on today's fleet the drawer's first tab is always dead. The Block tab works but warns the hold "lives in Helm only until the flip" (`:656-658`). The Quote tab refuses (`:687`). A new hire opening any night on any Cape Ann home meets three tabs of which two refuse and one half-works.
- *Hold kinds*: Owner stay, Maintenance, Other, "Channel block" (`:662-669`); `ota` is the stored value and means "an OTA closed this night", which an operator should never pick by hand.
- *Italic price = Guesty mirror, upright = Helm plan* (`:357`): a typographic convention explained in a paragraph below the grid (`calendar/page.tsx:227`).
- *Eleven filter chips* for a fleet that today has one authority and two regions.
- *Mouse-only drag* (`:306-311`); the grid at least scrolls horizontally (`:137`).

**Overlap.** Rows duplicate each home's hub grid; bars duplicate `/turnovers` and the home 7-day calendar; blocks duplicate Guesty's own calendar and the `property_calendar_days` owner-hold convention (`'m' + 'Owner block'`, per memory).

**Owner vs staff.** Prices visible to staff; editable on Helm-run homes.

**Simplification proposals.**
1. (M) Until a Cape Ann home is Helm-run, the drawer opens on "Block these nights" only, and the hold form's first line reads "This home is run by Guesty. Block the dates in Guesty; this hold reaches the Operations calendar and staycapeann.com only." (the note already exists; make it the headline).
2. (S) Drop the Authority filter until two authorities exist; drop "Channel block" from the hand-entry list.
3. (S) Put "italic = set in Guesty" in the legend row, not the paragraph.

### /channels/listings

**Purpose.** Per home and per channel: the OTA's iCal URL Helm imports, listing ids and links, who owns the price, whether the OTA has been given Helm's export, and the export URLs.

**Entry points.** Hub "Channel wiring" (`channels/page.tsx:186`), feed row "wiring →", Guesty row "retires at the flip" link back to the hub, preflight "fix →" (`cutover.ts:218`).

**Inventory.** Hero (`listings/page.tsx:61-66`); nav and region chips plus "N of M homes import at least one OTA feed" (`:68-84`); "Where each OTA keeps its export URL" three hints and a paragraph about Airbnb's "Sync everything" rule (`:92-104`); one card per home: name, address, badge, "N / 3 OTA feeds importing"; per channel a URL input with Save, a sync status with "resync" / "sync now", then a second row with "☑ OTA imports Helm export", pull dot, "rates: X", "open in X ↗", listing id, "retire" / "reactivate", and a `<details>` "ids and ownership" with six fields and "Save details" (`:190-279`); a Guesty row with "sync", "retires at the flip" or "Retire" / "reactivate" (`:281-330`); an export URL block with Copy buttons (`:157-181`).

**New-hire friction.**
- *Retire has no confirmation and cancels data*: `toggleListingActive` calls `retireFeedHolds`, which sets every imported OTA closure on that feed to cancelled (`listings/actions.ts:26-51, :156-183`). The control is 11px underlined text (`:237-241`).
- *Clearing the URL field and pressing Save does the same* (`actions.ts:119-122`). A blank-and-save on the wrong row silently cancels closures and stops the feed. No warning on the form.
- *"☑ OTA imports Helm export" is an attestation, not a measurement*; the pull dot beside it is the measurement. Both are on the same line with no hierarchy.
- *The whole page is a dense engineering form*: per home, four channel rows with up to eleven controls each; the fleet is seventeen homes, so around 700 controls on one page.
- *Mobile*: `'110px 1fr 250px auto'` rows (`:196`), a 640px `minWidth` details form (`:244`).

**Overlap.** Everything here is repeated per home on the hub's feed rows and export block.

**Owner vs staff.** Open to staff. The "rates: Guesty / PriceLabs / Typed in the OTA / Helm rate plan" field is pricing ownership, harmless.

**Simplification proposals.**
1. (S) Confirm on retire and on a cleared URL, naming the count of closures that will be cancelled.
2. (M) Make this page per-home (`/channels/[id]/wiring`) and delete the fleet version; the hub already lists feeds, so the hub's feed rows gain the URL field and this route goes.
3. (S) Hide the `<details>` ids form behind an "Edit ids" button with real affordance.

### /channels/bookings

**Purpose.** Every canonical stay and block on the Helm calendar, filterable by home, channel, status and window.

**Entry points.** Hub actions bar, hub "All stays for this home →", booking record "← Bookings", `/book` inquiry email.

**Inventory.** Hero (`bookings/page.tsx:74-79`); nav with "+ Booking", "+ Block"; banners for `?deleted=1` and a guest filter; a GET filter form Property / Channel / Status / Window / Apply (`:109-146`); a nine-column table: colour bar, source glyph, dates (link), property (link) with badge and region, channel, guest (link to the guest's stays), nights, **Payout**, status, with "in house" and "+N echoes" (`:203-270`).

**New-hire friction.**
- *"Src" glyph column, "echoes", "canonical rows", "not in feed"* (`:208,253,258`): dedupe internals printed as columns.
- *Unknown `?range=`* falls through to all-time while the select shows "Upcoming" (`:29,:137-142`). See bugs.
- *Filter form needs Apply*; the multi-calendar's chips are instant links. Two filter idioms in one module.
- *Mobile*: nine fixed columns (`:203`), no scroll wrapper.

**Overlap.** `/turnovers` lists the same upcoming stays with cleaning lifecycle; the home 7-day calendar shows the next week; the property page links here via the hub; the hub's tables are this page filtered.

**Owner vs staff.** The **Payout** column (`:215,263`) prints owner money per stay to staff. Not redacted.

**Simplification proposals.**
1. (S) Drop Payout for staff role, or drop the column (money has its own module).
2. (S) Drop the Src glyph and echo count from the list; keep them on the record.
3. (S) Validate `range` against the three values.

### /channels/bookings/[id]

**Purpose.** One stay or hold: dates, status, guest, money, cancel with a reason, the finance sub-record, inbox threads, automation sends, what the stay generated, the change log, and raw provenance.

**Entry points.** Every stay row and bar across the module; `/book` email; `AttentionPanel` links.

**Inventory.** Hero; nav "← Bookings", "hub →", "Month grid →", "Guest's stays →" (`bookings/[id]/page.tsx:111-118`); three possible banners; the edit form: Check-in, Check-out, Status, Channel (read-only), Guest name / email / phone / guests, **Gross / Cleaning / Taxes / Payout** (editable), Notes, Save, Back, Delete or "Delete (kept as cancelled)" (`:143-228`); feed-owned explanation paragraphs (`:230-251`); "Cancel this stay, with a reason" input and button, or "Release this hold" (`:252-260`); two columns "Money sub-record · booking_finance" and "Threads" (`:264-316`); "Automation sends for this stay" (`:319-340`); "What this stay generated" with table names and counts (`:343-376`); "Change log · booking_events" with before→after diff lines (`:379-407`); "Provenance" with sixteen raw columns including `ical_uid`, `raw_description` (`:418-455`).

**New-hire friction.**
- *Cancel stay has no confirmation and the reason is optional* (`:253-259`, default `'operator'` at `actions.ts:116`). One click soft-cancels a confirmed stay; on a feed-owned row the form is hidden, so the risk is on manual and direct stays.
- *Half the page is a database inspector*: section eyebrows name tables (`booking_finance`, `booking_events`), the provenance block prints snake_case columns. Useful to an engineer, noise to an operator.
- *Money fields editable by anyone*, with a line admitting "Nothing in the statements pipeline reads this record" (`:282`).
- *"Delete (kept as cancelled)"* is a label that does two things (`DeleteBookingButton.tsx:22-25`); the confirm text is honest but the button is a riddle.

**Overlap.** Threads duplicate `/messaging`; automation sends duplicate the hub; money duplicates the statements pipeline's `reservations` row with no link between them.

**Owner vs staff.** Gross, taxes, channel commission, Stripe fee and payout printed and editable for staff (`:200-214, :268-279`).

**Simplification proposals.**
1. (S) Confirm on Cancel stay; require a reason.
2. (M) Split the page: the operator record (dates, status, guest, notes, cancel) above, "Technical" as a collapsed section holding finance, artifacts, change log, provenance.
3. (S) Hide the money rows for staff.

### /channels/bookings/new

**Purpose.** Add a stay by hand or hold dates, with an availability check and (Helm-run only) a quote.

**Entry points.** "+ Booking" and "+ Block" from the hub, per-home hub, multi-calendar, bookings page; `AttentionPanel` "Re-enter as a Helm block →" and "Enter the Booking.com booking →"; the quote tab's "Book these dates".

**Inventory.** Hero (`bookings/new/page.tsx:139-148`); nav with "Block instead" / "Booking instead"; **1 · Dates**: Property, Check-in, Check-out, Guests, "Check dates" (GET form, `:170-204`); an availability block with conflict rows, Guesty-rule notes, "Guesty runs this home. Helm checks only its own rows; confirm the dates in Guesty as well" (`:379-383`), and a quote table; **2 · The booking**: dates again, Channel (no default on a stay), Status (confirmed / pending / inquiry), Hold kind, Guest name / count / email / phone, Money (four fields, prefilled from a quote), Notes, "Create booking" / "Create block", Cancel (`:206-320`).

**New-hire friction.**
- *This looks like the way to book a direct guest and is not*, for any Cape Ann home: the real path is `/guests/quotes`, which creates the Guesty reservation and takes payment. A stay created here on a Guesty-run home is a Helm-only mirror row; the only warning is the sentence at `:379-383`, shown after "Check dates". The hero says "For direct stays, off-platform reservations, or a booking no feed carries yet" (`:146`).
- *Dates are entered twice* (step 1 and step 2, `:186-191` and `:226-231`).
- *Channel has no default and "Pick the channel" is disabled text* (`:236-241`); the reason is a past bug (`:129-131`), the UI gives none.
- *Hold kind "Channel block" (`ota`)* is offered for hand entry (`:256`); it should not be.

**Overlap.** Blocks duplicate the calendar drawer's block tab; bookings duplicate SCA quotes and Guesty.

**Owner vs staff.** Money fields open to staff.

**Simplification proposals.**
1. (S) On a Guesty-run home the hero reads "Record a stay Helm has no feed for. To sell a direct stay, use Quotes." with a link.
2. (S) One date pair; step 2 fills from step 1.
3. (S) Remove "Channel block" from the hand-entry hold kinds.

### /channels/requests

**Purpose.** A review desk for Airbnb "request to stay" texts received on Quo, hard-coded to 17 Beach ("17 BEACH · REQUEST DESK", `requests/page.tsx:33`); disabled unless `AIRBNB_REQUEST_QUEUE_ENABLED` (`:17,:35`). Own CSS module, no masthead, email-domain gate (`:13`). Linked from the hub only when the flag is on (`channels/page.tsx:188`). As a staff member today it is a dead route that renders a "Ready for activation" notice. Proposal: (S) remove the route or hide it until enabled; it is a one-property experiment with its own visual system.

### /channels/pilot and /channels/pilot/inbox

**Purpose.** A read-only workspace for 65 Calderwood: a 14/28-night lane calendar, a reservation table, a "Migration baseline" export, Guesty-vs-Helm reconciliation, feed health; the inbox lists Guesty conversations read-only with a link to `/messaging` to reply. Own CSS modules, Arial, teal chrome, no masthead (`CalderwoodWorkspace.tsx:61`, `workspace.module.css`). Reached from the teal card on `/channels`. Every control is a filter, a tab, "Refresh records", "Download baseline JSON". The sidebar says "This workspace cannot change reservations or channel connections" (`:67,:133`), which is true.

Friction: it is a second Helm skin with Guesty's layout, hard-coded to one home, and the hub's `AttentionPanel` now does the reconciliation it was built for. Proposal: (M) retire both pilot routes once the hub shows the same differences, or at minimum render them inside the Helm masthead and palette.

---

## Playbook

### /playbook

**Purpose.** The written SOPs: a searchable list of entries grouped by category.

**Entry points.** More menu only, plus Cmd+K and `/search` (`search.ts:118`, `UniversalSearch.tsx:141`) and Ask Helm citations (`ask/tools.ts:897,909`). No operational page links here: not the onboarding hub, not `/fieldwork/hiring`, not the property page (grep across `src/` finds only nav, search and the access test).

**Inventory.** Hero "How we run the business." with a 30-word description (`playbook/page.tsx:32-37`); stat strip Entries / Categories / Updated this month / Pinned (`:39-54`); toolbar: search box, "Show archived" checkbox, "+ New entry" (`PlaybookClient.tsx:87-132`); category chips, "All" plus each present category (`:134-140`); grouped rows: ★ if pinned, title, a lowercase raw status chip for drafts (`:175-179`), a property chip, excerpt, up to five `#tags`, "Updated date · name" (`:148-201`).

Controls: 1 search, 1 checkbox, 1 link-button, up to 9 chips.

**How many articles, who writes them, is there a search?** Five entries ship in migrations: `onboard-a-new-property`, `send-monthly-owner-statements`, `how-rental-revenue-is-calculated`, `cleaning-costs-and-cape-ann-elite` (`20260601b_seed_playbook.sql:10-146`) and `create-a-new-listing-in-guesty` (`20260629_seed_playbook_guesty_listing.sql`). The onboarding entry carries six **TODO** placeholders for the Chase, Stripe and Guesty button-level steps (`20260601b:16-40`). Anyone signed in can write (`actions.ts:40-43`); the seeds are attributed to dotti@. Search is client-side over title, summary, tags and body (`PlaybookClient.tsx:55-64`), plus Cmd+K and Ask Helm. Drafts are listed to everyone with a chip (`page.tsx:18`, `includeUnpublished: true`).

**Does Ask Helm read it, as CLAUDE.md claims?** Yes. `search_playbook` (`ask/tools.ts:800-913`) tokenises the question, OR-matches title, summary and body of **published** entries (`:856`), ranks and returns the top five with full bodies and `/playbook/<slug>` sources. It is not in `OWNER_ONLY_ASK_TOOLS` (`helm-access.ts:45`), so staff Ask Helm reads it too. Drafts are invisible to it, which the editor's status option says ("Published (searchable + Ask Helm)", `PlaybookEditor.tsx:239`).

**Is it where Delaney learns the job?** Not today. Three of five entries are money SOPs (statements, revenue math, cleaning cost rules) she cannot act on; the onboarding entry is a skeleton; there is nothing on turnovers, the cleaner schedule, work slips, Field packets, the three Quo lines, or the messaging queues, which is her actual day. The module is built to hold that; it is empty of it.

**New-hire friction.**
- *Four stats over five entries* (`page.tsx:49-52`): analytics chrome on a library.
- *Three category chips would be eight once every category has an entry*; eight categories (`lib/playbook.ts:39-48`) for five entries.
- *Status chip prints the raw value* `draft` (`PlaybookClient.tsx:177`) while the detail page prints "Draft" (`STATUS_LABELS`).
- *Empty state is fine*: "No entries yet. Write the first one."
- *Mobile*: good. The toolbar and stat strip use the responsive classes (`:89`, `page.tsx:41`); the editor collapses at 720px (`PlaybookEditor.tsx:296-300`). Best in the cluster.

**Overlap.** None in-app; the per-property launch checklist (`property_launch_steps`) is the execution twin of the onboarding SOP and the two do not link.

**Owner vs staff.** Open to staff. The "Finance & Banking" and "Statements" categories expose money procedure (not figures) to staff.

**Simplification proposals.**
1. (S) Delete the stat strip and the hero description; the page opens on the search box and the list.
2. (M) Seed the six operations entries Delaney needs (turnover lifecycle, cleaner schedule and `/c/<token>`, work slips and lanes, Field packets, the three Quo lines, the four messaging queues) from CLAUDE.md, the way the first four were seeded from it.
3. (S) Link the onboarding SOP from `/properties/onboarding` and the hiring page from `/fieldwork/hiring`; a Playbook nobody arrives at by task is a Playbook nobody reads.
4. (S) Hide draft and archived chips from staff, or use the label map.

### /playbook/[slug]

**Purpose.** Read one entry.

**Entry points.** List rows, Cmd+K, `/search`, Ask Helm sources, inter-entry markdown links.

**Inventory.** "← Playbook"; **Edit**; **Delete** (confirm: "removes the entry and its history. This cannot be undone.", `DeleteEntryButton.tsx:15`); category eyebrow with status; title; summary; meta strip Updated / By / Scope / tags; the body via `Markdown`; **History** list of revisions with change notes (`[slug]/page.tsx:44-123`).

**New-hire friction.** Delete is a hard delete of the entry and its revisions (`actions.ts:134-145`) placed beside Edit at the top of every entry for every role; archiving exists in the editor and is the safe path. Otherwise this page is right: a reading column, no chrome. The markdown bullet glyph is an em dash (`Markdown.tsx:286`), against house style.

**Proposals.** (S) Move Delete into the editor behind the status select, or restrict to owners. (S) Swap the bullet glyph for a plain dash or a dot.

### /playbook/new and /playbook/[slug]/edit

**Purpose.** Write or revise an entry.

**Inventory.** "← Cancel"; Title; Summary; Body with Write / Preview tabs and a markdown placeholder; sidebar Category (8), Status (Draft / Published / Archived, each with a parenthetical), Property scope, Tags, "Pin to top", "What changed?" (edit only), "Save changes" / "Create entry", Cancel (`PlaybookEditor.tsx:145-303`). Unsaved-work guard and an "uncertain save" path exist (`:89-93, :131-134`).

**Friction.** Markdown is the only format; the placeholder teaches it (`:51-63`). Status defaults to Draft (`:85`), which hides a new entry from Ask Helm and search until someone remembers to publish; the list shows it to everyone anyway. Proposal: (S) default to Published, keep Draft as the opt-in.

### src/components/Markdown.tsx

A 346-line dependency-free renderer: headings, numbered steps with signal-coloured numerals, bullets, callout quotes, code, links (internal via `Link`), bold, italic, rules. Safe (no raw HTML). Used by the entry page and the editor preview. One style issue (the em-dash bullet). Fine otherwise.

---

## /book/[propertyId] and /book/[propertyId]/thanks

One line each, as briefed. `/book/[propertyId]` is the public inquiry form for roster or Helm-run homes (`isPublicBookable`, `bookings-write-core.ts:251-257`); it writes a `bookings` row with `status='inquiry'` that holds no nights, emails ops a link to `/channels/bookings/<id>` (`book/[propertyId]/actions.ts:58-66, :89-90`), and lands the guest on `/thanks`. Note only that it is a second direct-booking door beside staycapeann.com, with no payment and no Guesty record, and its inquiries surface on `/channels` for Confirm / Decline.

---

## Cluster findings

### The five biggest structural problems, ranked

1. **Channels is a one-home PMS presented as a fleet module, and its writes on the other sixteen homes are half-real.** Blocks and manual stays are accepted on Guesty-run homes (`calendar-actions.ts:159-199`, `bookings/new/actions.ts:40-141`) and show on `/turnovers` and the cleaner schedule (`MultiCalendarGrid.tsx:670`, `calendar-actions.ts:50-52`), but never reach Airbnb, VRBO or Booking.com; the only warnings are footnotes after the click (`MultiCalendarGrid.tsx:656-661`, `bookings/new/page.tsx:379-383`). A new hire has three places to hold a date (Guesty, Channels, the property calendar's owner-block convention) and two ways to book a direct guest (Quotes, Channels), with different consequences and no signpost.

2. **The Channels hub renders the whole cutover runbook on every home, every day.** The Cutover panel, Revert form, preflight ledger, read-ahead, hold re-entry and a nine-kind attention panel (`[propertyId]/page.tsx:207-363, :499-679`) are the page's top half for homes where none of it applies. Combined with the explainer paragraphs (`:323`, `:401`, `channels/page.tsx:285-287`) this is the densest page in Helm and the one with the most undefined vocabulary (tick, flip, shadow, carry, echo, untwinned, orphaned, extranet, mirror, closure, guard).

3. **A stay appears in five places and a guest's money in three.** `bookings` feeds `/channels/bookings`, every Channels calendar, `/turnovers` and the home 7-day calendar (`operations.ts:462-467`, `page.tsx:469`), and the property page links to the hub (`properties/[id]/page.tsx:1226-1235`). Payout prints on the bookings list (`bookings/page.tsx:263`), is editable on the record (`bookings/[id]/page.tsx:200-214`) and is also the statements pipeline's number, with no link between them and the record admitting statements never read it (`:282`).

4. **CRM's only daily task is filed under Relationships.** The unknown-number and address-book queues (`CrmListClient.tsx:197-382`) are messaging triage; they live on a page the ops manager otherwise never needs, under two different verb sets (Skip / Dismiss, Add to Helm / Add as new), with no confirmation and no undo. Everything else on `/crm` is reached from the home feed and property pages, not the menu.

5. **The Playbook is empty where Delaney needs it and unreachable by task.** Five entries, six TODOs, three money SOPs, nothing on turnovers, slips, packets, Quo lines or messaging; no link from the onboarding hub, the hiring page or any property page (grep: nav, search and the access test only). Ask Helm does read it (`ask/tools.ts:800-913`), so filling it pays twice.

### Vocabulary a new hire meets in this cluster

| Term | Meaning (from code) | Defined in the UI? |
|---|---|---|
| Touch | A logged call, text, email or visit with a contact (`crm.ts:45-60`) | No |
| Lead | Contact type for a prospective owner (`crm.ts:10`) | No; overlaps the owner-only Prospects module |
| Attach / Add as new / Dismiss | Link an unknown Quo number to a contact, create one, or hide it forever (`actions.ts:278-414`) | Partly, by button label |
| Skip / Add to Helm / Add email / Add org | The same decisions for Quo address-book suggestions (`CrmListClient.tsx:931-937`) | Partly |
| Sync Replies / Sync Quo / Sync Contacts | Manual Gmail poll, 14-day Quo backfill, address-book reconcile | Tooltip only |
| Owner action / Unclaimed | Work-slip flags surfaced on a contact (`ContactDetail.tsx:555-570`) | No |
| Important meeting | One that texts DOTTI_PHONE the evening before (`ContactMeetings.tsx:202`) | Yes, by the checkbox label |
| Authority (Guesty / Shadow / Helm) | Who runs a home's calendar; Shadow = Guesty runs it and Helm reads the OTA feeds directly (`calendar-model.ts:563-575`) | Hover title on the badge |
| Flip / Cutover / Revert | Switching `calendar_authority` (`cutover-actions.ts`) | By headline, not definition |
| Preflight | The eight checks before a flip (`cutover.ts:229-540`) | The ledger shows them; the word is not explained |
| Tick / "imports Helm" | Operator attestation that an OTA was given Helm's export URL (`listings/actions.ts:129-134`) | Yes, in the wiring paragraph |
| Feed / import / pull / export | OTA iCal read by Helm; OTA reading Helm's iCal | Legend sentence only |
| Aggregate feed | Guesty's one iCal carrying every channel (`listings/page.tsx:291`) | Yes, in the Guesty row |
| Echo | A closure that is one calendar mirroring another (`cutover-carryover`, `echo-cause`) | A paragraph in the attention panel |
| Closure / Hold / Block / Closed | OTA closed night; a Helm block row; same; a rate-day flag stopping Helm's own sales only | Three sentences across two pages |
| Hold kind (owner / maintenance / other / ota "Channel block") | `bookings.hold_kind` | Select labels only |
| Canonical row / duplicate_of / echoes | Dedupe: one row per stay, others filed under it | Hero sentence on `/channels/bookings` |
| Src glyph | A symbol for `bookings.source` | Hover only |
| Mirror | `property_calendar_days` copy of Guesty's or Helm's calendar | No |
| Rate plan / rate days / CTA / CTD / booking window / advance notice / off season | Helm pricing model (`property-rates`, `rate-plan`) | CTA/CTD never; the rest in a table of reasons |
| Mass-cancel guard / empty-feed guard / deferred / reclassified | Cancel-policy outcomes (`ical-cancel-policy`) | Paragraph in the alert; mini-stat labels only on the hub |
| Carried season / untwinned / orphaned / unfiltered pull | Attention-panel item kinds | Paragraph each |
| Inquiry / pending / confirmed / completed / block / cancelled | `bookings.status` | No |
| Entry / category / scope / pinned / revision / change note | Playbook fields | By label |
| Draft / Published / Archived | Playbook visibility; only Published reaches search and Ask Helm | Yes, in the status select |

### Pages to merge, demote or delete

- **Delete** `/channels/requests` (flag-gated, one home, own skin) and `/channels/pilot` plus `/channels/pilot/inbox` (read-only, one home, own skin, superseded by the hub's attention panel).
- **Merge** `/channels/listings` into each home's hub (the hub already renders the same feed rows and export links); the fleet wiring page goes.
- **Merge** `/channels/[id]/calendar` into the hub's calendar section (the hub already embeds the same grid in compact form); keep the bulk-range form as a drawer.
- **Demote** `/channels` from More to the property page's Channels tile plus a single owner-side "Cutover" entry, until a Cape Ann home is Helm-run; keep the route and Cmd+K.
- **Move** the CRM triage boxes to `/messaging` or the home feed; `/crm` stays in More as the ledger.
- **Keep** `/playbook` in More; fill it and link it from the onboarding hub and the hiring page.
- **Merge** the CRM detail's Meetings and Touches into one dated activity list (M).

### Plain bugs

1. `src/app/crm/page.tsx:45-49` and `:42`: `contact_touches` (60 days) and `contacts` are read with a bare `select()`, no paging. PostgREST stops at 1000 rows (CLAUDE.md watch-out 1). Quo ingest writes a touch per message and call, so once the fleet's 60-day volume passes 1000 the "last touch" line goes missing on older contacts silently.
2. `src/app/channels/bookings/page.tsx:29,:137-142`: `?range=` accepts any string; an unknown value lists all time while the select renders "Upcoming" (the first option, since the value matches none).
3. `src/app/playbook/PlaybookClient.tsx:177`: the status chip prints the raw enum (`draft`, `archived`) while `[slug]/page.tsx:70` prints `STATUS_LABELS`; same value, two spellings.
4. `src/components/Markdown.tsx:286` renders every bullet as an em dash; `src/app/crm/[id]/ContactDetail.tsx:651` has an em dash in a placeholder; `:258,271,295`, `playbook/page.tsx:50-52`, `channels/requests/page.tsx:34` and `pilot/CalderwoodWorkspace.tsx:73-75` use an em dash as the empty-value glyph. House style says none, anywhere.
5. `src/app/channels/[propertyId]/PropertyMonthCalendar.tsx:156-175` and `calendar/MultiCalendarGrid.tsx:306-311`: drag-to-hold and shift-click-to-quote are mouse events only; on a phone neither works, while the on-page sentences promise both (`PropertyMonthCalendar.tsx:275-278`, `calendar/page.tsx:126`).
6. `src/app/channels/listings/actions.ts:119-122`: saving the URL form with the field blanked cancels that feed's imported closures with no warning on the form (`listings/page.tsx:208-214`).
7. `src/app/channels/[propertyId]/cutover-actions.ts:101-110`: Revert to Guesty has no confirm, no typed id and no preflight, and pauses the home's automations; Flip requires all three.
8. `src/app/channels/bookings/[id]/page.tsx:253-259` with `actions.ts:113-120`: Cancel stay has no confirm and the reason is optional (defaults to `operator`).
9. `src/app/crm/[id]/ContactDetail.tsx:740-759`: delete-touch × has no confirm and is a hard delete.
10. `src/app/channels/page.tsx:170,221` and `[propertyId]/page.tsx:199,213,801`: fixed-width grids with no responsive class or scroll wrapper; the Playbook's `rt-helm-stat-strip` / `rt-helm-filter-bar` (`globals.css:435-477`) exist and are not used here.
11. `src/app/channels/bookings/page.tsx:215,263` and `bookings/[id]/page.tsx:200-214,268-279`: owner payout and fees are printed and editable for the staff role; the module is not in `OWNER_PATH_PREFIXES` (`helm-access.ts:64-84`).
