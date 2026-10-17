# D2: Field portal (/field), UI/UX audit

Scope: the external 1099 contractor portal under `src/app/field` (12 routes, 8,556 lines), its shared components (`FieldFormDraft`, `FieldAvatar`, `ReceiptCapture`, `PhotoUploader`, `PhoneInput`), and the auth plane in `src/lib/field-auth.ts`. Read in full, read-only. Every page was audited twice: as a contractor on a phone, and as the Operations Manager who will be asked to support those contractors from the staff side of Helm.

Two framing facts shape everything below:

1. The portal is a separate auth plane. `src/proxy.ts:39` and `:234` allow `/field` and `/field/*` without Helm SSO; identity is a per-contractor `portal_token` magic link plus a 90-day `field_session` cookie (`src/lib/field-auth.ts:22-23`). Nothing in the portal is reachable from the Helm masthead; staff reach it only through `?office=1` previews linked from `/fieldwork/roster` (`roster/page.tsx:174-175`) and `/fieldwork/packets/[id]`.
2. Almost every action that changes what a contractor can reach is owner-only on the office side. That matters for the audience in the brief and is problem #1 in the cluster summary.

`ReceiptCapture.tsx` and `FieldAvatar.tsx` were in the brief but are not used by any `/field` page: `ReceiptCapture` is the statements-page owner-receipt capture (`src/app/statements/page.tsx:34`), `FieldAvatar` is used only on `/fieldwork/packets` (two call sites). Neither is audited here beyond that note.

---

## The sign-in path for a brand-new contractor, end to end

This is the path the brief asked about first, so it comes first.

1. **Apply.** `/field/apply?trade=inspection|maintenance|creative` is public. The form (`apply/ApplyForm.tsx:100-150`) writes a `contractor_applications` row with `status: 'new'` and emails the office (`apply/actions.ts:55-75`). The thanks screen says: "We'll review your application and follow up by email with next steps. If it's a fit, you'll get a personal link to set up your account" (`apply/page.tsx:155-164`). No timeline, no contact. Nothing else happens on the applicant's side until step 2.
2. **Invite (owner only).** `inviteApplicant` (`src/app/fieldwork/hiring/actions.ts:28-70`) creates the `contractors` row with `status: 'invited'` and a fresh `portal_token`, and sends `sendInviteEmail` (`src/lib/field-notify.ts:71-95`, subject "Your Rising Tide Field portal", button "Open my portal"). The gate is `requireOwnerEmail()` (`hiring/actions.ts:22-24`); the hiring page says so in a comment: "inviting, declining and reopening an applicant are owner calls" (`hiring/page.tsx:67-68`). The Operations Manager can screen and shortlist and cannot invite.
3. **Magic link.** `/field/<token>` (`src/app/field/[token]/route.ts:10-33`) validates the token, mints a session row and the httpOnly cookie (`field-auth.ts:48-70`, `SESSION_TTL_DAYS = 90`), strips the token from the URL and lands on `/field` or on a whitelisted `?next=/field/...`. A bad, expired or archived token lands on `/field?invalid=1`: "That link is no longer valid. Your invite link has expired or was revoked. Ask Rising Tide to send a fresh one." (`field/page.tsx:469-474`).
4. **Onboarding.** `/field/onboarding` is titled "Two quick things before you claim" (`onboarding/page.tsx:33`). The two things are a full W-9 (legal name, business name, federal classification, street, city, state, ZIP, SSN or EIN) and a payment method (Venmo, Zelle, PayPal, Cash App, ACH routing plus account, or Check), plus an SMS opt-in, an agreement checkbox and a typed signature (`OnboardingForm.tsx:89-199`). `completeOnboarding` flips the row to `status: 'active'`, `w9_on_file: true`, `agreement_signed_at` (`field/actions.ts:402-418`) and emails the office "signed up, needs background check" (`field-notify.ts:266-275`).
5. **Background check (owner only, no notification).** `canClaim` requires onboarding complete AND `background_check_status` in `cleared` or `pending` (`src/lib/field-types.ts:171-177`). The office sets it from the roster (`roster/page.tsx:557-565`), gated to owners (`setContractorBackgroundCheck` -> `ownerEmail()` in `fieldwork/packets/actions.ts`). The action writes `background_check_by_email` and sends nothing to the contractor. Meanwhile the contractor's home page promises "As soon as it's running we'll text and email you, and your first packets open up right here" (`field/page.tsx:667`). That promise has no sender.
6. **Claim.** Once claimable, the home page shows "Available now" cards and the packet page shows the sticky "Claim this packet · est. $X" bar (`packet/[packetId]/page.tsx:1316-1337`). `claimPacket` is an atomic published -> claimed update with five bounce-backs (`field/actions.ts:433-517`): expired visit day (`?expired=1`), not in the offered-to list (silent redirect to `/field`), reliability block (`?blocked=1`), stale stops (`?stale=1`), lost the race (`?taken=1`).

**Where it strands them.**

- **A lost invite email is a locked door.** After 90 days of cookie life, a cleared Safari, or a new phone, `/field` shows "Open the personal link Rising Tide emailed you to see paid work near you. If you think you should have access, reach out to the office." (`field/page.tsx:471-474`). There is no "email me my link" form; the only self-service re-entry is a later SMS or email that happens to carry the token (new-work texts, the visit-day reminder, claim confirmations all do; `field-notify.ts:44-49` explains why). Resending the link is owner-only (`resendInvite` -> `ownerEmail()`), though staff can at least copy it from the roster (`roster/page.tsx:570`) and text it by hand.
- **The start-time email links bare `/field/packet/<id>`** (`field-notify.ts:149`, inside `sendStartTimeEmail`), the exact dead end `packetLink`'s own comment warns about. On a cookieless phone (Quo's in-app browser, a new device) the tap lands on the logged-out welcome page.
- **The background-check wait has no exit.** Between step 4 and step 5 the contractor sits on a brochure (see `/field` below) whose copy says the check is "underway" when the status is `not_started`, while the packet page for the same person says "Your background check hasn't started yet. You'll be able to claim as soon as the office kicks it off." (`packet/[packetId]/page.tsx:1340-1342`) and the profile says "Background check pending" (`profile/page.tsx:403`). Three statements, one state, and nobody is told when it changes.
- **Guessed URLs are handled, redirects are silent.** `claimPacket` on a packet not offered to you redirects to `/field` with no message (`field/actions.ts:456-458`); the packet page does the same for another trade's or an unpublished packet (`packet/[packetId]/page.tsx:685`). The `?taken=1` case got a proper line ("This packet was just claimed by another inspector", `:672-681`); the others did not.

---

## Pages

### /field/apply

**Purpose.** The public job ad and application form, one copy per trade, reached from outside Helm (Indeed, a text, a QR code) via `?trade=` and `?src=`.

**Entry points.** URL only. Nothing in `src/` links to it; the `src` param is for the office's own tracking (`apply/page.tsx:148`, `ApplyForm.tsx:102`).

**Inventory.** Role headline (`TRADE_META[trade].role`, e.g. "Vacation Rental Specialist"), intro paragraph, three bullets, the live creative rate ladder for `?trade=creative` (`apply/page.tsx:78-142`), then the form: Full name, Email, Phone, Where are you based?, Do you have a reliable vehicle? (Yes/No radios), When can you work?, How did you hear about us?, Tell us a little about yourself (or "Your work and handles" for creative), Short intro video (optional, under 30 s, "+ Record or upload a clip" with client-side duration check and direct-to-Blob upload, `ApplyVideo.tsx`), Submit application. Success screen "Thanks, we got it". 12 controls.

**New-hire friction.**
- The phone field is a plain `<input type="tel">` (`ApplyForm.tsx:112-115`); onboarding uses the formatting `PhoneInput` (`OnboardingForm.tsx:97`). Same datum, two behaviors, and the apply value is later shown back as the onboarding default.
- `?trade=cleaning` is accepted and stored (`parseTrade`, `apply/actions.ts:30`), but `TRADE_META.cleaning.nav` is `false` (`field-types.ts:78`), so a cleaning applicant is invisible to every trade switcher built from `NAV_TRADES`. A dead-end on the office side if the link is ever shared.
- The success screen promises follow-up "by email" with no timeframe. For a trade that posts work via SMS, the applicant has been given no second channel.
- Pillar wording here ("Supplies & inventory", `apply/page.tsx:33`) is the first of three copies of the same three pillars (see `/field` and the packet page).

**Overlap.** Office side: `/fieldwork/hiring` (applicant review).

**Owner vs staff.** Public page; nothing to gate. Downstream, the invite is owner-only (above).

**Proposals.**
- S: say what happens next and when ("Ryan reads applications on Tuesdays and texts if it's a fit"), and name the sender so the invite email is expected.
- S: use `PhoneInput` here too.
- S: refuse or hide `trade=cleaning` until the trade has a nav entry.

### /field (home)

**Purpose.** The contractor's board: who they are, what they have claimed, what is open near them. For a not-yet-cleared contractor it is instead a welcome brochure and a progress rail.

**Entry points.** Magic link landing; the "Rising Tide Field" wordmark (`FieldShell.tsx:53-72`); the "Work" tab (`FieldNav.tsx:13-18`); every email button ("See open work"); the `?office=1&trade=&stage=` preview from the roster (`roster/page.tsx:174-175`).

**Inventory, by state** (`field/page.tsx`):
- Logged out (`:465-478`): one headline, one paragraph. No form.
- Paused (`:482-498`): "Your account is paused" plus one line to call the office.
- Creative (`:509-565`): navy hero ("You're on the crew" / "Almost there"), optional "Finish setup: two quick things" button, "Your shoots" cards with pay in contributor voice ("Answer · can you take it?", "$120 paid · sent", "$80 · when the full set lands"), or a "How the pay works" explainer before setup.
- Employee (`:573-598`): "Your work lives in Helm now" with Open Helm, Property board, Report an issue.
- Not claimable (`:600-727`): hero with photo, "One step left / Welcome aboard / Action needed", the four-step JourneyRail (Applied, Account set up, Background check, Ready to claim), the setup button, a status paragraph; then "Who we are" (second navy plate), "01 The standard" (three pillars, `FieldPillars.tsx`), "02 How a visit works" (four numbered steps: Claim a packet, Bring your kit, Make it guest-ready, Submit and get paid), "03 What's waiting" (up to three masked packet cards, or "No routes are open this minute").
- Claimable (`:729-848`): `ContractorHeader` (photo, name, role, since, gold ★ average with count), the "Spotted something after a visit? Create a work slip →" card when a 72-hour visit exists (`:753-761`), "Your packets" (Up next, Recently finished, "Earlier packets · N" fold), "Available now" cards, or "No open packets right now".

Shell on every signed-in page: name link to profile (dotted underline, `FieldShell.tsx:74-81`), "Sign out", the tab strip (Work, Schedule, [Property work], [Rates], Profile), Ryan's contact plate ("Questions? Come straight to me." Text Ryan / Call, `RyanContact.tsx:14-37`), footer with the office number.

Packet card (`:247-318`): weekday-month-day eyebrow, headline from `packetHeadline` ("3 inspections on Rocky Neck", "2 jobs · 2 homes", "Set up 47 Atlantic", or the one-off's title), the home names, "4 mi away · <1 mi apart · 9:30 AM – 3 PM", the price in mono with "est. · $27 / stop" or "includes $50 bonus", "View →".

**New-hire friction.**
- **The brochure outlives its usefulness.** Every visit during the background-check wait (days, sometimes weeks) re-renders two navy plates and three numbered sections of recruiting copy (`:675-701`) above the only live thing, the teaser. The pillars appear a third time, re-worded, on the packet page pre-claim (`packet/[packetId]/page.tsx:281-315`, "Supplies & inventory" vs `FieldPillars.tsx:21-23` "Supplies"). Dotti's rule about explainer copy on operational surfaces applies here as much as to staff pages.
- **The rail and the copy disagree.** `activeIndex` is 2 ("Background check") the moment setup is done (`:609`), and the paragraph says the check is underway (`:667`), regardless of `background_check_status === 'not_started'`.
- **Jargon arrives undefined on the first screen:** packet, route, stop, claim, kit, crew, "est." (`:89-92`, `:309`). "Packet" is never defined anywhere in the portal; the closest is the maintenance line "Each stop is a specific maintenance job at a home" on the packet page (`packet/[packetId]/page.tsx:964-967`).
- **The report card is the only link to `/field/report`** and it vanishes 72 hours after the last packet stop (`:753`). A contractor who remembers something on day four has no path from the UI.
- **"Spotted something after a visit?" names the action "Create a work slip"**; the employee hero calls the same page "Report an issue" (`:593`); the page's own title is "Create a work slip" with an h1 "Notice something after you left?" (`report/page.tsx:11,43-47`).
- **No tab is active on `/field/report`**: the Work tab's matcher covers `/field/packet` and `/field/inspect` only (`FieldNav.tsx:17`).
- Density is fine once claimable: two sections, cards, one fold.
- Mobile: handled (`globals.css:1028-1043` wraps the price row under 440 px; the rail swaps to short labels).

**Overlap.** "Your packets · Up next" duplicates `/field/schedule` minus the cleaner time. The ★ average duplicates the profile header (same component, deliberate).

**Owner vs staff.** Contractor page. Staff see it only via `?office=1`, which disables buttons and swaps links to `#` (`:516,636,747`).

**Proposals.**
- M: after the first visit, collapse "Who we are / The standard / How a visit works" into one line with a "How it works" fold, and lead with the rail, the one next action, and the teaser.
- S: make the background-check line truthful to the status (not started / running / cleared), and send the text the copy promises when the office changes it.
- S: put "Report something" in the tab strip or under Profile so it is reachable on day four.
- S: one name for the report page everywhere ("Flag something").

### /field/onboarding

**Purpose.** Collect the W-9, the payout method, the agreement and a signature; flip the contractor to active.

**Entry points.** "Finish setup: two quick things" on the home hero (`field/page.tsx:526,658`); "Finish your account setup to claim this packet →" in the packet sticky bar (`packet/[packetId]/page.tsx:1344-1346`); `claimPacket` redirects here when `!canClaim` (`field/actions.ts:437`). Redirects home once complete (`onboarding/page.tsx:21`).

**Inventory.** 16 inputs: name, phone, W-9 legal name, business name, classification select, street, city, state (free text, 2 chars), ZIP, TIN type select (SSN/EIN), TIN (auto-formatted, `TinInput.tsx`), payment method select, then a handle or routing/account/type or a "we'll mail checks" note (`PaymentFields.tsx`), SMS opt-in checkbox (default on), agreement checkbox, typed signature in italic serif, "Finish & start browsing" (pending: "Setting up your account…"). Inline error scrolls into view (`OnboardingForm.tsx:204-220`).

**New-hire friction.**
- "Two quick things" (`onboarding/page.tsx:33`, home `:659`) is a tax form and bank details. The understatement costs trust at the SSN field.
- The lock note says "Your SSN is encrypted" even when EIN is selected (`OnboardingForm.tsx:148-151`).
- No home base field; the W-9 city/state/ZIP is geocoded for "near you" ranking (`field/actions.ts:375-399`). Reasonable, but a contractor whose tax address is a parent's house in Beverly will be ranked from Beverly with no way to say otherwise, because the profile has no edit form (see `/field/profile`).
- Nothing on this page says who reads the W-9 or when the first 1099 arrives beyond "year-end".
- Bad connection: `useRetainedSubmission` keeps every typed value and shows "Could not confirm your account setup. Your answers are kept. Reopen your portal in another tab to check before trying again." (`OnboardingForm.tsx:83-85`, `src/lib/use-retained-submission.ts`). Good.

**Overlap.** Office: the roster's W-9 and payment reveals.

**Owner vs staff.** Contractor page. On the office side, `setContractorW9` and the reveals are owner-only; staff see "W-9 needed" pills but cannot resolve them.

**Proposals.**
- S: title it for what it is ("Tax form, how we pay you, and the agreement") and say it takes five minutes.
- S: gate the SSN note on TIN type.
- Carry-over to profile: let them edit phone, payout handle and home town later (M, see profile).

### /field/packet/[packetId]

**Purpose.** The job runner: browse a packet, claim it, drive the route, start each stop's inspection (or mark a maintenance job done), close the open slips at each home, record receipts, drop the kit, submit. 1,395 lines, one page, every state.

**Entry points.** Packet cards on `/field` (`field/page.tsx:714,786-829`), the schedule rows (`schedule/page.tsx:181-186`), every packet email and SMS via the token route, the Stepper's "← Exit" (`inspect/[inspectionId]/page.tsx:230`), and `?office=1` from `/fieldwork/packets/[id]` (`packet/[packetId]/page.tsx:833`).

**Inventory, top to bottom (as the awarded contractor, mid-trip).** Office preview bar (staff only). Eyebrow: date, "· from 9 AM", the trip window ("9:30 AM – 3 PM"), "· done by 2 PM" (`:842-851`). Headline (`:852-854`). Pay line: "$81 estimated + $25 bonus + $27.60 receipts" (`:857-871`). Progress: "1 of 3 done" bar with "Ready to submit" / "Fix, then resubmit" (`:889-904`). Up to eight alerts, one colour each (`:915-958`): blocked, stale, expired, "Changes requested: … Please re-do the stops and submit again", "That inspection already has work in it, so it can't be reset", "Finish every stop before submitting", "The office booked this one for you", "From the office". Supply card "Stop 1 · 85 Eastern · Pick up supplies." with Directions, a tap-to-copy door code, "Restocking, by home", "Job parts in the bag"; folded to "✓ Kit picked up · What was in the bag" once a stop starts (`:361-409`). Route map, 220 px, numbered pins coloured by progress, drag disabled on touch (`PacketRouteMap.tsx`). Then one row per stop (`:995-1290`): number pin (orange ring on the current stop), address, "From the office" note, the maintenance slip (title, summary, location, "Bring: …", photos), a status line ("In progress · on site · 23 min · ✓ entered · Open after 11 AM", or "Cleaner keyed in 10:08 AM · on site now"), a guest/owner presence line, the chip row (Maps ↗, CODE 4122, How to get in, Call for entry, ⓘ Arrival & parking, 📦 Supply closet), the maintenance "Mark done" form with "+ add note or photo" / "📷 add a photo", the `StopWorkList` ("At this stop · 2 to do", "Also open at this home · 5", "Restock · 1 to go"; tap the circle to finish, tap ⓘ for details, "Done, with photo or note", "Already handled", "Edit"), and on the right the full-width "Start inspection / Resume inspection" button with "Reset this stop" beneath it, or "Done" with "Reopen". Finished stops collapse to "Done · 23 min on site · ✓ entered" with a "Details" fold (`:1136-1167`). Then "Last stop · drop your kit back at 85 Eastern" (`:455-485`). Then the sticky bar: Claim / setup nudge / background-check nudge / "Submit completed packet" / "Resubmit packet" / "Submitted for review. We'll message you as soon as it's approved." / "Approved. $X is on its way. You'll get a receipt the moment it's sent." plus bonus and receipts lines (`:1300-1391`).

Roughly 30 distinct controls across states; on a three-stop trip with open slips at each home, 60 to 90 interactive rows on one scroll.

**New-hire friction.**
- **Order on a phone is right for the inspection path and wrong for receipts.** Start → deck → review → back here → next stop → submit reads naturally. But a receipt can only be entered on a task completion (`MaintenanceComplete.tsx:137-151`, `StopWorkList.tsx:313-327`). An inspector who buys batteries for a pure inspection stop with no attached slip has no receipt field on that stop at all; the nearest doors are `/field/report` (within 72 h) or the property board (if granted). The brief's question "can a contractor tell what they will be paid" has a sub-answer: they cannot always tell where to put a cost.
- **Two gestures with different meanings for the same slip.** On this page the circle marks a slip done and credits the contractor (`field/actions.ts:1066-1115`, outcome `'done'`). On the Stepper's review screen the same unattached slip appears under "Still on the list" where a tap means "It's handled, we'll take it off the list" and files an "Already handled by the time X arrived" note that explicitly does not credit them (`Stepper.tsx:630-690`, `field/actions.ts:1096-1099`). A contractor who fixes the dripping faucet during the walk and taps it there is recorded as having found it fixed.
- **Mark done does not close anything.** Packet-path completions leave the slip `in_progress` until the office approves (`field/actions.ts:800-813`, `868-939`); the board path closes it outright (`:192-208`). The portal says "Done on this trip" either way. When the office board still shows the job open, neither the contractor nor the ops manager is told why; the memory's own diagnosis ("check for an unapproved submitted packet") lives nowhere in the UI.
- **"Reset this stop" vs "Reopen."** Reset (`undoStartStop`) deletes an empty inspection and reverts the stop; it refuses if any mark exists (`field/actions.ts:717-719`). Reopen (`reopenStop`) un-finalises a completed inspection keeping marks (`:634-686`). Both sit in the same quiet pill style (`quietBtn`, `:48`) with no hint that one is destructive-if-allowed and the other is safe.
- **"Already handled" and "Skipped by the office"** are two outcomes with office-side names the contractor has no reason to know.
- **Silent money clamps.** Receipts over $500 are clamped to $500 with no message at three sites (`field/actions.ts:100`, `:790`, `:912`); only the report form carries `max=500` client-side (`ReportIssueForm.tsx:251`). The board and packet receipt inputs have no cap.
- **The StopWorkList reintroduces the density Dotti stripped in #1352.** Every open slip at the home is listed under the stop by default (`:712-714`, "Ryan, 2026-09-14"; hint text `StopWorkList.tsx:407` "Every open work slip here"). A home with eight open slips puts eight rows, each with a circle and an ⓘ, between the inspector and the next stop. This is a decision made on purpose; it is still the main reason the page is long.
- **The estimate.** Pre-claim the price is 30 px with an "Estimated" pill and "for 3 stops · $27 each" (`:873-887`); post-claim it is a 15 px mono line (`:857-871`). "Confirmed after your visit" appears in emails (`field-notify.ts`, claim confirmation) but not on the page, so a contractor reading only the portal is never told the number can go down.
- Guest-in-house and owner-hold cues are good: one loud red block with a Call pill, one quiet line (`:1242-1257`).
- Mobile: the stop row wraps and the Start button goes full width under the details (`globals.css:1003-1022`); the sticky bar respects the safe area (`:1309`). The map loads Leaflet from unpkg and degrades to "Map unavailable right now. Tap a stop's address below for directions." (`PacketRouteMap.tsx:145-150`).

**Overlap.** Office `/fieldwork/packets/[id]` (the same packet with approve/pay/assign); `/field/schedule` (the same stops with cleaner times); the Stepper review screen (the same open slips).

**Owner vs staff.** Contractor page. The `?office=1` preview is the only staff view; it renders exactly what the awarded contractor sees and disables buttons (`:609-616`, `:841`).

**Proposals.**
- M: one receipt rail per stop, not per task: a single "Add a receipt" chip in the stop's chip row that homes onto the packet regardless of whether a slip exists, with the $500 cap stated on the field.
- M: unify the two slip gestures: the review screen's "Still on the list" offers the same three outcomes the packet page does (done / already handled / still open), with the same words.
- S: tell them what "Done on this trip" means: "Counted toward this trip; the office closes it when they approve."
- S: name the two undo verbs for what they do: "Undo start (nothing saved yet)" and "Reopen (keeps your marks)".
- S: show "Estimated · confirmed after your visit" on the page, not only in email.

### /field/inspect/[inspectionId]

**Purpose.** Mount the shared inspection Stepper for one packet stop; return to the packet when complete.

**Entry points.** "Start inspection / Resume inspection" on the packet page (`StartStop.tsx`, `field/actions.ts:546-620`). Completed inspections redirect back (`inspect/[inspectionId]/page.tsx:60`).

**Inventory** (`src/app/inspections/[id]/Stepper.tsx`, field props at `:125-137`). Top bar: "← Exit", "+ Slip", progress. Per card: zone, title, description, frozen note, existing notes and slips, "+ Add note", "+ Photo", "+ Work slip"; sticky bottom: Issue / N/A / Pass, "← Start | Prev", "N of M", "Skip →" (`:1118-1145`). An Issue card demands a photo before completion (`:952-962`). Trailing task cards for attached slips: "Mark done →", "Skip for now", "Next →" (`:1185-1240`). Review: "All 42 cards. Ready to wrap?", the card list with status badges, "Supplies Check", "Still on the list", "N cards are still unmarked. Jump to the first →", "N one-off tasks are still open. Do them now →", "← Back", "Complete Inspection →" (`:536-760`). Unsynced marks show "Recovered unsynced marks from this device" and "Retry now" (`:189`, `:696-704`).

**New-hire friction.**
- **The only forward control on a card is labelled "Skip →"** (`:1141-1143`). A new inspector reads it as "skip this card", which is also what it does, so marked cards advance by mark and unmarked by Skip; the label just never says "Next".
- **"Cards", "marks", "N/A", "Issue", "Pass", "Supplies Check", "one-off task", "Still on the list"** are all introduced inside the deck with no definition. "Issue" has a real consequence (it becomes a work slip at approval, `inspections/actions.ts:370-376`) that the contractor is never told; the deck text only says a photo is required.
- **The Exit link's href is `/inspections`** (`Stepper.tsx:1278`); only the onClick redirects to the packet. A long-press "open in new tab" or any click before hydration sends a contractor to Helm's Google sign-in, which rejects non-company emails.
- The deck is the one place in the portal with no portal chrome (no nav, no Ryan plate): correct for a 40-card walk, but the only way out is "← Exit" with a confirm when saves are in flight (`:319-331`).
- Good: autosave queue with device drafts and explicit retry; the review screen refuses to complete while marks are unsynced (`:745-756`).

**Overlap.** Staff `/inspections/[id]` (same Stepper, byte-identical minus field props). The "Still on the list" block duplicates the packet page's "Also open at this home".

**Owner vs staff.** Contractor-only mount; staff have their own route.

**Proposals.**
- S: relabel "Skip →" to "Next →" when the card is marked, "Skip →" only when it is not.
- S: fix the Exit href to `exitHref`.
- S: one line under Issue the first time: "An Issue becomes a work order once the office approves your trip."

### /field/report

**Purpose.** File a maintenance slip for a home visited in the last 72 hours, with a photo and an optional receipt.

**Entry points.** The home card (only while a visit is in window, `field/page.tsx:753-761`), the employee hero (`:593`), URL. Not in the tab strip.

**Inventory.** "← Back to work"; eyebrow "Create a work slip"; h1 "Notice something after you left?"; Which home? (select, "21 Horton · Gloucester [em dash] 3 hours ago"; hint "68h left to flag · only homes you visited in the last 72h show here"); What needs attention?; Where in the home? (optional); Anything else? (optional); How soon? (Whenever / Normal / Soon, `ReportIssueForm.tsx:19-23`); Add a photo; Receipt total $ (optional, max 500); "Send to the office" ("Saving and confirming…", "Check / retry report"); "Your report has not been sent yet." Success: "Flagged. The office has it." with "Flag another" / "Back to work". Empty: "No recent visits to flag" with an explanation and "Back to work" (`report/page.tsx:50-61`). 9 controls.

**New-hire friction.**
- **Visits are packet stops only** (`src/lib/field-report.ts:65-91`). A contractor who works from the property board (Delaney's own pattern per the project memory) never has a visit here; the page is permanently "No recent visits to flag" for them while the board accepts a slip for any home. Two doors, two gates, one output.
- **Priority words differ from the board's** ("Whenever / Normal / Soon" here, "Low / Normal / High priority" at `BoardControls.tsx:118-122`).
- **"work slip" (title), "Flagged" (success), "work order on the team's board" (success copy `:123`)**: three names in one flow.
- Best-hardened form in the portal: a per-attempt `submission_id` makes retries idempotent (`field/actions.ts:62-71`), drafts persist per home, and the window is re-checked server-side (`:90-94`) with a clear message when it has closed.

**Overlap.** `/field/property-work` "+ File a work slip"; the Stepper's "+ Work slip" mid-walk; the office `/work` board.

**Owner vs staff.** Contractor page.

**Proposals.**
- M: merge the two filing doors (see cluster list): one "Flag something" form reachable from the tab strip, defaulting the home to a recent visit when one exists, open to any home when the board grant exists, with the report form's idempotency and the board's reach.
- S: one priority vocabulary portal-wide.

### /field/property-work

**Purpose.** For office-granted contractors: every home's open slips, mark done directly, file new ones, and the guest-gear grid.

**Entry points.** "Property work" tab when `work_board_access` is true (`FieldShell.tsx:27`, `FieldNav.tsx:37-41`); the employee hero's "Property board".

**Inventory.** h1; a four-line explainer ("Every home's open work slips. Mark what you fix, file what you spot. These are unscheduled and unpaid extras unless the office puts one on a trip; anything unclear, call the office.", `property-work/page.tsx:46-49`); `?ontrip=1` banner; "+ File a work slip" (form: Which home…, What needs attention, Details, priority select, photos, "$ receipt total … (added to your payout)", "File it", cancel); "Guest gear" fold with the `GearGrid`; "12 open across 7 homes · 3 more on scheduled trips"; one sticky `<details>` per home ("21 Horton · 4 open · 1 high · oldest 12 days ago"); slip rows with title, high pill, age, description, 📍 location, photos, "Mark done" + "+ add note or photo" (photos, note, receipt). About 8 controls plus 2 per slip.

**New-hire friction.**
- **The page contradicts itself on money.** "unscheduled and unpaid extras" (`:47-48`) and, in the same page's form, "receipt total, if you bought something for the house (added to your payout)" (`BoardControls.tsx:124`). Which payout? `resolveReceiptPacket` homes it onto a live or 72-hour trip at that home, else leaves it open for the office (`field/actions.ts:188-189`); none of that is on screen.
- **The explainer is doing the UI's job.** Four sentences stand in for a label on the list ("Unpaid unless on a trip") and a label on the receipt field.
- **Least connection-hardened forms in the portal.** `completeBoardSlip` and `createBoardSlip` are plain server actions with a raw `useFormStatus` button (`BoardControls.tsx:8-22`), no `confirmedSave`, no idempotency key, and no `SubmitButton` watchdog. A shed response leaves "Saving…" forever; a retry files the slip twice. Every other write in the portal has at least one of those guards.
- **Mark done here is terminal** (status `done`, `field/actions.ts:195`), unlike the packet path. Nothing says so.
- Slips held back because they ride a live packet appear only as a count (`:82`); the contractor cannot see which ones, so "where did that job go" has no answer here.
- `limit(400)` on active slips (`src/lib/field-work-board.ts:89`) with no indication when truncated.

**Overlap.** Office `/work` (same slips); `/work/gear` (same grid, `saveGearCellField`); `/field/report`.

**Owner vs staff.** Contractor page; the grant that unlocks it is owner-only (`setContractorWorkBoard` -> `ownerEmail()`).

**Proposals.**
- S: replace the explainer with two labels: a chip on each slip ("Not on a trip · unpaid") and a receipt hint that says where the money goes.
- S: idempotency key plus `confirmedSave` on both board forms, and the house `SubmitButton`.
- S: list held-back slips greyed with "on <packet title>" instead of a bare count.

### /field/schedule

**Purpose.** The contractor's claimed stops by day with Cape Ann Elite's booked cleaning time beside each.

**Entry points.** "Schedule" tab for non-creative contractors (`FieldShell.tsx:34`).

**Inventory.** "Your schedule"; per day "Today · Friday, October 17"; rows with the cleaning time in amber mono or "not announced", property name, address, "<packet title> →"; empty "No claimed work coming up. See what's available →"; footer "Times are Cape Ann Elite's own booking and can move. If a home is still being cleaned when you arrive, call the office rather than working around them." (`schedule/page.tsx:195-200`). 1 control per row.

**New-hire friction.**
- **This is the coordination copy Dotti removed from the packet page** (#1355, "why are we overcomplicating things again?"). It survives here word for word.
- The tab adds one datum (cleaner time) to data the home page already shows, and sends the contractor back to the packet page to act. Submitted and approved packets are included (`:39`), so finished days appear under "Your schedule" with a cleaning time nobody needs.
- "not announced" is honest but reads as a status of the contractor's own stop.

**Overlap.** `/field` "Your packets · Up next"; the packet page's per-stop cleaner line.

**Owner vs staff.** Contractor page.

**Proposals.**
- M: fold the cleaner time into the packet page stop line (it already shows "Cleaner keyed in 10:08 AM" from Seam) and delete this tab and its footer.

### /field/profile

**Purpose.** Who the contractor is to Rising Tide: rating, streak, lifetime pay, reviews, history, notifications, account standing.

**Entry points.** "Profile" tab; the name in the header (`FieldShell.tsx:74-81`).

**Inventory.** `ContractorHeader` (photo with "Change photo", name, "Vacation Rental Specialist · since June 2026", ★★★★☆ 4.71 / 5 · 14 reviews). "Work streak" card with an ⓘ popover, "3 more days → +$100", "2 days in a row", a track with Day 5 +$100 / Day 7 +$150 / Day 10 +$300 (`profile/page.tsx:202-292`, amounts from `field-streaks.ts:20-24`). Stat tiles: Earned to date, Approved unpaid, Bonus counting, Jobs completed, On time % (`:82-93`). Guest reviews (3 + "Show N more"). Work history (3 + fold; title, date, $pay, "in progress / submitted / approved / paid"). Notifications: "Text me when new work is posted" switch (`SmsToggle.tsx`). Account: W-9 on file, Contractor agreement signed, Background check …, Payout method set · Venmo · ••1234, Profile photo, "4 of 5 complete" bar (`:409-453`). About 7 controls.

**New-hire friction.**
- **Nothing here is editable except the photo and the SMS switch.** Phone, payout handle, address, home town: no form (the memory lists "/field/profile self-edit" as open since June). A changed Venmo handle means a text to Ryan and an owner-only edit on the office side.
- **"Approved, unpaid"** is office ledger language (the creative label is "On the way", `:85`); the packet page for the same money says "is on its way".
- **Pay timing is never stated for packet trades.** The approved email says "payment is queued; you'll get a receipt the moment it's sent" (`field-notify.ts`, `sendApprovedEmail`); the creative rate card says "paid monthly" (`rate-card/page.tsx:105-108`). An inspector cannot find out whether Rising Tide pays weekly, monthly, or on approval.
- **The Account meter counts the photo** (`:422`), so a compliant contractor without a photo reads "4 of 5 complete" forever. A completion bar is also the one gamified element Dotti did not sanction (the streak line was the sanctioned exception, and it has since grown into a milestone track with a popover).
- The ⓘ popover is a `<details>` positioned absolutely 250 px wide (`:214-224`); on a 360 px phone it overflows to the right.

**Overlap.** Header duplicates `/field`'s (same component). Pay stats duplicate the roster's per-contractor owed/paid.

**Owner vs staff.** Contractor page.

**Proposals.**
- M: an "Edit details" form for phone, payout method and home town, with the same encrypted save path onboarding uses.
- S: say when pay goes out ("Approved trips are paid by Venmo on Fridays" or whatever is true) under "Approved, unpaid".
- S: drop the photo from the meter, or drop the meter.

### /field/rate-card

**Purpose.** A creative contributor's current pay ladder and terms. Fine as it is: one table, one terms list, one footer. Non-creative contractors are redirected home (`rate-card/page.tsx:24`).

### /field/shoot/[shootId]

**Purpose.** The creative contributor's shoot brief and the yes/no on an offered day.

**Entry points.** `/b/<token>` short link from the offer SMS/email (`src/app/b/[token]/route.ts:19-49`), the shoot cards on `/field` (`field/page.tsx:406-437`), `?office=1` from `/fieldwork/shoots`.

**Inventory.** "← Your portal"; date; title; address · Map ↗; outcome banners (accepted / declined / expired); the answer panel ("Can you take it?", "Yes, I'll take it", "Can't make it" → optional reason → "Send my pass" / Back, `AnswerPanel.tsx:36-98`); day-status line; hero photo; What we need; Your window; Where to park; Getting in (offer: "We'll send the way in as soon as you accept"; else door code, lockbox, or "shows here the day before"); Know the home (See the listing guests see →); Delivering; footer. 4 to 6 controls.

**New-hire friction.**
- The page abandons `FieldShell`: no tab strip, no Ryan plate, a different footer ("Rising Tide · Field [em dash] questions about the day? Call or text the office.", `:232-234`). The only way back is a 12 px "← Your portal".
- The door code is plain text (`:251-258`), not the tap-to-copy chip the packet page uses (`CopyCode`).
- Two em dashes in contractor-facing copy (`:98`, `:233`).
- Otherwise clear; the offer-before-reveal logic is well explained in place.

**Overlap.** `/field` shoot cards (pay summary). Office `/fieldwork/shoots`.

**Owner vs staff.** Contractor page; the office side (`/fieldwork/shoots`) is owner-only (`helm-access.ts:80`), so the Operations Manager cannot see the shoot that produced a brief.

**Proposals.**
- S: render inside `FieldShell` (nav, contact plate), and use `CopyCode` for the code.

### /field/[token] and /b/[token]

Route handlers, no UI. Both validate and redirect; both send failures to `/field?invalid=1`. The `?next=` whitelist is correct (`[token]/route.ts:27-31`). One gap: a valid token with an expired visit on `?next=/field/packet/<id>` lands on a packet whose only message is the expired banner; fine.

---

## On a bad connection, portal-wide

What exists, and it is a lot: photo drafts in IndexedDB with recovery, per-file retry and a submit guard (`PhotoUploader.tsx:160-212`, `:435-459`); form drafts in localStorage with "Draft saved on this device. Not submitted yet." (`FieldFormDraft.tsx:53-60`); `confirmedSave` with a 15 s bound and a read-back confirm (`src/lib/confirmed-save.ts`); the `SubmitButton` watchdog that reloads at 30 s (`SubmitButton.tsx:12-21`); the Stepper's save queue and "Retry now"; the report form's idempotency key; a 20-second `AutoRefresh` while a trip is live (`packet/[packetId]/page.tsx:908`); the map's failure line.

What is missing: the property-board forms have none of it (above); `StartStop` has no watchdog, so "Opening inspection…" can pin after a shed response even though the inspection row was created and a reload would show "Resume inspection" (`StartStop.tsx:13-34`); and the language is inconsistent, with "Saving and confirming…", "Check / retry save", "Check / retry report", "Retry or remove failed photos", "Saving…" and "Marking…" all meaning roughly "we are not sure it landed". A contractor on one bar of signal meets six phrasings of the same state.

## Can a contractor tell what they will be paid, and when

What: yes, per packet, with caveats. The card and the page show the estimate (`est.` / "Estimated"), the post-claim line shows base + bonus + receipts, the approval bar shows the total, the profile sums paid and "Approved, unpaid". What they are not told on any page: that the base is re-set from actual time on site after the visit (only the emails say "confirmed after your visit"), that receipts cap at $500, that packet-path slip completions do not pay until approval, and that board work is unpaid unless the office puts it on a trip (one sentence, on one page). When: never stated for packet trades. The streak bonus is the best-explained money in the portal.

---

## Cluster summary

### The five biggest structural problems, ranked

1. **The Operations Manager cannot support the people she manages.** Every contractor-lifecycle action is owner-only: invite, decline, reopen (`hiring/actions.ts:22-29`); resend or rotate a link, pause, reactivate, retire, background check, work-board grant, W-9 flag, employment flag (`fieldwork/packets/actions.ts`, each `await ownerEmail()`); approve, request changes, bonus, final pay, mark paid (`approvePacket` :1403, `markPacketPaid` :1111, `requestChanges`, `setPacketBonus`, `finalizePacketPayout`). Staff see read-only labels where the buttons would be (`roster/page.tsx:552-554`). The four most common support asks (my link is dead; I finished setup, when can I claim; my packet is stuck in review; when do I get paid) all route past her to Ryan or Dotti. She can publish, assign, release, cancel and submit-for-contractor, which is the half of the lifecycle contractors rarely ask about.
2. **Re-entry is a single thread.** One magic link, a 90-day cookie, no self-serve resend, a logged-out page that says "find the email", a resend action gated to owners, and one email that links the bare `/field/packet/<id>` (`field-notify.ts`, `sendStartTimeEmail`). The promised background-check notification is never sent (`setContractorBackgroundCheck` writes only `background_check_by_email`), so the wait between onboarding and the first claim is both silent and mis-described (`field/page.tsx:667` vs `packet/[packetId]/page.tsx:1340-1342` vs `profile/page.tsx:403`).
3. **Four doors to the same work slip, four gates, three meanings.** Packet-page circle (done, credits them, holds `in_progress` until approval), Stepper "Still on the list" (already handled, no credit), property board Mark done (closes outright, no visit gate), `/field/report` (72-hour packet-visit gate, idempotent). Receipts ride on four forms with a silent $500 clamp and no stated payday. The contractor cannot tell which door pays, which closes, or why the office board still shows the job open (`field/actions.ts:195` vs `:800-813`; `Stepper.tsx:630-690` vs `StopWorkList.tsx:168-191`).
4. **Vocabulary drifts between office and portal and inside the portal.** packet / trip / route / job; stop / job / Home N; slip / task / one-off task / work order / issue / "Flagged"; est. / Estimated / final; Reset / Reopen; Whenever-Normal-Soon / Low-Normal-High; "Approved, unpaid" / "on its way"; Assigned / Claimed / Offered to / Released. None is defined on any contractor surface. The three pillar copies (`apply/page.tsx:30-34`, `FieldPillars.tsx:12-25`, `packet/[packetId]/page.tsx:281-297`) differ in wording.
5. **The packet page is one 1,395-line scroll for every state, and the working state is dense again.** Browse, claim, work, receipt and read-only review share one page; while working, each stop carries every open slip at its home (`:712-714`, per Ryan 2026-09-14), two undo verbs, up to six chips, and a cleaner line, under eight possible alerts and a supply card, over a sticky bar. The Schedule tab then re-adds the "call the office rather than working around them" footer (`schedule/page.tsx:196-199`) that #1355 removed from this page.

### Vocabulary a new hire meets in this cluster

| Term | Meaning (from the code) | Defined in the UI? |
|---|---|---|
| packet | A priced bundle of stops on one visit date, one trade, one contractor (`field-types.ts:185-247`). Emails call it a "trip"; the home page calls it a "route". | No |
| stop | One home on a packet, or one work slip for maintenance; "Home 1" when masked (`packet/[packetId]/page.tsx:667-668`) | Only for maintenance (`:964-967`) |
| claim | First-come atomic award of a published packet (`field/actions.ts:477-489`). The office also "assigns" (same status) and "offers to" (visibility) | No |
| release | Office returns a claimed packet to the board; contractor email says "came off your plate" | No |
| window / "Open after 11 AM" / "Finish by 3 PM" | The stop's start and deadline from the home's own checkout and check-in hours (`stopTiming`, `:84-116`) | By example only |
| est. / Estimated / final | Posted price at claim; the office re-sets the base from time on site after the visit (`effectiveBaseCents`) | Only in email |
| bonus / receipts / expenses | Additive pay lines; "expenses" is the office word for "receipts" | Partly |
| kit / supply run / supply closet / restock / bins | The 85 Eastern bag packed per trip; restock slips come from Supplies Check | Partly (`:361-409`) |
| work slip / slip / task / one-off task / job / issue / work order | One `work_slips` row | No |
| Issue / Pass / N/A / card / mark | Stepper results; an Issue becomes a slip at approval | No |
| Still on the list / Already handled / Done on this trip / Skipped by the office | Slip outcomes recorded from a stop | Partly (`StopWorkList.tsx:343`) |
| submitted / in review / approved / paid / Changes requested | Packet lifecycle after the contractor's part (`field-packet-status.ts:31-39`) | Partly |
| background check: not_started / pending / cleared / failed | The owner-set gate on claiming; "pending" already unlocks claiming | No, and three different phrasings |
| streak / milestone / cycle | Consecutive worked days; $100 / $150 / $300 at days 5 / 7 / 10, 10-day cycle | Yes (popover) |
| ✓ entered / keyed in / on site | Seam door events for the inspector and for the cleaner | No |
| Property work (board) / the team's board / Helm | The office `/work` board seen through the grant | No |
| Guest gear | Pack 'n play and high chair locations | Yes (summary line) |
| setup packet / one-off job / routine check | Packet kinds (`field-types.ts:183`) | Partly (`SetupScope`, `AdhocScope`) |

### Pages to merge, demote or delete

- **Merge `/field/report` into one "Flag something" form** reachable from the tab strip, defaulting to a recent visit and open to any home when the board grant exists; keep the report form's idempotency and drafts, retire the board's bare forms.
- **Demote `/field/schedule`** to a cleaner-time line on the packet page stop (which already shows Seam-verified cleaner entry) and delete the tab and its footer.
- **Delete the pre-claim brochure sections on `/field`** after the first visit ("Who we are", "The standard", "How a visit works"), and delete `InspectionScope` from the packet page; one copy of the pillars belongs on `/field/apply`.
- **Fold `/field/shoot/[id]` into `FieldShell`**; it is the only signed-in page without the nav or the contact plate.
- Keep `/field/rate-card` and `/field/property-work` as they are structurally; fix their copy and forms.

### Plain bugs (kept separate so they are not lost)

1. `sendStartTimeEmail` links bare `/field/packet/<id>` instead of `packetLink()` (`src/lib/field-notify.ts:149`); dead end on a cookieless phone, contradicting the comment at `:44-49`.
2. Stepper "← Exit" anchor has `href="/inspections"` (`src/app/inspections/[id]/Stepper.tsx:1278`); only the onClick honours `exitHref`. Open-in-new-tab or a pre-hydration tap sends a contractor to Helm SSO.
3. The home page promises a text and email when the background check starts (`src/app/field/page.tsx:667`); `setContractorBackgroundCheck` sends nothing.
4. Three contradictory descriptions of `background_check_status = not_started`: "underway" (`field/page.tsx:667`), "hasn't started yet" (`packet/[packetId]/page.tsx:1340-1342`), "pending" (`profile/page.tsx:403`).
5. Receipt amounts over $500 are clamped silently at `src/app/field/actions.ts:100`, `:790`, `:912`; only the report input has `max=500` (`ReportIssueForm.tsx:251`).
6. `completeBoardSlip` / `createBoardSlip` have no idempotency key, no `confirmedSave`, and a raw `useFormStatus` button (`BoardControls.tsx:8-22`); a shed response pins "Saving…" and a retry double-files.
7. `StartStop` has no stuck-pending watchdog (`StartStop.tsx:13-34`); "Opening inspection…" can pin after a shed response although the stop was started server-side.
8. The property-work page says the work is "unpaid extras" (`property-work/page.tsx:47-48`) and its form says the receipt is "added to your payout" (`BoardControls.tsx:124`).
9. The Schedule footer repeats the coordination copy removed in #1355 (`schedule/page.tsx:196-199`).
10. The profile Account meter counts the profile photo as one of five required items (`profile/page.tsx:422`).
11. Onboarding's "Your SSN is encrypted" note renders for EIN too (`OnboardingForm.tsx:148-151`).
12. `/field/apply?trade=cleaning` is accepted while `TRADE_META.cleaning.nav === false` (`field-types.ts:78`); applicants land in a trade no switcher shows.
13. Em dashes in contractor-facing copy, against the house rule: `shoot/[shootId]/page.tsx:98` and `:233`; `ReportIssueForm.tsx:242`; in `field-notify.ts` the approved email heading and lede ("Approved [em dash] payment queued", "Nice work [em dash] "), the paid email ("Thanks for the great work [em dash] more packets"), the new-work SMS ("new work near you [em dash] "), and the visit-day SMS ("your visit is today [em dash] ").
14. The Stepper's forward button reads "Skip →" for every card (`Stepper.tsx:1141-1143`).
15. `sendContractorNote` (`field/actions.ts:27-34`) has no caller in any `.tsx`; the "send a note" rail it serves does not exist in the UI (dead code, not a user-facing fault).
16. Stale comment: `profile/page.tsx:201` describes "day-5 (+$100) and day-10 (+$250)"; `STREAK_MILESTONES` is 5 / 7 / 10 at $100 / $150 / $300 (`field-streaks.ts:20-24`). The rendered bar is correct.

### Surprising

- The office preview (`/field?office=1&trade=&stage=`, `/field/packet/<id>?office=1`, `/field/shoot/<id>?office=1`) is the best support tool in the cluster and the only one staff can fully use. It should be the Operations Manager's first stop, and nothing in Helm's own nav points to it except one small link on the roster.
- A former contractor turned employee keeps her Field identity (`employment_status: 'employee'`, `field/page.tsx:573-598`): she can still use the property board and report form under her own name, which is exactly how Delaney filed most of the fleet's slips. Her support view of other contractors is read-only; her own portal is not.
