# Cleaning reviews and My page

November 7, 2026. Two things shipped together: the inspector rates the clean
at the end of every walk, and each person on the team has a page of their own
numbers at `/me`.

## The rating

The review screen at the end of a walk (`Stepper.tsx`, above Supplies Check)
asks one question: **How was the clean?** Five stars, one tap each, or "No
clean to rate" for a walk of a house nobody cleaned. Complete waits for an
answer. Staff and Field inspectors see the same block.

- **Five stars** is stored and nothing more.
- **Four or fewer** (`CLEANING_FLAG_MAX` in `cleaning-reviews-core.ts`) opens
  "What was off?" and a photo row, and says in one line what Complete does:
  a note for the crew waits for approval on the Team inbox.

`completeInspection` calls `saveCleaningReview` once per walk (one row per
`inspection_id` in `cleaning_reviews`). The save renders the crew note in
Portuguese with the English beside it: the template is ours
(`composeCleaningNotice`: the home, the day the crew's way, the stars, the
reason, the photo links, no person's name), the inspector's reason inside it
goes through the same model pass as the schedule's special-instructions line
(`cleaner-note.ts`), falling back to the words as typed. The row is filed
`notice_status = 'pending'`. **The save never texts.**

## The card

Under Cleaners on the Team inbox (`CleaningReviewCard.tsx`, Helm-native like
the vendor hold card): who rated, the stars, the reason, the photos, then the
Portuguese text with its English under it, and the names it would reach.

- **Approve & send** is the one door to a phone (`approveCleaningReview`). It
  claims the row (pending to approving; a five-minute-old claim may be taken
  over), reads the cleaner schedule's enabled recipients for the home's region
  (`cleaner_schedule_recipients`: fleet-wide `'{}'` or mapped to the home),
  and sends each their own language from the Rising Tide line. No recipient,
  no send: the card says to add one under Cleaner settings.
- **Edit** stores the operator's words as the Portuguese that sends, verbatim,
  and remakes the English from them.
- **Mark handled** clears it with a reason (Spoke with the crew, Not the crew,
  Rated by mistake). Undo brings it back. A sent text cannot be unsent.

The Cleaners badge and the title row count it ("1 cleaning review").
`cleaning-review-guard.test.ts` reads the source so that `sendMessage` stays
inside approve and nowhere else.

## My page

`/me`, from the avatar menu, on the atlas hidden from nav so Cmd+K finds it.
Four numbers, then the three ledgers behind them:

| Number | Where it comes from |
|---|---|
| My guest rating | The guests' Guesty stars on the stays this person walked before. Every completed `inspections` row under their Workspace email or an old Field address (`team.ts` `fieldEmails`) finds the stay it prepped: the packet stop's booking where the walk was a Field stop, else the next canonical check-in at that home within ten days (`inspector-reviews-core.ts`). One review per stay. |
| Fleet, 30 days | `getReviewWindowStats(30)`, the Reviews tab's own number, active homes only. |
| Open work | The board's "mine": slips they perform or coordinate, linked reports collapsed, plus their office to-dos (`open-work-for.ts`). Past due in red. |
| Cleans, 30 days | The stars they gave, how many, how many flagged, from `cleaning_reviews`. |

Staff see only their own. An owner reads a teammate's with `?as=<email>` (the
row of names under the head); a staff login's `?as=` is ignored.
