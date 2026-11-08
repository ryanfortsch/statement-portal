# Messaging: UX audit, 2026-11-07

Scope read: `src/app/messaging/**`, `src/app/owner-messaging/**`, `src/app/cleaner-messaging` and `src/app/contractor-messaging` (no `page.tsx` in either; both are 308 redirects in `next.config.ts:156-161` and the folders now hold only components the Team page imports), `src/components/messaging/**` and the shared inbox components.

### Still good

- One card, one verb set. The resting footer is exactly five controls in three weights: Approve & send (split, the only dark face), Edit and Coach as secondaries, Redraft and Mark handled as quiet text (`ApprovalCard.tsx:812-831`). Each hover title says what the verb does and whether a guest is contacted (`:657,675,687`). Mark handled is the one door for no reply.
- "Also on approve" is one list with one Details toggle; a body opens by itself only when it needs an answer (`AlsoOnApprove.tsx:16-47`). The guest card's quote, add-on, slip and handoff blocks are lines now, not four coloured boxes.
- A waiting card says why in plain words: "Not sent: the texting account is out of credit", "They wrote again. Check the reply still fits" (`card-wait-reason.ts:57-69`).
- Mobile is not a second implementation. `MobileInboxReview` wraps the same card in a collapsed row and keeps its state mounted (`MobileInboxReview.tsx:31-43`).
- Loading skeletons match the page (tabs, QueueSkeleton, footer; no hero, no "Opus" line), staff see the Owners tab dropped and "Ask Ryan to price this" instead of a dead button (`MessagingQueue.tsx:630-636`), and the queue is the first thing on every inbox page with search and routine health at the foot.

### Findings

1. **The Proactive messages form is still on Send, and it exists twice.** `send/page.tsx:116-119` renders `RemindersSection` (614 lines) under the Message composer; `ProactiveRemindersPanel` (715 lines) is the same form for owners and Team, same title and eyebrow ("Proactive messages", "recurring + one-time", `RemindersSection.tsx:78-80`, `ProactiveRemindersPanel.tsx:123-124`), same Polish, same End, same `window.confirm` (`:606`, `:707`). The Message tab therefore still has three ways to send later: the split button, One-time, Recurring, and a Send select offering Auto-send (`:92-93`). Delete `RemindersSection`; the composer's Send later covers one-time; a recurring guest message is rare and lives on the stay. [still-open-from-10/17] M

2. **Quality is a seven-section stack with two designs for one job.** `quality/page.tsx:186-202`: guest facts in `TriagedPropertyUpdates` (464 lines), then cleaner, contractor and owner facts each in `ProposedPropertyUpdatesCard` (532 lines, the older design), then Reflection proposals, then `PerformanceDropdown` (1,412 lines: three tabs, four windows, a 56px hero at `:387`, a trend chart, six KPI tiles at `:447-475`, a tier strip at `:509-515`, a facts editor), then the owner facts textarea. It still wraps itself in a disclosure defaulting open (`:84`) on a page where nothing else competes. One proposed-updates design with an audience column; Performance keeps the one number and the chart and folds the tiles and tiers behind Learning; the disclosure wrapper goes. [still-open-from-10/17] L

3. **Recent activity still prints in four places.** Decided recently (`page.tsx:231`), Follow-up history, 7 days (`:240`, `RecentMessageOutcomes.tsx:37`), Search all inboxes with a Handled status over the same 7 days (`InboxSearch.tsx` scope line "Current drafts and latest decisions from the past 7 days"), and Quality's Last 24 hours tab. On Team at All, Follow-up history renders twice with two titles while Decided recently merges both audiences (`team/page.tsx:301-308`). Fold Follow-up history into Decided recently as one "filed: slip, note" line per row; Search stays as the only older lookup. [still-open-from-10/17] M

4. **The guest card header mixes faces and prints red twice.** `MessagingQueue.tsx:474-512`: a boxed channel Pill, a stay eyebrow, a "Stripe lookup →" link, a boxed badge or a topic eyebrow, the destination in signal red (#2037), a hold in signal red (#2041), and "drafted 5h" on the right. Up to seven items, two boxed, two red. One face (eyebrow) for all metadata; one red line at most, with the hold taking precedence. [new-since-10/19] S

5. **Three doors to Delivery & sync within 200px.** At the foot of every inbox page: the Delivery & sync disclosure (`InboxBottomTools.tsx:16-18`), its own "Delivery & sync details →" link inside (`InboxHealth.tsx:94`), and the footer link (`MessagingFooter.tsx:7`). The footer link goes; the disclosure is the door. [new-since-10/19] S

6. **"N property facts to file →" is a lone line floating between sections** on three pages (`page.tsx:239`, `owner-messaging/page.tsx:171`, `team/page.tsx:311`), between Conversations and Follow-up history. It is a count for the Quality lens, so it belongs on the Quality lens label as a pill, the way Guest reviews already carries one (`MessagingTabs.tsx:88`). [new-since-10/19] S

7. **The cleaner schedule card has four verbs after Approve and a settings table.** `ScheduleDigestCard.tsx:701-726`: Refresh draft, Re-scan messages, Skip this day, Full schedule →; above them an auto-send toggle (`:540`) and per-cleaner recipient toggles (`:302`). `/turnovers/schedule` sends people here in four places (`:670,740,744,768`). Refresh draft and Re-scan become one Redraft (the card's own word); recipients and the send hour move to cleaner settings, as the 10/17 verdict said. [still-open-from-10/17] M

8. **Two things called Reviews.** Growth's Reviews tab at `/guests` (their reviews of us, testimonials, Recent stays) and Messaging's "Guest reviews" lens (stop Guesty's auto review, post ours, reply publicly to a below-five review, `reviews/page.tsx:106`). The public reply is a reply to a row on `/guests`, and `/guests` never links to the lens (no match for `messaging/reviews` under `src/app/guests`). Keep the lens, since these are approval cards, but a `/guests` review row with an open reply card links to it, and the lens is named for its work ("Review cards" or "Reviews to act on") so the two names stop colliding. [new-since-10/19] S

9. **Owner messaging still carries its own CRM.** "Contacts · Per-owner history · last 60 days" (`OwnerContactsHistory.tsx:45`, 450 lines, `owner-messaging/page.tsx:143-146`) duplicates each owner's Activity on `/crm`. Replace with one link per owner card to the CRM contact. [still-open-from-10/17] M

10. **One fact three times on the owner-stay card.** The sentence "Block and verify these nights in Guesty, then send the email reply" (`owner-approval-plan.ts:27`, rendered via `approveSummary`, `OwnerMessagingQueue.tsx:196`), the Also item's status "Block before the approved reply sends" (`ProposedActions.tsx` status line), and the button label "Block & send". Keep the Also line and the button; drop the paragraph. [new-since-10/19] S

11. **Shared controls skipped inside the cluster.** Four `window.confirm` calls (`RemindersSection.tsx:606`, `ProactiveRemindersPanel.tsx:707`, `BlurbsLibrary.tsx:263,513`, all allow-listed in `native-dialogs.test.ts:40-42`); Retire confirms by a second tap on a timer (`BlurbsLibrary.tsx:241-246`) instead of ConfirmDialog; hand-styled `<button>`s in New numbers (`NumberTriage.tsx:222-226`), the search panel and the Team proactive radiogroup (`TeamProactive.tsx:19-40`). Move each to `useConfirm` and `Button`. [structural] S

12. **Conversations wears ten controls over eight rows.** Four stay filters (`Conversations.tsx:71-74`), a search (`:238`), a Needs review toggle (`:286`), two "Check-ins from" dates with a go (`:266-270`), Show all (`:329`), Show earlier stays (`:339`). The dates belong behind Show earlier stays; Needs review joins the filter row as a fifth word. [new-since-10/19] S

### Pages to merge, demote or delete

| Surface | Verdict |
|---|---|
| `RemindersSection` on `/messaging/send` | Delete; the composer's Send later is the one "later" |
| `ProactiveRemindersPanel` (owners, Team) | Keep one panel; fold any guest need into it rather than a second file |
| `/messaging/quality` two proposed-updates designs | Merge into one with an audience column |
| `PerformanceDropdown` | Demote to one number plus chart; tiles and tiers behind Learning |
| Owner "Contacts" history | Delete; link each card to `/crm` |
| Follow-up history (all pages) | Merge into Decided recently |
| `/messaging/reviews` | Keep; rename for its verbs and cross-link from `/guests` |
| `/messaging/status`, `/messaging/blurbs` | Keep as they are; both wear the shell and are in the atlas |
| `src/app/cleaner-messaging`, `src/app/contractor-messaging` folders | No route left; move the components under `messaging/team` |
