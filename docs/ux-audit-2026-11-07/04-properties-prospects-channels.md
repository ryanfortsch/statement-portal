# Properties, prospects and channels: UX audit, 2026-11-07

### Still good

- The property page is four tabs and the band answers the driveway questions (trash day, parking, gate/garage, cleaner, open work, last walked; `PropertyMasthead.tsx:247-390`). Facts opens as a plain fact sheet with House policy open under it (`page.tsx:1061-1076`); every row edits in place.
- The owner line is drawn right: `PropertiesTabBar` reads the session and drops Prospects/Contracts/Leases for staff (`PropertiesTabBar.tsx:19-27`); fee reads "Managed" for staff (`page.tsx:401`); bookings Payout and the booking record's money sub-record are owner-only (`channels/bookings/page.tsx:218-230`, `bookings/[id]/page.tsx:60-64, 232`).
- Contracts at 1,083 lines reads well: Action needed grouped by date, a five-column register, each renewal word defined once where it first appears, three text-link writes per row (`contracts/page.tsx:585-660, 731-755`). Not a candidate for cutting.
- The 10/17 retirements are real redirects, not stubs with UI: `listing-copy-studio`, `bedroom-photos`, `onboarding`, `[id]/listing-copy` all `redirect()`. SCA launcher is four named steps, staff get 1-2, owners 3-4 (`stay-cape-ann/page.tsx:61-63`).
- The channel hub on a Guesty-run home folds the runbook behind Prepare cutover for owners and shows staff only feed rows, wiring and upcoming stays (`channels/[propertyId]/page.tsx:183-191, 410-412`). Revert has Flip's typed-id gate (`:352-382`).

### Findings

1. **Guest & listing on a Guesty-run home renders the whole Helm PMS as a draft.** `page.tsx:1922-2235`; `ListingPanel.tsx:148` ("The live listing is in Guesty"), `AutomationsPanel.tsx:85, 114-119` (": Guesty sends this home's messages", yet Edit rules at `:134`), `RatesPanel.tsx:59-63`. Every Cape Ann home is Guesty-run today, so staff open the tab onto a 1,310-line listing editor marked Draft, a pricing block headed "Guests pay Guesty's prices", and a 932-line automations panel for messages Helm does not send. Only the SCA status line and Guest documents are live. Simplification: on a Guesty-run home the tab opens on Guest documents; Listing, Pricing and Automations fold under one line, "Helm's draft, read once Helm runs the calendar," the way the hub folds its runbook. [structural] M

2. **A route named after one house.** `src/app/channels/65_calderwood/message-preparation/page.tsx`, linked only when `propertyId === '65_calderwood'` (`channels/[propertyId]/page.tsx:215`), owner-only; workflows hard-coded in `preparation-timing.ts:4-11`. It is a point-in-time review (Read current setup, up to 80 seconds) comparing six Guesty workflows with Helm's rules, and it wears a third skin: `rounded-xl border p-5`, `text-xl font-semibold` Tailwind cards against the editorial inline system everywhere else (`PreparationReview.tsx:34-36, 52`). Simplification: `/channels/[propertyId]/message-handover`, a section of the Prepare cutover runbook, reading the home's own rules; same page for Calderwood today, no house in the URL, house styling. [new-since-10/19] M

3. **"Guesty fields" is on two tool lines of one page.** Facts `page.tsx:1385` and Guest `page.tsx:1959`, both `!helmRun`. One place per job: it belongs on the Guest line beside Photo captions only. [new-since-10/19] S

4. **Three calendars for one home, four with Turnovers.** Hub compact month (`channels/[propertyId]/page.tsx:417-432`), the full grid at `/channels/[propertyId]/calendar` (384 lines) whose only additions are "Set a range" (`calendar/page.tsx:178-228`) and the "Why a vacant night is not for sale" legend (`:163`), the home's row on `/channels/calendar`, and `/turnovers/calendar`. Fold Set a range into the hub's calendar section and retire the per-home grid route; the hub's "Month grid →" and "Full month grid →" links go with it (`:213, 427`). [structural] M

5. **Prospect workroom prints the deal's stage twice and keeps ten italic hints.** `PipelineProgressBar` in the hero (`prospects/[id]/page.tsx:219-240, 340`) mirrors the four vertical Stage cards right under it (`:348-453`); `grep -c "fontStyle: 'italic'"` = 10 (`:295, 478, 550, 854, 975, 981, 1057, 1132, 1150, 1301`). Drop the hero bar (the stages are the bar) and keep only the hints that change the next tap (the locked-terms line at `:854`, the "save the owner's email" line at `:975`). [still-open-from-10/17] S

6. **Channels index: four button faces in a row, and the stays again.** `channels/page.tsx:190-193` (Multi-calendar primary, Bookings, + Booking, + Block), then Upcoming next 14 days (`:368`) that `/turnovers` and the multi-calendar already show. The module is hidden until a home is Helm-run; the fleet index is reached only by "← Channels" from a hub. Make Multi-calendar the one verb, drop Upcoming, keep Coverage, Inquiries, Double-bookings, Recent sync runs. [still-open-from-10/17] S

7. **Hub verb row on a Guesty-run home: the one dark verb writes what Guesty never sees.** `channels/[propertyId]/page.tsx:212-224`: four to six ghost links, then `+ Booking` primary and `+ Block` secondary, under a notice saying nothing written here reaches an OTA (`guesty-writes.ts:29`). On a Guesty-run home make + Booking and + Block quiet and Property record the exit; keep them primary on a Helm-run home. [new-since-10/19] S

8. **Reference still carries Perfection.** `page.tsx:1326-1370`: a 12-term dl (Code, Type, Tags, Timezone, Coordinates, Perfection ID) and an "Open Perfection ↗" button, the only reference to `inspect.risingtidestr.com` in the app; `/inspections` is native now. 10/17 said one footer line: "Helm ID · Guesty ID · Last synced". [still-open-from-10/17] S

9. **Climate automation folds on every home with nothing to do.** `page.tsx:1296-1313` streams a fleet-wide Seam thermostat call into a collapsed fold that reads "No thermostats connected. Ask Ryan." (`ClimatePanel.tsx:82-84`) on every home while thermostats wait on Ecobee. Render the fold only when `climateProfile` exists or a thermostat is mapped. [new-since-10/19] S

10. **Roster row wears three chip faces.** `properties/page.tsx:262-330`: `N owner` (filled signal), `launch 3/18` (filled tide) or `ready` (outlined green), `N slips` (outlined). The owner count is a subset of the slips. One quiet count, "4 slips · 1 for owner", and the launch chip as the row's only colored mark. [still-open-from-10/17] S

11. **A lone link floats between the tab bar and the map.** "Stay Cape Ann listings →" at `properties/page.tsx:112-128`, 12px, in its own flex section. Either a tab (it is a fleet board like Guest gear) or a line under Coming online. [new-since-10/19] S

12. **Three doors to a note.** QuickCapture under "Add a note or update a fact" on Now (`page.tsx:832-835`), and `/notes/new` linked from `:899` (issue), `:1230` and `:1239` (fact). 10/17 said merge `/notes/new` into the section as an inline form and keep the edit page; the route is still a page. [still-open-from-10/17] M

13. **"Cleaning Est · manual fallback" on the Owner tab staff see.** `page.tsx:1409-1415`: a Stat whose sub-label is implementation vocabulary, linked to `/edit#cleaning`. Rename "Cleaning per turn (estimate)" and drop the sub, or move it to Reference. [still-open-from-10/17] S

14. **Edit page says its groups are the Facts tab's; they are not.** `edit/page.tsx:94` ("The groups are the Facts tab's, in its order") above ten groups (`:106-352`: Owner, Listing, House policy, Billing beyond the fact sheet's seven). Either match the groups or cut the sentence. [new-since-10/19] S

Sub-routes under `/properties/[id]` (20 pages): seven documents (home-guide, info-note, welcome-card, wifi-placard, trash-notice, notice/[id], work-slips/print), eleven editors (edit, layout, launch, order-checklist, stay-cape-ann, sync-guesty, caption-photos, notes/new, notes/[id]/edit, notices/new, notices/[id]/edit), one view (activity, reached only from the Now fold's "more" at `:2336`), one redirect. The documents and the long editors earn their routes; notes/new (finding 12) and the per-home channel grid (finding 4) are the two that read as panels.

### Pages to merge, demote or delete

| Page | Verdict | Why |
|---|---|---|
| `/channels/65_calderwood/message-preparation` | Merge into `/channels/[propertyId]` runbook as Message handover | A house in the URL, a third skin, owner-only review that belongs to Prepare cutover |
| `/channels/[propertyId]/calendar` | Merge Set a range into the hub calendar; delete route | Second calendar for one home; the grid adds one form and a legend |
| `/channels` (fleet index) | Demote to Coverage, Inquiries, Double-bookings, sync runs | Upcoming stays and four verbs duplicate the multi-calendar and Turnovers |
| `/properties/[id]/notes/new` | Merge into What we know / Flagged as an inline form | Third door to a note; 10/17 verdict still open |
| Guest & listing Listing/Pricing/Automations on a Guesty-run home | Fold under one line | 3,000 lines of PMS editor rendered as Draft on every home today |
| Facts Reference fold | Demote to one footer line | Perfection and twelve IDs; Helm has `/inspections` |
| Climate automation fold | Hide until a thermostat is mapped | "Ask Ryan" on every home |
| `/properties/stay-cape-ann` | Keep; move its link onto the tab bar | Orphan link above the map |
| Contracts, Leases, Guest gear, Trash notices, the seven guest documents, SCA launcher | Keep | In good shape |
