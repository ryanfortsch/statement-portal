# Cleaning reviews and My page

November 7, 2026. Two things shipped together: the inspector rates the clean
at the end of every walk, and each person on the team has a page of their own
numbers at `/me`. On November 10 the per-walk text became one email a week,
on Friday (Dotti: "batch and send one on friday via email").

## The rating

The review screen at the end of a walk (`Stepper.tsx`, above Supplies Check)
asks one question: **How was the clean?** Five stars, one tap each, or "No
clean to rate" for a walk of a house nobody cleaned. Complete waits for an
answer. Staff and Field inspectors see the same block.

- **Five stars** closes the question.
- **Four or fewer** (`CLEANING_FLAG_MAX` in `cleaning-reviews-core.ts`) opens
  "What was off?" and a photo row.

The status line says where every rating goes: "in Friday's email".

`completeInspection` calls `saveCleaningReview` once per walk (one row per
`inspection_id` in `cleaning_reviews`). The save stores the stars, the reason
and the photos. **It sends nothing and files nothing for the crew.**

## Friday's email

`/api/cron/cleaning-review-email` runs Fridays at 12:00 UTC (7 or 8 AM in
Gloucester) and only drafts. `draftWeeklyCleaningReport` takes every rating
no report has carried, walked through Thursday and no more than two weeks
back, and writes one `cleaning_review_reports` row for that `week_end`
(unique, so a second run stops), then stamps each rating's `report_id`. A week
with no ratings drafts nothing.

The email is ours, composed by `composeWeeklyEmail` in both languages:

- the week's average and count first ("Média 4,6 de 5 em 9 limpezas.");
- every clean in walk order, its stars, home and day the crew's way;
- under each at four or fewer, the reason and the photo links. The reason goes
  through the same model pass as the schedule's special-instructions line
  (`cleaner-note.ts`), falling back to the words as typed;
- "Obrigada!" and no name. It never names the inspector.

## The card

Under Cleaners on the Team inbox (`CleaningReviewCard.tsx`, channel Email):
"Cleaning review · Nov 6 to Nov 12", the average and how many were flagged,
every clean with who rated it, the reasons and photos, then the email in the
reader's language with its English under it, and the addresses it would reach.

- **Approve & send** is the one door to the crew (`approveCleaningReview`).
  It claims the report (pending to approving; a five-minute-old claim may be
  taken over) and emails each enabled `cleaner_schedule_recipients` row that
  covers those homes and has an email, in that reader's language, from the
  cleaning role address (Rising Tide <cleaning@risingtidestr.com>,
  `cleaningReviewSender`, `CLEANING_FROM_EMAIL` overrides) with
  Ryan, Allie and Delaney on copy (the `cleaning_review` duty in `team.ts`,
  shown on the card). Reply-To is the cleaning address too
  (`cleaningReviewReplyTo`): a Google Workspace group, created 2026-11-10,
  whose members are Ryan, Allie and Delaney and which accepts outside mail,
  so a plain Reply reaches all three. `CLEANING_REPLY_TO` overrides it. One
  idempotency key per report and reader, so a retry mails once.
- **No email on file, no send.** The card says to add one under Cleaner
  settings (`/turnovers/settings`, the Email field on each recipient). The
  column is read apart from `RECIPIENT_COLS`, so the daily text never depends
  on it.
- **Edit** stores the operator's words verbatim as the email the card shows.
  The English check stays as drafted and says so.
- **Mark handled** clears the week with a reason (Spoke with the crew, Skip
  this week). Undo brings it back. A sent email cannot be unsent.

The Cleaners badge and the title row count it. `cleaning-review-guard.test.ts`
reads the source so the send stays inside approve, the save and the draft send
nothing, and the cron only drafts on its Friday schedule.

Per-walk notes still pending on November 10 were marked handled by the
migration and rode in the first Friday email. Texts already sent keep their
"texted" word on `/me`.

## My page

`/me`, from the avatar menu, on the atlas hidden from nav so Cmd+K finds it.
Four numbers, then the three ledgers behind them:

| Number | Where it comes from |
|---|---|
| My guest rating | The guests' Guesty stars on the stays this person walked before. Every completed `inspections` row under their Workspace email or an old Field address (`team.ts` `fieldEmails`) finds the stay it prepped: the packet stop's booking where the walk was a Field stop, else the next canonical check-in at that home within ten days (`inspector-reviews-core.ts`). One review per stay. |
| Fleet, 30 days | `getReviewWindowStats(30)`, the Reviews tab's own number, active homes only. |
| Open work | The board's "mine": slips they perform or coordinate, linked reports collapsed, plus their office to-dos (`open-work-for.ts`). Past due in red. |
| Cleans, 30 days | The stars they gave, how many, how many flagged, from `cleaning_reviews`. Each row says where its weekly email stands. |

Staff see only their own. An owner reads a teammate's with `?as=<email>` (the
row of names under the head); a staff login's `?as=` is ignored.
