# Money, Growth and Library: UX audit, 2026-11-07

Read-only pass over the code in this worktree against the 10/17 audit and the 128 PRs since 10/19. Nothing here touches payout math, the Stripe matcher or the render page's figures.

### Still good

- The statements close is now one sequence. Five fixed steps with counts, each Open landing on the exact unfolded section (`page.tsx:4420-4600`), and `StatementSentReview` takes over once every statement is sent, saying plainly that readiness is a fresh check, not evidence about the past. Native `confirm/alert/prompt` are gone from the page (0 left; `useConfirm` 16 times).
- Books is the tidiest money page: Categorize N, Accept N high-confidence, per-row Confirm / category select / Undo, and a filter bar of one checkbox, one quarter select and one search (`BooksReviewSection.tsx:251-421`, `BooksFilterBar.tsx:33-76`). The index lands on the Rising Tide ledger.
- Campaign send is a two-step review with the live count repeated on the confirm (`campaigns/[id]/page.tsx:411-449`). Growth's strip is rendered once by a layout (`GrowthTabs.tsx`), so it never jumps between siblings.
- Forecast has one slider, a year toggle, two disclosures and three buttons for a 2,133-line model; the scenario is a link; the cover sheet is four rows. Leave it.
- The More menu is three items for owners (Playbook, CRM, Search), four for staff. The disputes index says in one sentence what Helm will and will not do (`disputes/page.tsx:79`).

### Findings

1. **Statements carries its own control kit, so one strip shows three button faces and one card shows four.** `page.tsx:1408-1456` (EditorialButton), `4204-4219` (outline EditorialButtons, then `buttonClass('secondary')` for Add receipt, then an inline-styled filled Upload Month), `2700-2785` (View Statement filled, Download PDF ink-bordered, Re-upload Data and Multi-month rule-bordered). Toast, PreviewModal, CheckTask, SyncMenuItem, MiniMetric and Insight are also page-local. Simplification: swap EditorialButton and the two inline links for Button/buttonClass, and the card row becomes one primary (View Statement) with the rest `quiet`. [still-open-from-10/17] M.

2. **Eight toast slots, none auto-dismiss, one runs nine clauses.** `page.tsx:4226-4330`: missingMonth, refreshNotice, closeStateError, ownerCfgError, invoice, Guesty, CSV, Stripe, single and bulk draft. After Sync All, four can stack above the title. Simplification: one toast slot showing the latest result, success auto-dismisses, the Guesty and Stripe sentences cut to "N reservations, N reviews" with detail behind the Sync menu's meta. [still-open-from-10/17] S.

3. **Re-ingest still has three doors and the upload page is a second statements page.** Strip "Upload Month" (`4212`), card "Re-upload Data" (`2765`), period select "+ New month…"; the upload page then prints "01 Parsed Reservations" with the same eight columns as the card's "02 Reservations" (`upload/page.tsx:782-795` vs `page.tsx:1961`), its own Stripe sync block (`upload/page.tsx:175-200`), and ends on View Statement / Upload Another / View Statements. The 10/17 verdict (demote upload to a step the card opens) did not ship. Simplification: the card's Re-upload opens the three file slots inline under 01 Financials and returns to the card; the strip keeps "+ New month" only. [still-open-from-10/17] M.

4. **One count printed three times per property.** "N owner action" chip on the collapsed header (`page.tsx:1790`), "Owner requests (N)" tick in Send (`2638`), and the Preview's OwnerRequestsPanel. Likewise Revenue / Stays / Cleaning MiniMetrics in the header (`1803-1806`) repeat 01 Financials once the card is open. Simplification: hide the mini metrics and the chip when the card is expanded; the Send tick is the one place the count lives. [still-open-from-10/17] S.

5. **Three doors to a receipt, three to the splitter.** "+ Add receipt" inline (`2075` region), the strip's Add receipt link to `/statements/receipts` (`4204`), the handoff's File as receipt; the installment splitter from every long-stay row and from "Multi-month bookings →" (`2766-2775`). Simplification: the receipts page is the phone door and the card's inline ReceiptCapture goes; the Multi-month button goes, the per-row link stays. [still-open-from-10/17] S.

6. **"Stripe lookup" hides two owner pages in a sentence.** `payments/page.tsx:110-115`: Balance charges and Disputes are prose links under the hero, both `hidden: true` in the atlas, while `/api/cron/stripe-disputes` files a daily to-do pointing at one of them. A person would say "Stripe", not "Stripe lookup". Simplification: tab label "Stripe"; for owners a SectionTabs row under the hero, Lookup / Balance charges / Disputes; the sentence goes. [new-since-10/19] S.

7. **The dispute packet's working form has its own faces and repeats its title.** `disputes/[property]/[charge]/page.tsx:232-262`: a GET form with a "Reason" select whose chosen option is already the h2 above it (`218`), an inline-styled filled "Update packet", and `PrintPacketButton` with the same filled face. Two primaries on one page. Simplification: the reason select sits on the hero line and submits on change; Save as PDF is the one primary, Update packet goes. [new-since-10/19] S.

8. **Reviews are read in Growth and worked in Messaging with no bridge.** `/guests` (ReviewsTab, 4 stats, 3 selects, window and view switchers) never mentions `/messaging/reviews` (0 matches in `ReviewsTab.tsx`); the Guest reviews lens never links the ledger. `/reviews` is only a redirect (fine). Simplification: one line on the Reviews tab, "N review cards waiting · Messaging", and a "Reviews ledger" link in the lens's rules block (`messaging/reviews/page.tsx:66-78`). [new-since-10/19] S.

9. **Two person pages, both titled Contacts, never linking each other.** `/guests/[id]` is a subscriber record (Status, Subscribed, Source, Sent / Opened, Unsubscribe, mailto, Stays, a Reviews link that is a name search, Timeline: `guests/[id]/page.tsx:47-140`); `/crm/[id]` is the relationship record (types owner / vendor / lead / other, Activity, Meetings, slips). No `crm/` link in guests, no `guests/` link in crm; Growth tab "Contacts" and CRM hero "Contacts" (`crm/page.tsx:79`, `helm-modules.ts:739,818`). Search covers only `contacts`, never guests (`lib/search.ts:98`). Simplification: the subscriber list reads "Guest list" on the tab and hero; the guest record carries a Stripe lookup link (the guest card already does) and a CRM link when the email matches; guests join Cmd+K. [structural] M.

10. **Quote detail prints the send verbs twice for a draft.** Next card: Email quote / Text quote / Copy link (`quotes/[id]/page.tsx:54-81`); "Send the quote to the guest" section: Email quote / Text quote / Email + text / Mark as sent / Extend (`258-302`). Simplification: when the Next card carries verbs, the Send section folds to its one status line. [new-since-10/19] S.

11. **Quote composer: 25 fields in nine blocks, guest last.** Property, Stay, Price (Nightly and Total are "the same number two ways"), Payment plan, Guest, Message, Terms, Internal notes (`QuoteComposer.tsx:329-633`). The 10/17 order was Guest first; a quote is for someone. Simplification: Guest block first; one price field with a nightly/total toggle. [still-open-from-10/17] S.

12. **Guest record: three faces in one Actions row.** Danger Unsubscribe or primary Resubscribe beside a secondary mailto "Send 1:1 email" (`guests/[id]/page.tsx:92-108`), under a Do not host verb. Simplification: one `quiet` Unsubscribe in the header meta; the mailto is the email itself. [new-since-10/19] S.

13. **Marketing still defines its own six columns in tooltips, and the Playbook list opens on a stat strip.** Six `info=` tips on the Marketing tiles (`marketing/page.tsx:94-130`); Playbook's Entries / Categories / Updated this month / Pinned strip (`playbook/page.tsx:35-42`) above a short list, none of it actionable. Simplification: the tooltips go (labels name the thing); the Playbook strip goes. [still-open-from-10/17] S.

14. **"Countersign as Allie" for any owner.** `agreements/[id]/page.tsx:184`; the action records the session (`actions.ts:317`). Simplification: label "Countersign" and the row stamps who did. [still-open-from-10/17] S.

Also noted, not ranked: "LLC Accounting" on the tab, `/books` in the URL and "Books" everywhere in the docs is three names for one module (S); Revenue is 16 figures plus six per home and three toggles, which is a lot but each is a different fact, so I would leave it.

### Pages to merge, demote or delete

| Page | Verdict | Why |
|---|---|---|
| /statements/upload | Demote to a step the card opens | Repeats the card's reservations table and Stripe block; third re-ingest door |
| /payments/balance-charges, /payments/disputes | Surface as a sub-strip under a "Stripe" tab | Reachable only through a sentence; both hidden in the atlas |
| /guests/[id] and /crm/[id] | Cross-link now; one person record later | Two "Contacts" pages for one human, no link either way |
| /reviews | Keep as redirect | Does its job |
| /statements/receipts | Keep as the phone door; drop the card's inline capture | Three doors to one receipt |
| /books/accounts | Keep | Reference, linked from the ledger |
| /search | Keep | The palette's long form, as 10/17 decided |
