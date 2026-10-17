# Cluster B: Messaging

Routes: `/messaging`, `/messaging/send`, `/messaging/blurbs`, `/messaging/status`, `/owner-messaging`, `/cleaner-messaging`, `/contractor-messaging`, plus the 18 shared components named in the brief. Every page.tsx, every sibling and every listed component was read in full (18,595 lines across 62 files), then `src/` was grepped for inbound links. File:line citations are to the worktree at `src/`.

One framing fact drives most of what follows: there is no messaging layout. Each of the seven pages builds its own shell (masthead, `MessagingTabs`, `AiStatusBanner`, footer) and each of the four audiences implements its own approval card from scratch (`MessagingQueue.tsx` 2,310 lines, `OwnerMessagingQueue.tsx` 909, `CleanerMessagingQueue.tsx` 799, `ContractorMessagingQueue.tsx` 793). The cards look alike and behave differently, and the differences are the thing a new hire will trip on.

---

### /messaging (Guests, Inbox lens)

**Purpose.** Approve, fix or drop the replies the AI has drafted to guests, and look up any recent guest conversation.

**Entry points.** Masthead tab "Messaging" (`components/HelmModuleNav.tsx:19-23`, with a guests-only red count pill that links to `/messaging#needs-review`); the mobile menu row with the same pill (`components/HelmMobileMenu.tsx:190`); `/today` "Guest message drafts" section header (`app/today/page.tsx:489-496`); the home "Concierge needs you" strip, emergency rows and most alert kinds (`components/ConciergeAlerts.tsx:56`, `lib/concierge-alerts.ts:64-66`); `/channels/bookings/[id]` "open in Messaging" (`app/channels/bookings/[id]/page.tsx:290,303`); the Calderwood pilot sidebar; Cmd+K (`lib/helm-modules.ts:416-424`). The home For Me feed never links to the guest queue itself, only to `/messaging/send#payment-links` and `/cleaner-messaging#owner-holds` (`components/ForMeFeed.tsx:194,246,1179,1207`).

**Inventory, top to bottom** (`app/messaging/page.tsx:249-270`):

1. Masthead; audience tab strip Guests / Owners / Cleaners / Contractors, each with a coloured count pill; lens row Inbox · Send · Saved replies (`components/MessagingTabs.tsx:43-61`).
2. "Search all inboxes" toggle button and, when open, a search box, two selects (All inboxes / Guests / Owners / Cleaners / Contractors; All statuses / Needs review / Scheduled, sending / Handled), a scope line "Current drafts and latest decisions from the past 7 days", results as `<details>` rows (`components/InboxSearch.tsx:38-69`).
3. "Delivery & sync" one-row disclosure with a status summary such as "2 imports to review · Gmail check overdue · 1 pitch held this week · Work sync pending" (`components/InboxHealth.tsx:80`, `lib/inbox-status.ts:14-34`).
4. "Drafts paused · since 11:13" red banner, only when the concierge reports the model down (`components/AiStatusBanner.tsx:47`).
5. A top notice line with an unstyled "Dismiss" button when an approve returned a follow-up warning (`MessagingQueue.tsx:164`).
6. The queue. Title is one of "Inbox zero", "Scheduled (N)", "Needs review (N)" (`MessagingQueue.tsx:155-160`); right slot "Updated 12s ago · Refresh" (`components/QueueRefreshControl.tsx:87`); a bottom-pinned undo toast after a reject or mark-handled (`UndoToast.tsx`). Cards are described under "The card" below.
7. "Decided recently" ledger: reversible rejects and mark-handleds from the last 12 hours, three rows then "Show N more", each with "Undo" (`RecentDecisions.tsx:52-106`).
8. "Conversations", eyebrow "60 guests · in house, upcoming & recent": a four-way stay filter All / In house / Upcoming / Checked out, a search box "Guest, property, or latest message…", a "Needs review (N)" toggle, "N matching conversations · showing 8", rows that expand in place to the full thread with a composer, "Show all 60 ▾" (`Conversations.tsx:95-211`).
9. "Follow-up history" disclosure: work and notes from resolved messages, past 7 days (`components/RecentMessageOutcomes.tsx:35-46`).
10. "Proposed property updates", hidden when empty: one block per property, rulings first ("The KB says something else" / "Fills an empty slot" / "Worth a look" with "Use the new wording" or "File it", "Keep what the KB has" or "Dismiss"), then a pre-checked list and a "File N" button (`TriagedPropertyUpdates.tsx:146-183, 388-452`).
11. "Rules the AI keeps being taught", hidden when empty: proposal cards with an editable rule, Scope and Topic inputs, "Promote to canon", "Dismiss" then "Confirm dismiss" (`ReflectionProposals.tsx:189-254`).
12. "Performance", open by default (`PerformanceDropdown.tsx:84`): tabs Overview / Last 24 hours / Learning; window toggle 24h / 7d / 30d / All; a 56px hero "One-shot rate · real work" with an (i) tooltip; "Counting everything, including thank-yous and auto-sends: 71% of 412"; "Your replies captured" and "Auto-sends held back · 28d"; a trend chart with a dashed "AUTO-SEND · 97%" line and a Topic select whose options read "★ parking (41/42 · 98%)"; six KPI tiles (Drafts shipped, Handled in Guesty, Auto-sent, Coaching rounds, Rejected, Auto-expired); a volume strip "412 drafts generated · 9 escalated to SMS · tier 1 · 120 tier 2 · 280 tier 3 · 12 · live queue · 3"; the Learning tab with three big numbers, a facts list (Edit / Delete / Restore / Show source, "+ Add a fact" with Scope and Topic text inputs) and "Fact-base health · weekly" with "Refresh".
13. Footer "Rising Tide · Messaging" with a "Delivery & sync" link (`components/MessagingFooter.tsx:5`).

Control count on a quiet day with three pending cards: roughly 14 page-level controls before the first card, 8 to 14 per card, and another 40-plus inside Performance. Nothing on the page is a modal; everything is inline drawers and `<details>`.

**The card** (`MessagingQueue.tsx:211-1782`). Header: "Guest · Property", channel pill, stay dates, either a topic eyebrow ("Date change"), a filled proactive badge (Extension offer / Nudge / Reminder / Scheduled / Review request / Trash day / Payment reminder, `format.ts:51-73`) or a "Queued" badge with "Sends in 12m"; right side "drafted 5h 12m ago", red and bold past four hours (`format.ts:119-123`). Two columns: "Guest said" (or "Context" / "Why this offer" on proactive cards) and "Proposed reply" with a tiny "Edit" eyebrow link. Then optional blocks: "View conversation ▾" (a read-only `ThreadPanel`), "Quote on file" rows linking to `/guests/quotes/<id>`, "Add-on charge · payment link" with a "Text this payment link to +1… when I approve" checkbox, a "Work slip · …" disclosure with Create / Skip radios or "Dismiss slip", a "Note to Rosa · today" disclosure (the handoff), a red error line, "Coaching the AI with your note…" status, then the footer verbs.

**Every verb on a guest card, with what it does and whether a real guest is contacted:**

| Verb (exact label) | Where | What happens | Reaches the guest? | Reversible? |
|---|---|---|---|---|
| Approve & send | dark split button, `:1550,1873` | posts the draft on the guest's channel now; also fires any ticked add-on SMS, handoff, work slip | yes, immediately | no (`actions.ts:86-87`) |
| ▾ (aria "Send later") | chevron, `:1875-1895` | opens presets In 10 minutes / In 30 minutes / In 2 hours / At a set time… (`lib/schedule-time.ts:68-72`) | yes, at the time | yes, Cancel send |
| Edit | eyebrow link on the reply, `:905-920` | opens a textarea; Save stores your text as the draft; the AI will not rewrite it | no | n/a |
| Coach the AI | outlined, `:1568-1575` | opens a note box; "Regenerate with this note" replaces the card with a rewrite AND records the note as learning (`:1744`) | no | no (the old draft is gone) |
| More actions + | `<details>`, `:1580` | reveals three text buttons | | |
| Redraft | quiet text, `:1590` | re-runs the draft on today's data, nothing sent | no | no |
| Mark handled | quiet text, `:1599` | opens "What did you do instead?": paste what you sent (25-char minimum), or Already answered / Guest said thanks / Not worth a reply, or Skip | no | yes, Undo |
| Reject | quiet text, `:1608` | drops the draft; the guest gets no reply from Helm | no, and nobody else will either | yes, Undo |
| Send now / Cancel send | on queued cards, `:1432,1441` | fire now / back to pending | yes / no | |
| Copy message / Mark sent / Dismiss | on copy-to-send trash cards, `:1450-1472` | clipboard / clears as handled / drops | no (you paste it in Guesty) | Undo for Mark sent and Dismiss |
| Send a price | dark link, `:1485,1528` | navigates to `/guests/quotes/new?…` | no (the quote page sends) | n/a |
| Send reply | outlined, on 2027 request cards, `:1500,1541` | same as Approve & send, emails the draft as written | yes | no |
| Other options / Fewer options | underlined text, `:1521,1617` | shows/hides the More actions for 2027 cards | | |
| Set a price / Retry draft / Recheck & draft / Write reply / Mark handled | on inquiry cards with no draft, `:1476-1481` | quote page / re-run / re-run / open editor / open handled drawer | no | |
| Text this payment link … when I approve | checkbox, `:1209-1218` | adds an SMS on the GUESTS line to the approve | yes, on approve | no |
| Skip note / Draft for approval / Send to Rosa | radios on a cleaner handoff, `:1299-1311` | nothing / files a pending card in Cleaners / texts Rosa right after the guest reply sends | Rosa, on approve, for the third choice | |
| Draft this for … when I approve | checkbox on owner/contractor handoffs, `:1318-1361` | files a pending card in that queue | no | |
| Create when I approve / Skip / Dismiss slip | work slip radios, `components/MaintenanceWorkPanel.tsx:35-36,29` | files or skips a work slip; Dismiss closes an existing one | no | no |
| Undo | toast and ledger | restores a rejected or handled card | | |

Four things a new hire cannot predict from the labels. "Reject" sounds like "reject this wording"; it means the guest is never answered, which is exactly the accident the Undo rail was built after (a guest at 65 Calderwood went unanswered this way in September). The same action is labelled "Dismiss" two branches down (`:1471`) and on owner reaction cards (`OwnerMessagingQueue.tsx:478`), "Skipped" in search (`lib/inbox-search.ts:21`), "Rejected" in the ledger (`RecentStrip.tsx:17`) and "no reply needed" in the thread (`Thread.tsx:62`). "Coach the AI" and "Edit" both change the reply, but only Coach teaches, and the UI says so only in a placeholder that disappears when you type (`:1744`). "Mark handled > Not worth a reply" and "Reject" are the same decision with two doors; the code comment at `:73-77` says the handled reasons feed a rollup and Reject records nothing. And "Send a price" on a 2027 request is the dark primary button while the actual send is the outlined "Send reply", with a sentence of explainer under them (`:1502-1504`, `:1543-1546`), copy Dotti asked for on 2026-09-18 and 2026-10-01, which says the buttons themselves are not carrying the meaning.

**How a card says why it is waiting.** Queued: badge, countdown and a hover title "Queued to send automatically at the time shown. Cancel to edit." (`components/ScheduleSend.tsx:248`), clear. Stale: the age turns red at four hours with no words; the reason the code expects (Allie answered in Guesty and the poller has not caught up, `format.ts:109-117`) is never shown. Held: only inside Delivery & sync as "Held as pitches, no draft written" (`components/InboxHealth.tsx:60`). Paused: the banner, good. Degraded: the word never appears; the state surfaces as "Draft unavailable" or "Needs your decision" on an inquiry card (`lib/rental-inquiry.ts:51`). Failed: a red line under the footer until the next action; a scheduled send that failed its five retries silently reverts to pending (memory, send-later) with nothing on the card saying it failed. Regen stalled: "The rewrite hasn't come back. Send the note again." (`:611`). Service down: "Service not reachable / Auto-retrying" with text from `explainError`, which includes "Stay Concierge rejected the dashboard key", "Guesty is in OAuth cooldown" and, when env is missing, "STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY are not set. Pull them from the Mac Mini service config and add them to Helm in Vercel." (`page.tsx:244`).

**Number of card states.** Counting only what changes the visible chrome: pending, queued collapsed, queued expanded, copy-to-send, inquiry without draft (two sub-labels), 2027 request (collapsed and "Other options"), email guest, seven proactive kinds, add-on (four sub-states), handoff (cleaner radios with five note_status readouts, owner/contractor checkbox, filed read-only, create_error), work slip (create/skip, created, dismissed, completed, error), quotes block, editing, draft-changed-under-edit banner, coach drawer, regenerating lock, regen stalled, handled drawer, schedule popover, stale age, error line, and on phones the collapsed MobileInboxReview row. That is more than 30 states on one component. Nobody will learn them from the screen.

**Other new-hire friction.**
- Jargon on screen with no definition: concierge, Stay Concierge, one-shot rate, substantive, courtesy ack, tier 1/2/3, escalated to SMS, punted, auto-pruned, Phase B, canon, distilled facts, Q&A pairs, coaching directives, scope "voice" / "process", fact-base health, sprawl, pitch, import, work sync, handoff, slip, KB, quote on file, add-on, GUESTS line, module, Helm thread (`PerformanceDropdown.tsx:382,512-520,826,835`, `TrendChart.tsx:109,134`, `FactAuditCard.tsx:63`, `ReflectionProposals.tsx:201`, `InboxHealth.tsx:60`, `Conversations.tsx:317`).
- Two "Needs review (N)" counters on one page with different N: the queue title counts cards, the Conversations toggle counts conversations (`Conversations.tsx:164`).
- Hidden actions: Redraft, Mark handled and Reject are behind "More actions +" (`:1580`); Edit is a 10px eyebrow link (`:905`); the thread is behind "View conversation ▾"; the facts editor is behind Performance > Learning; held pitches are two disclosures deep.
- Looks like a button, is not: the "Decided recently" status chips; "Quote on file" rows are links styled as plain text (`:1052-1056`). Is a button, looks like text: Redraft / Mark handled / Reject (`.rt-quiet-btn`), Edit, Show ▾ / Hide ▴, Other options.
- Explainer paragraphs standing in for UI: the collapsed Performance line (`:159`), the 2027 button hint, "If you replied somewhere else, paste it here. The AI learns your wording from this…" (`:1656-1657`), "Fleet-wide: rides on every draft…" (`ReflectionProposals.tsx:181-186`), "The sweep runs every six hours." (`TriagedPropertyUpdates.tsx:178`).
- Raw slugs on operator inputs: "+ Add a fact" wants `53_rocky_neck, all properties, voice, process` typed by hand (`PerformanceDropdown.tsx:1207`), as does the reflection Scope field (`ReflectionProposals.tsx:142-156`); the error on a blank scope repeats the slug rule (`facts-actions.ts:62`).
- Destructive without confirmation: Delete on a fact (`:1071`, restorable); Reject (undoable for 12h); Coach (not undoable: the draft is replaced). Approve & send is one tap with no hold.
- Finding an old conversation: the Conversations list is the concierge's 60 most recent stays (`page.tsx:131`) and "Search all inboxes" covers 7 days of decisions (`InboxSearch.tsx:51`, `lib/inbox-search.ts:55-61`). A guest from August is not reachable from Helm; the answer is Guesty. Neither surface says so.
- Density: with Performance open by default, the page is seven sections and two disclosures long; the 56px percentage, six KPI tiles, chart and three-number learning strip are analytics chrome under the busiest queue in the app.
- Mobile: the card collapses to a "Review reply →" row and expands with "Close message −" at the top and "Back to inbox" at the bottom, two closes (`components/MobileInboxReview.tsx:33,45`). The refresh button drops "Updated Xs ago" on phones (`globals.css:1159-1160`). The two-column card folds (`:1149`). The thread inside a card is a 380px scroll box inside the page scroll (`:1024`). The "Last 24 hours" rows are a fixed `180px 1fr 80px 170px` grid with no phone rule (`RecentStrip.tsx:72`), so they overflow a 375px screen. The two-row tab chrome, search toggle and sync disclosure push the first card well below the fold.

**Overlap.** The thread view exists three times (card "View conversation", Conversations row, and `OwnerContactsHistory` for owners). Recent activity exists four times (Decided recently, Performance > Last 24 hours, Follow-up history, Search > Handled). Teaching the AI exists on five surfaces across the cluster (facts list, reflection proposals, proposed property updates, Saved replies, the owner facts textarea). Scheduling a guest message exists twice (card send-later and Send lens send-later) and a third way as a one-time "Proactive message" on `/messaging/send`.

**Owner vs staff.** The page is staff-visible, but three of its controls bounce staff to `/not-available`: the dark primary "Send a price" on every 2027 request and email card (`:1485,1528,1559` → `/guests/quotes/new`, gated by `lib/helm-access.ts:78`), the "Quote on file" rows and "See all N in Quotes" (`:1054,1126`), and the handoff link "waiting on Owner messaging" (`:1343`, `/owner-messaging` gated at `helm-access.ts:76`). The Owners tab itself is rendered for staff (`MessagingTabs.tsx:58`) with a live count pill, and bounces. Money prints freely: add-on amounts and PAID chips (`:1166-1181`), quote totals and balances due (`:1089,1104`).

**Proposals.**
1. One vocabulary for "no reply": retire the Reject verb and fold it into Mark handled's reasons, so there is one door, one toast label and one ledger label. (S)
2. Performance becomes its own lens ("Quality") on the Guests tab, closed by default nowhere because it is not on the Inbox at all; the Inbox ends at Conversations. (S)
3. The Edit control becomes the same weight as Coach, with a two-line contract printed once in the drawer header: "Edit changes this reply only. Coach rewrites it and teaches the AI." (S)
4. Each waiting state gets a one-line reason on the card itself: "Not sent: Guesty rate-limited us at 3:02, retrying", "Draft is 5h old; check whether Allie already answered in Guesty", "Held as a pitch; release in Delivery & sync". (M)
5. The Conversations list gets a date range and a free search that reaches the concierge's full history, and says plainly when a thread is older than what Helm holds. (M)
6. Staff-safe card: when the viewer is staff, "Send a price" and the quote block render as "Ask Dotti or Ryan to price this" instead of a bounce; the Owners tab is hidden for staff the way the registry already says it should be. (S)

---

### /messaging/send (Guests, Send lens)

**Purpose.** Start a message to a guest yourself (now or later), charge a guest for an add-on, and see which payment links are paid.

**Entry points.** Lens row "Send" (`MessagingTabs.tsx:47`); home feed Payments header and every payment row (`ForMeFeed.tsx:246,1179,1207` → `#payment-links`); Cmd+K "Send a Guest Message" (`helm-modules.ts:442-453`); the concierge alert `addon_sms_failed` (`lib/concierge-alerts.ts:64`).

**Inventory.** "Send a message · pick a stay, write, send": a five-way filter Current / In house / Upcoming / Checked out / All (opens on Current), a search, the same conversation rows as the Inbox in pick mode, "Show more (N left) ▾" (`send/StayPicker.tsx:26-32,180`). After a pick: guest header, "Change stay", a textarea ("Write to Jane... shorthand is fine, Polish cleans it up"), a dark split "Send now" with send-later chevron, an outlined "Polish", the line "Cmd + Enter to send · Cmd + Shift + Enter to polish", "Polished. Undo to get your version back", a stall notice after 10s, then "Payment link ▾" (`send/SendPanel.tsx:168-388`). The payment panel: What for, Amount before tax, "Add MA occupancy tax (14.7%) rent is taxed; a replacement cost is not", "Guest pays $229 ($200 + $29 tax)", Charged through, Text to, "The text · sends from the Guests line as Allie; [link] becomes the real link" with Reset, "Create link + text Jane" and "Create link only" (`send/PaymentLinkPanel.tsx:184-333`). Below: "Payment links · 2 open · 5 paid" ledger rows with a status chip (Paid 2h ago / Unpaid · sent 3d ago / Can't check / Sent · waiting / Not sent yet / Cancelled) and per-row Nudge by text, Check now, Copy link, Cancel link → "Sure? Cancel it" (`send/PaymentLinksLedger.tsx`, `send/PaymentLinkActions.tsx:113-143`). Then "Proactive messages · recurring + one-time", collapsed, with a paragraph explainer and "Show ▾" (`RemindersSection.tsx:77-116`); open, it shows unstyled "Refresh scheduled messages" and "Retry loading recipients" buttons, the active list with "End", and a form: Recurring / One-time toggle, Guest / reservation select, Label, Message with "✨ Polish into our voice", Days Mon…Sun, Date, Time, Send: Approve first / Auto-send, "Create reminder" or "Schedule message", an unstyled "Discard draft" (`RemindersSection.tsx:242-625`).

**Friction.**
- Three ways to send a future message from this one page: the split button's send-later, the One-time proactive message, and a Recurring reminder; each lands in a different place (a Queued card in the Inbox, a reminder row here that becomes a card "needs approval" or auto-sends). The "Send" select offers "Auto-send" with no warning that it bypasses review (`RemindersSection.tsx:571-574`).
- "Polish" is explained three times (placeholder, tooltip, the "Polished. Undo…" line) and the keyboard line is UI copy for a shortcut (`SendPanel.tsx:327`).
- The payment panel says the text "sends from the Guests line as Allie" (`PaymentLinkPanel.tsx:279`) whoever is signed in. Verify the template signs as Allie; if it does, that is a staff-facing identity claim worth knowing about on 11/1.
- Error copy aimed at an engineer: "Add its STRIPE_KEY_<PROPERTY_ID> in Vercel", "Add write access for Payment Links, Products, and Prices to the restricted key" (`send/payment-link-actions.ts:239-241`, `MessagingQueue.tsx:1235-1237`), and "Fix the key in Stripe →" on ledger rows.
- Raw `<button>`s with no styling at `RemindersSection.tsx:119,124,616`.
- Mobile: the payment grid is `2fr 1fr` and `1fr 1fr` with no phone rule (`PaymentLinkPanel.tsx:184,233`); the reminder form is `1fr 1fr` (`RemindersSection.tsx:424`). Workable, cramped.
- Direct-booked guests: the row is pickable, then the composer disables with "Direct-booked guest: Guesty cannot deliver a message on this thread. Reach them by text or email instead." (`SendPanel.tsx:260-262`) with no link to where that is.

**Overlap.** Payment links: the ledger here and the home feed Payments cards share `PaymentLinkActions`. The picker rows are the Inbox's rows. The composer is the Inbox thread composer minus Polish and send-later.

**Owner vs staff.** Not gated. Staff can mint a Stripe payment link in an owner's account and text a guest a bill (`payment-link-actions.ts:142` checks only a session). That may be intended (an ops manager charging a late checkout), but CLAUDE.md's "staff see operations and not money" rule and the gated `/payments` prefix say the policy has not been decided for this surface. Amounts, paid status and Stripe key problems print to staff.

**Proposals.**
1. One future-send model: the Proactive messages section leaves this page and the Recurring form moves to the property or guest it belongs to; send-later on the composer is the only "later" here. (M)
2. The payment panel opens as the second tab of the Send lens ("Message" / "Charge") rather than a disclosure under the composer, and its ledger sits under it. (S)
3. Decide and write down whether staff may mint links; if not, gate the actions with `requireOwnerEmail()` and hide the panel. (S)

---

### /messaging/blurbs (Saved replies)

**Purpose.** Write the answers the AI should quote word for word, approve them, retire them.

**Entry points.** The lens row only (`MessagingTabs.tsx:48`). There is no entry in `helm-modules.ts`, so no Cmd+K, no breadcrumb registry, no search result. CLAUDE.md says a module missing from the atlas "will not appear in nav or search"; this one is missing.

**Inventory.** "Saved replies · Your words, sent verbatim when a guest's question matches", a three-line explainer (`blurbs/BlurbsLibrary.tsx:126-130`), two tabs "To review (N)" / "Live (N)", "+ Add a saved reply" (scope select Every property / each property, category select, Title, body, "Add as draft", Cancel), then groups by scope (Every property, "Gloucester area", property names) of cards: Live/Draft chip, category chip, a borderless title input, a body textarea, source note, Save / Discard edits when dirty, Approve or Back to draft, Retire (`:168-293`).

**Friction.**
- The title is an input with `border: none` and a transparent dashed underline (`:209-223`): nothing says it is editable.
- "Retire" is one tap with no confirm and no Retired tab; the card vanishes from both tabs (`:93,283-289`). Irreversible from this screen.
- "Back to draft" is unapprove; the pair Approve / Back to draft / Retire plus Save / Discard edits is five verbs on a card that is mostly text.
- The AddBlurbForm scope select has no "area:" option though the grouping and server support it (`:351-358` vs `:58-61`).
- The explainer paragraph is the kind of copy Dotti has asked not to see; the tabs already say it.
- Unstyled `<p role="status">` and the "Save or discard edits before changing this reply's status." line (`:249-250`).

**Overlap.** A fifth place where the operator teaches the AI, next to curated facts, reflection proposals, proposed property updates and the owner facts file. Nothing on any of them names the others.

**Owner vs staff.** Not gated; nothing money-bearing.

**Proposals.**
1. Register the route in `helm-modules.ts` (hidden, section `messaging`) so Cmd+K and breadcrumbs know it exists. (S)
2. Retire asks once and lands in a third tab "Retired" with Restore. (S)
3. Title renders as text with a pencil, body as text with Edit, so the card reads as a saved reply and not a form. (S)

---

### /messaging/status (Delivery & sync)

**Purpose.** See whether message imports from Guesty, Gmail and Quo are working, release a held email, and see work slips that have not filed yet.

**Entry points.** The footer link on all four inbox pages (`MessagingFooter.tsx:5`), "Delivery & sync details →" inside the disclosure (`InboxHealth.tsx:76`), Cmd+K "Message Delivery & Sync" (`helm-modules.ts:426-437`).

**Inventory.** "← Messaging" link, one Section "Delivery & sync": per-channel cards with a status word (Checked / Checking / Incomplete check / Check failed / Check overdue / Not enabled / Not verified), "Last successful check", a coverage line; a list of unresolved imports ("Review import", "Import retrying", "Import processing", "Open email"); "N recent direct emails could not be matched to guest correspondence"; "Held as pitches, no draft written (past 7 days)…" with "Not a pitch, draft it"; "Work sync pending" with "Open work board →" and "Open owner inbox →" (`InboxHealth.tsx:35-77`, `components/WorkFollowups.tsx:15-28`). Footer "Source coverage and background processing" (`status/page.tsx:16`).

**Friction.** No tab strip: the only way out is "← Messaging". The vocabulary is the service's (import, source, coverage, pitch, work sync) with no translation. "Checking", "Incomplete check" and "Not verified" are three shades of unknown. Staff get "Open owner inbox →" and bounce (`WorkFollowups.tsx:26`).

**Owner vs staff.** Shows owner names and property ids in the work-sync list to staff (`WorkFollowups.tsx:24`), acceptable, but the link bounces.

**Proposals.** Keep the page; give it the messaging shell (tabs and footer) and three plain words per channel: Working / Delayed / Broken, with the raw label in a title. (S)

---

### /owner-messaging (Owners)

**Purpose.** Approve, edit or drop the AI's replies to homeowners, see what each reply will also file (work slips, cleaner notes, statement recipients), and read each owner's history.

**Entry points.** Owners tab (`MessagingTabs.tsx:58`); concierge alerts of kind `owner_*` and `unknown_owner_sms` (`concierge-alerts.ts:65`); "Open owner inbox →" in Delivery & sync; the guest card's handoff link (`MessagingQueue.tsx:1343`); "Open note in messaging ↗" in Work & notes (`MessageOutcomes.tsx:22`); Cmd+K, owners only (`helm-modules.ts:459-471`, `access: 'owner'`).

**Inventory** (`owner-messaging/page.tsx:173-186`): queue; "Last 24 hours · N resolved" strip; "Proactive messages" panel (owner variant: "Send an owner a message you initiate, on a repeating cadence (a monthly touch-base)…"); "Follow-up history"; "Proposed property updates · Facts owners shared, ready to file to the property" (the older per-candidate card: confidence dot, category chip, fact, quote, "File to" select, "Review & file" → a routed list with Guest / Internal toggles, "Apply N changes", Back, Dismiss, `ProposedPropertyUpdatesCard.tsx:233-372`); "Contacts · Per-owner history · last 60 days" (collapsible owners, dated sessions, "Show all N conversations →"); "Owner facts · High-priority rules the owner drafter applies verbatim": a 320px monospace textarea of `curated_owner_facts.md`, "Save facts", byte counts, "Learned from your coaching · auto-distilled, read-only" (`OwnerFactsEditor.tsx:62-194`).

**The card** (`OwnerMessagingQueue.tsx:112-696`). "Owner · Property", "Topic · email/SMS", age. "Owner said · 3 messages" as a keylined run, reaction chips. An Envelope block: From (with an aside such as "the owner wrote to them, so they are the one answering"), To, Cc ("no one"), Reply-To, Subject, and a note "X was on the message you are answering and will not receive this reply." (`Envelope.tsx:78-123`). The reply is a borderless textarea styled as prose: typing edits it silently and the button becomes "Approve edited & send" (`:580,705-772`). "Follow-up work · 1 work slip, 1 cleaner heads-up" disclosure with the checkbox "Create these when I approve or mark handled" and up to four explainer sentences (`ProposedActions.tsx:99-167`). Footer: Approve & send split, Coach the AI, More actions + (Mark handled, Reject). All-reaction cards collapse to "Susan reacted 👍 to your message. Nothing to reply to." with one "Dismiss" (`:461-481`).

**Friction.**
- Keyboard shortcuts nobody is told about: with a card focused, `a` approves and sends, `c` coaches, `h` marks handled, `r` rejects, Cmd+Enter in the textarea sends (`:281-316`). Nothing on screen shows them; no other queue has them; `r` on a focused card drops an owner reply with no confirm.
- No explicit Edit: the hero is always editable, so the guest queue's Edit / Save contract does not exist here; a stray keystroke changes what sends.
- No Redraft, no Undo toast, no "Decided recently", no "what did you do instead" capture on Mark handled; the loading labels are "Skipping…" and "Clearing…" where the guest queue says "Rejecting" and "Marking" (`:602,609`).
- "Sent via Quo" is the label for `manual_sent` in the owner strip (`OwnerRecentStrip.tsx:13`); the guest strip calls the same status "Replied manually". An email reply marked handled reads "Sent via Quo".
- The follow-up checking line renders in red even in the benign "checking" state (`:541-545`).
- The Envelope block is excellent and unique to owners; nothing like it tells a guest-queue operator which channel an approve goes out on.
- The Owner facts editor is a raw markdown file with a bracket-slug convention in its explainer (`OwnerFactsEditor.tsx:76-81`).
- The proposed-updates card is the pre-triage design the guest page replaced on 2026-09-21; owners, cleaners and contractors still get it, so the same concept has two UIs.
- Mobile: "Last 24 hours" rows are a fixed `210px 1fr 80px 170px` grid with no class and no phone rule (`OwnerRecentStrip.tsx:59`).

**Overlap.** Contacts history duplicates the CRM's touch timeline for owners. Owner facts duplicates the Facts list on `/messaging` in a different format. Proactive messages duplicates the guest reminders form.

**Owner vs staff.** Correctly gated at the page. But the data is not: `/api/messaging/queue?audience=owners` (`app/api/messaging/queue/route.ts:58-66`), `/api/messaging/search` (`app/api/messaging/search/route.ts:12`, session only, returns owner message bodies and drafts) and `/api/messaging/pending-count` have no owner check, and `/api/messaging` is absent from `OWNER_API_PREFIXES` (`helm-access.ts:96-128`). A staff session gets owner correspondence through the search panel on any inbox page and through the queue poll. The Owners tab and its count pill render for staff.

**Proposals.**
1. Gate the three `/api/messaging` routes for the owners audience and hide the Owners tab from staff; the atlas already says `access: 'owner'`. (S)
2. Put the keyboard shortcuts on screen or remove them; add the guest queue's undo toast and ledger here. (S)
3. Replace the markdown facts textarea with the structured facts list the guest page has, scoped to owners. (M)

---

### /cleaner-messaging (Cleaners)

**Purpose.** Answer Rosa and Nina in Portuguese, approve tomorrow's checkout schedule text, and answer "clean after this owner block?".

**Entry points.** Cleaners tab; `/turnovers/schedule` links to `#schedule-digest` in three places (`app/turnovers/schedule/page.tsx:618,682,708`); the home feed "Owner blocks · clean after?" header (`ForMeFeed.tsx:194` → `#owner-holds`); the guest card's cleaner handoff links (`MessagingQueue.tsx:1295,1368`); Work & notes note links; Cmd+K.

**Inventory** (`cleaner-messaging/page.tsx:200-215`): "Owner blocks · clean after?" (rows with "Clean after" / "No cleaning", answered ones folded under "Answered · N upcoming", `OwnerHoldQuestionsCard.tsx:53-85`); "Cleaner schedule · Friday, October 17 · Waiting on your approval": the day's rows with chips (owner stay, no cleaning needed, same-day · in 3:00 PM, Guest message · was 10:00 AM, extended, Guesty moved · re-check, Feeds disagree), a "No cleaning needed" button per row, "From the guests · add to the message?" with Add / Not needed / Remove, "Detected but not applied · needs your call" with Apply / Dismiss, an auto-send box ("Automatic sending is off. Nothing reaches the cleaners unless you approve it here." with "Send automatically at 6 PM"), "Texts to" recipient toggles and "Preview Rosa's live page →", "The text that goes out" textarea, "Special instructions (optional)" with "Save & translate", a dashed "Added to the end of each text" box, then "Approve & send via Quo", "Refresh draft", "Re-scan messages", "Skip this day", "Full schedule & adjustments →" (`ScheduleDigestCard.tsx:424-789`); the concierge queue; "Proactive messages"; "Follow-up history"; "Proposed property updates" (cleaner variant). In the unconfigured branch the two Helm-native cards still render, followed by the env-var "Setup required" section (`page.tsx:186-198`).

**The card** (`CleanerMessagingQueue.tsx:116-624`). "Rosa", "Topic · they wrote PT", age; "They said" with an English line under it; "Proposed reply (Portuguese)" with English under it; a "Work slip · Toalhas" disclosure with a property select and "File this slip when I approve"; footer: Approve & send split (chevron disabled when a slip is proposed, hover "This card files a work slip, so it sends immediately…" `:505-509`), Coach the AI (hidden on proactive reminders `:516`), More actions + (Mark handled, Reject). No Edit anywhere: the Portuguese cannot be touched except by coaching. No Redraft, no Undo.

**Friction.**
- Fourteen buttons on the digest card before the primary one, and the primary is the only red button in the cluster (`:678-692`). Three explainer paragraphs (`:587,617-625,781`). "Refresh draft" vs "Re-scan messages" vs "Draft tomorrow's schedule now" are three regenerate verbs with different scopes, told apart only by a hover title (`:702`).
- The auto-send button says "Send automatically at 6 PM" while the hour is a setting (`:537` vs `:517`).
- The `?err=` notices speak in codes: "QUO_API_KEY is not set in this environment", "Quo rejected every send - see the log below" (`:435-441`).
- The empty queue copy names people: "Texts from Rosa or Nina show up here automatically." (`:85`); fine today, wrong the day the roster changes.
- The cleaners count pill sums pending cards + pending digests + unanswered owner holds (`api/messaging/pending-count/route.ts:80-82`), so "3" on the tab can be one text, one schedule and one question.
- A new hire cannot edit a Portuguese draft; Coach is the only path and it costs a regeneration.
- Mobile: the digest's row chips and per-row buttons wrap into tall stacks; the `pre` text body is monospace 12px.

**Overlap.** The digest card is the same approval as `/turnovers/schedule` (which links here to do the send); the owner-hold rows are on the home feed. Proactive messages, Follow-up history and Proposed property updates repeat the owner page.

**Owner vs staff.** Not gated; nothing money-bearing except the owner-hold rows' Guesty notes.

**Proposals.**
1. Give the cleaner card an Edit on the Portuguese with the English updating from it, same contract as the guest card. (M)
2. The digest card's footer becomes one dark "Approve & send" plus a "More" group (Refresh, Re-scan, Skip); the autosend switch moves to the schedule settings page. (S)
3. The queue's count pill shows one number and the tab's title row names the three kinds under it ("1 text · 1 schedule · 1 question"). (S)

---

### /contractor-messaging (Contractors)

**Purpose.** Answer field contractors' texts and file the work slips their messages imply.

**Entry points.** Contractors tab; guest card contractor handoff; Work & notes links; Cmd+K.

**Inventory** (`contractor-messaging/page.tsx:155-165`): queue; "Proactive messages" (contractor variant); "Follow-up history"; "Proposed property updates" (contractor variant). The card is the cleaner card without translation lines, plus an "On their run today" optgroup in the slip's property select and a "Heads up: they already filed "Leak" at 21 Horton during today's inspection" warning (`ContractorMessagingQueue.tsx:433-459`).

**Friction.** The empty state reads "No contractor drafts waiting. Texts from Delaney show up here automatically." (`:100`). Delaney becomes the W-2 operations manager on 11/1 and will be reading this page as staff. No Edit, no Redraft, no Undo, same as cleaners. Otherwise the thinnest page in the cluster and the one that most obviously could be a filter on a single queue.

**Overlap.** Everything on it exists on the cleaner page with one word changed.

**Owner vs staff.** Not gated.

**Proposals.** Fix the empty-state copy now (S). Merge into one crew queue with an audience filter (see cluster section). (M)

---

### Shared components

- **MessagingTabs** (`components/MessagingTabs.tsx`): hand-coded tab list ignoring `access` in the registry; renders search and the sync disclosure under the tabs on every inbox page, so the queue starts three rows down.
- **MessagingTabCount / MessagingPendingBadge**: four tab colours (navy, gold, teal, brown) for four audiences; the masthead pill is guests only, so on `/messaging` the same number shows twice (masthead and tab). The pill title says "drafts awaiting review" for three audiences and "items" for cleaners (`MessagingTabCount.tsx:162`).
- **InboxSearch**: fetches eight feeds on every open (`lib/inbox-search.ts:50-51`) with a 25s timeout and "Loading messages…"; seven-day scope; result rows link into `/owner-messaging` for staff.
- **InboxHealth**: described under `/messaging/status`.
- **InboxFollowup**: the disclosure chrome for handoffs, slips and follow-up work; its status strings ("Create when approved", "Draft for approval", "Send after reply", "Select property", "Skip", "Needs review") are the clearest state labels in the cluster and could be the model for the card itself.
- **MobileInboxReview**: good pattern; two close controls; the hash reveal makes search links land on the right card.
- **MessageOutcomes / RecentMessageOutcomes / RecentMessageOutcomesSection**: "Work & notes" readouts with statuses from `lib/message-outcomes.ts:74-79` (Creating work slip, Checking work, Creation unconfirmed, Status unavailable, Replaced…), another vocabulary.
- **ScheduleSend**: the shared split button and popover used by three queues; the guest queue keeps a private copy (`MessagingQueue.tsx:1832-2005`), a deliberate divergence per the memory note, and the visible difference today is only the loading label ("Sending" with dots vs "Sending…").
- **QueueRefreshControl / QueueSkeleton / MessagingCountsRefresh / MessagingFooter**: fine. The skeleton title is "Pending" while the live title is "Needs review (N)" (`QueueSkeleton.tsx:16`).
- **HandoffFileQueue**: not a messaging component. Its docblock says it is "the field handoff on a statement card"; its verbs are View / File as receipt / Note on period / Set aside / Bill to {month} / Add anyway, and Set aside uses `window.prompt` (`:181`). It belongs to the Statements cluster.
- **ProactiveRemindersPanel**: three audience variants of the same 725-line form; raw unstyled buttons at `:165,170,716`; "Auto-send" offered without warning (`:674-677`).

---

## The cluster as a whole

### The five biggest structural problems

1. **Four hand-built cards for one decision.** The same approve-or-not card is implemented four times (`MessagingQueue.tsx`, `OwnerMessagingQueue.tsx`, `CleanerMessagingQueue.tsx`, `ContractorMessagingQueue.tsx`, 4,811 lines together) and they have drifted: Edit exists on guests (explicit) and owners (implicit, always-on textarea) and not on cleaners or contractors; Redraft, the undo toast, "Decided recently" and the "what did you do instead" capture exist only on guests; single-key shortcuts exist only on owners (`OwnerMessagingQueue.tsx:281-316`); loading labels differ ("Rejecting" vs "Skipping…", "Marking" vs "Clearing…"); coaching status copy differs (`MessagingQueue.tsx:1399` vs `OwnerMessagingQueue.tsx:642`). Delaney will learn one card and be wrong on the next tab.

2. **The verbs do not say what they do, and the same decision has several names.** Reject drops the guest unanswered but reads as "reject this draft" (`MessagingQueue.tsx:1606-1608`); it is "Dismiss" on two other branches (`:1471`, `OwnerMessagingQueue.tsx:478`), "Skipped" in search (`lib/inbox-search.ts:21`), "no reply needed" in the thread (`Thread.tsx:62`). "Mark handled > Not worth a reply" and Reject are the same choice through two doors (`MessagingQueue.tsx:77,1606`). Coach vs Edit is explained only in a vanishing placeholder (`:1744`). `manual_sent` is "Replied manually" (guests), "Sent via Quo" (owners, `OwnerRecentStrip.tsx:13`), "Marked handled" (toast, search) and "you replied in Guesty" (thread, `Thread.tsx:60`).

3. **Analytics and AI-training chrome sits on the operational page.** Performance is open by default under the queue (`PerformanceDropdown.tsx:84`) with a 56px percentage, six KPI tiles, a chart with an "AUTO-SEND · 97%" threshold and "Candidate for Phase B" callouts (`TrendChart.tsx:134-135`), tier counts, and a Learning tab where facts are typed with raw slugs. Five separate "teach the AI" surfaces across the cluster (facts, reflection proposals, proposed property updates in two designs, Saved replies, the owner facts markdown) with none naming the others. This is the generic AI-editorial look and the derived rollups the brief says Dotti dislikes, on the number one page by visits.

4. **Staff can see or reach owner money and owner mail from inside the cluster.** The Owners tab renders for staff with a live count (`MessagingTabs.tsx:58`); `/api/messaging/queue`, `/api/messaging/search` and `/api/messaging/pending-count` serve owner approvals with only a session check (`app/api/messaging/queue/route.ts:58-66`, `app/api/messaging/search/route.ts:12`, absent from `helm-access.ts:96-128`); the dark primary "Send a price" on 2027 cards and the quote rows go to `/guests/quotes` (`MessagingQueue.tsx:1485,1054`), gated; the handoff link, Work & notes links, Delivery & sync and concierge alerts all link `/owner-messaging`. Each bounces to `/not-available` with no explanation on the originating card.

5. **No way to find an old conversation, and no card says why it is waiting.** The Conversations list is the 60 most recent stays (`page.tsx:131`); search is seven days (`InboxSearch.tsx:51`); nothing says "older than this is in Guesty". Stale cards go red with no words (`format.ts:119-123`); a failed scheduled send silently returns to pending; held emails are two disclosures deep; "degraded" never appears; service copy names env vars and the Mac Mini (`page.tsx:244`, `lib/stay-concierge.ts` explainError).

### Vocabulary a new hire meets here

| Term | Meaning from the code | Defined on screen? |
|---|---|---|
| Stay Concierge / concierge / messaging service | the Python guest-AI service on the Mac Mini that drafts every reply | no; appears in error copy, footers, "Concierge needs you" |
| Draft / proposed reply | the AI's suggested reply, pending your decision | implied by the column label |
| Approve & send | post the draft now | yes, by the label |
| Queued / Scheduled / Sends in 12m | a send-later card the dispatcher will fire | hover title only |
| Coach the AI / coaching note / coaching directive | a note that rewrites this draft AND is logged as a permanent lesson | placeholder only |
| Redraft | re-run the draft on today's data, no learning | hover title only |
| Mark handled | you answered elsewhere; clears the card; optionally captures your text for learning | drawer label |
| Reject | the guest gets no reply from Helm | hover title only |
| Undo / Decided recently / reversible | rejects and mark-handleds can be reversed for 12h; sends cannot | one line under the ledger |
| Handoff / Note to Rosa / Cleaner note | a message to a teammate this reply commits you to; files as a pending card in their queue, or on cleaner cards can send straight after | partly, in the block copy |
| Work slip / slip | a task on the Work board, mined from the message | no |
| Add-on / payment link / extras queue | a Stripe link for a fee, texted on the GUESTS line; lands on the statement | partly |
| Quote on file / Send a price / 2027 request / pre-release | SCA custom quotes and the pricing form at /guests/quotes | no |
| Proactive / reminder / recurring / one-time / polish | messages you start, optionally AI-rewritten into "our voice" | explainer paragraph |
| Inquiry / Needs your decision / Draft unavailable / Recheck & draft | rental inquiry cards where the AI could or could not price | no |
| Copy-to-send / Mark sent | WhatsApp-only guests the API cannot reach; paste by hand | hover title |
| Channel / module / Helm thread / GUESTS line / Quo | where a message travels; `module` is Guesty's channel key; Helm threads are SMS on (978) 865-2575 | composer footer only |
| Direct-booked | a Guesty stay Guesty cannot message; use SMS or email | yes, in the no-send note |
| Stale / drafted 5h ago (red) | the card has sat four hours; likely answered in Guesty | no |
| Held / pitch / Not a pitch, draft it | a first-contact email the pitch screen judged to be a sales pitch | one sentence in Delivery & sync |
| Drafts paused / AI unreachable / billing | the model is down; an empty queue is not quiet | yes, in the banner |
| Degraded | a concierge state the UI never names | no |
| Import / source / coverage / work sync / Review import | Delivery & sync's words for message ingestion and slip filing | no |
| One-shot rate / substantive / real work / courtesy ack / thank-you | share of drafts sent on the first try, excluding thank-yous and auto-sends | (i) tooltip |
| Tier 1 / 2 / 3, escalated, punted to SMS, auto-sent, auto-expired, auto-pruned | the responder's classification and outcomes | hover titles on three of them |
| Phase B / AUTO-SEND · 97% | a threshold Dotti set for letting a topic auto-send | no |
| Facts / distilled / curated / canon / Promote to canon / scope: voice, process | the responder's rule layers; canon outranks the KB | partly, in the reflection card |
| KB / knowledge base / proposed property updates / triage / ruling | per-property facts the guest AI reads; candidates mined from replies | eyebrow only |
| Saved replies / blurbs / Live / Retire | verbatim answers the responder quotes | explainer paragraph |
| Envelope / From / Reply-To / also on the message | who an owner reply reaches and as whom | yes, the block is self-explaining |
| Digest / schedule text / Re-scan / Refresh draft / Skip this day | the cleaners' daily checkout text and its three regenerate verbs | hover title on one |
| Owner block / clean after / owner hold | a Guesty owner stay and whether the crew cleans after it | yes |
| Follow-up work / Work & notes / Follow-up history | what approving also files, and what was filed | yes |
| Inbox zero / Needs review (N) / Scheduled (N) | queue titles | yes |

Of roughly 70 terms, about 12 are defined where they appear.

### Pages to merge, demote or delete

- **Merge the three crew queues into one "Team" inbox** (owners stay separate for access reasons): one card component with an audience chip and a filter row, one proactive panel, one proposed-updates card. The contractor page differs from the cleaner page by one optgroup and one warning. Cleaner-only extras (the digest, owner holds) stay as sections at the top under a Cleaners filter.
- **Move Performance off the Inbox** into a "Quality" lens of the Guests tab, closed by default on nothing because it is no longer on the working page. Learning's facts editor goes with it.
- **Demote "Rules the AI keeps being taught" and both "Proposed property updates" designs** to that same Quality lens, or to the property page they file into; keep a one-line count on the Inbox ("3 property facts to file →").
- **Delete the RemindersSection from `/messaging/send`** once the composer's send-later covers one-time messages; recurring guest reminders are rare enough to live on the stay (the Conversations row) rather than a form that fetches Guesty's reservation list.
- **Delete the duplicate "Last 24 hours" on owners** in favour of the shared Follow-up history and a Decided recently ledger.
- **Register `/messaging/blurbs` in the atlas** or fold Saved replies into the Quality lens.
- **Give `/messaging/status` the messaging shell** rather than a page with only a back link.

### Plain bugs

1. **Skeleton does not match the page.** `app/messaging/loading.tsx:25-31` renders a HelmHero ("Module 08 · Messaging / Guest replies, one tap to ship.") and a footer "Stay Concierge · drafts via Opus 4.7"; `app/messaging/page.tsx:45-64` renders no hero and `MessagingFooter`. The swap shifts layout, which the loading file's own comment says it must not. Same on `app/owner-messaging/loading.tsx:22-34`. The cleaner and contractor loading footers also say "drafts via Opus 4.7" (`cleaner-messaging/loading.tsx:25`, `contractor-messaging/loading.tsx:25`); per memory the responder has been Sonnet 4.6 since 10/16.
2. **Owner data reachable by staff through the APIs.** `/api/messaging/queue?audience=owners`, `/api/messaging/search` and `/api/messaging/pending-count` check only for a session (`app/api/messaging/queue/route.ts:58-66`, `app/api/messaging/search/route.ts:12`, `app/api/messaging/pending-count/route.ts:42-57`); `/api/messaging` is not in `OWNER_API_PREFIXES` (`lib/helm-access.ts:96-128`). The page is gated; the data behind it is not.
3. **Owners tab shown to staff** (`components/MessagingTabs.tsx:58`) despite `access: 'owner'` in `lib/helm-modules.ts:470`; it bounces to `/not-available`.
4. **Staff dead ends on the guest card**: "Send a price" (`MessagingQueue.tsx:1485,1528,1559`), quote rows (`:1054`), "See all N in Quotes" (`:1126`), the handoff "Owner messaging" link (`:1343`), `WorkFollowups.tsx:26`, `MessageOutcomes.tsx:22` for owner notes, `lib/concierge-alerts.ts:65`.
5. **`/messaging/blurbs` is missing from `lib/helm-modules.ts`**: no Cmd+K, no registry breadcrumb.
6. **Phone overflow on two ledgers**: `RecentStrip.tsx:72` (`180px 1fr 80px 170px`, class `rt-msg-recent-row` has no CSS rule) and `OwnerRecentStrip.tsx:59` (`210px 1fr 80px 170px`, no class).
7. **Contractor empty state names the incoming staff member as a contractor**: "Texts from Delaney show up here automatically." (`ContractorMessagingQueue.tsx:100`).
8. **"Send automatically at 6 PM" is hardcoded** (`ScheduleDigestCard.tsx:537`) while the copy above it prints the configurable `send_hour_et` (`:517`).
9. **Thread panel claims Guesty provenance for Helm-native threads**: "Loading the conversation from Guesty…" (`Thread.tsx:207`) and "Live from Guesty · refreshes every 20s" (`:299-301`) render for `helm:` SMS threads too.
10. **Conflicting mobile CSS**: `app/globals.css:1139` and `:1200` both target `.rt-message-options` inside `max-width: 640px` with opposite values; the first is dead.
11. **Benign state in error colour**: the owner card's "Checking this message for follow-up work." renders in `var(--signal)` (`OwnerMessagingQueue.tsx:541-545`).
12. **Unstyled controls**: raw `<button>`s "Refresh scheduled messages", "Retry loading recipients", "Discard draft" (`RemindersSection.tsx:119,124,616`; `ProactiveRemindersPanel.tsx:165,170,716`), the notice "Dismiss" (`MessagingQueue.tsx:164`), "Discard changes" (`OwnerFactsEditor.tsx:140`), and bare `<p role="status">` notices (`RemindersSection.tsx:177`, `BlurbsLibrary.tsx:249-250`).
13. **Retire a saved reply has no confirm and no way back from the page** (`BlurbsLibrary.tsx:283-289`; retired rows are filtered out at `:93`).
14. **Doc drift on the handoff**: CLAUDE.md says a handoff "waits for a second approve" in the audience queue; the cleaner handoff offers "Send to Rosa", which texts her right after the guest reply with no second approve (`MessagingQueue.tsx:1299-1311`). One of the two should change.
15. **Hidden keyboard shortcuts on owner cards** (`OwnerMessagingQueue.tsx:281-316`): `r` on a focused card rejects with no confirm and no on-screen hint.
16. **Queue skeleton title "Pending"** (`components/QueueSkeleton.tsx:16`) vs the live "Needs review (N)".
17. **Payment-link copy asserts an identity**: "sends from the Guests line as Allie" (`send/PaymentLinkPanel.tsx:279`) regardless of who is signed in. Verify against the SMS template before 11/1.
