@AGENTS.md

# Rising Tide Helm

Claude Code remains the primary agent. Shared roles, work preservation, data access,
verification, and deployment rules live in `AGENTS.md` and apply to every agent.
This file remains the business and architecture reference for all agents.

## What this is

**Helm** is the internal operations hub for Rising Tide STR, a vacation rental management
company in Gloucester, MA. Ryan (ryan@risingtidestr.com) runs Rising Tide and manages a fleet
of short-term rentals for their owners. Helm is where the team runs the business: owner
statements, turnovers, field contractors, guest and owner messaging, revenue, bookkeeping, the
property registry, and the prospect funnel all live here as sibling modules under one shell.

The repo began as the **Statement Portal**, which is now one module at `/statements`. Everything
else was built after. If you are reading this file to find out what exists, read the module map
below rather than assuming the repo is still a statements app.

Live at `helm.risingtidestr.com`. `statements.risingtidestr.com` 308-redirects to it (the OAuth
callback is pinned to the helm host; see `next.config.ts`).

Related docs:
- `AGENTS.md` at the repo root. Read it first. Next.js 16 has breaking changes from what you may
  remember; check `node_modules/next/dist/docs/` before writing framework code.
- `SCHEMA.md`. The source-of-truth map for the database (about 160 tables): which table is
  authoritative for a stay, a property, a contact, money. **This file owns business rules;
  SCHEMA.md owns which table holds what.** Do not duplicate schema listings here.

## Tech stack

- **Framework**: Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict
- **Auth**: Auth.js v5 (`next-auth` 5 beta) with Google SSO. Enforced in `src/proxy.ts`, which is
  Next 16's middleware file name. It gates every page and every `/api` route except an explicit
  public allowlist.
- **Database**: Supabase (Postgres). Migrations in `supabase/migrations/` (302 files). 20 legacy
  `supabase-schema-*.sql` files at the repo root predate that folder.
- **Hosting**: Vercel, auto-deploy from `main`.
- **UI**: Tailwind v4, shadcn/radix, recharts. The statement render page is the exception and uses
  inline CSS only.
- **AI**: Vercel AI SDK (`ai` v6).
- **PDF**: `puppeteer-core` + `@sparticuz/chromium` driving the HTML render page. See below.
- **Fonts**: Fraunces (serif), Inter (sans), JetBrains Mono (mono)

**Vercel plan: Pro.** Verified against the Vercel API on 2026-08-25 (team "Rising Tide",
`plan: pro`). Older source comments calling this a Hobby project were wrong and have been corrected.
Practical consequences: the 33 scheduled crons and the 29 routes at `maxDuration = 300` (counted
2026-10-23) are all fine, and platform Skew Protection is available. It was switched **on** on
2026-08-26 at `skewProtectionMaxAge = 43200` (12 hours).

## Shape of the codebase

Roughly 337k lines across 1,532 TypeScript files under `src/` (279 of them tests), counted
2026-10-22. Treat every number below as an order of magnitude with a date on it, not a fact: the
repo grew by more than a third between 2026-09-26 and 2026-10-22, and every count drifts
silently. They are here to tell you where the weight sits, nothing more.

```
src/
  app/          37 route folders + api/. 151 pages, 78 *actions.ts server-action files
    api/        149 route handlers, 34 cron routes (33 scheduled in vercel.json)
  lib/          450 top-level modules (478 including subfolders). The domain logic lives here.
  components/   145 shared components (91 at the top level, the rest in subfolders)
  proxy.ts      Next 16 middleware. THE auth gate. Read this before adding any public route.
  auth.ts       Auth.js config
supabase/migrations/   302 migrations
scripts/               parity harnesses and one-off tools (see Testing below)
```

**34 cron routes, 33 schedules, and that is correct.** `/api/cron/reviews-to-slips` is a manual
and backfill trigger on purpose; the recurring work runs at the end of `/api/cron/sync-guesty`.
Do not "fix" it by adding a schedule.

Load-bearing `src/lib` modules by importing files outside tests, 2026-10-22: `supabase-admin`
(253), `properties` (73), `stay-concierge` (71), `helm-access-server` (58), `field-db` (51),
`unsaved-work` (48), `paged-select` (44), `work-types` (43), `use-soft-refresh` (43),
`projections-types` (40). The top three have held since September; the rest of the order moves
as modules land, so read it as where the weight sits today.

## Module map

`src/lib/helm-modules.ts` is the single atlas of modules and nav. It is maintained and accurate.
**Add a new module there or it will not appear in nav or search.** Summary:

| Route | What it is |
|---|---|
| `/` | The signed-in person's day. Ask Helm under the title; the For Me feed in the order a day is worked (`src/lib/home-feed-order.ts`: Upcoming appointments first (30 days, explicit confirmation/attendance and source coverage, `src/lib/appointment-agenda.ts`), then my planned walks and dated work for seven days (`src/lib/home-week.ts`), then the clock-bound team items, my work, replies, office queues, payments; owners keep the clean-after card first); Today at the houses; two signals (Open work · this week, Turnovers · next 7 days) plus payout for owners; the cleanings strip. Concierge alerts are one line linking to `/messaging#alerts`. The feed's × only ever hides a row from your own feed |
| `/statements` | Monthly owner statements. Ingest, reconcile, close, send |
| `/revenue` | Portfolio revenue snapshot: stays, ADR, occupancy, owner payout |
| `/forecast` | The business plan as an interactive model; the scenario is a link (`?year=2027&new=3,2,0`). Its Actuals section (`#actuals`) holds the company card and operating upload and the "Where it goes" ledger (`overhead_expenses`) |
| `/books` | In-house bookkeeping for the three LLCs. Lands on the Rising Tide ledger (review filtered by the link: unreviewed only, quarter, search); the 1099 candidates sit there too; chart of accounts at `/books/accounts`. Each LLC's cash-basis P&L by month is `/books/<entity>/pnl?year=`, with the Excel download for the CPA (`src/lib/books-pnl.ts`: equity, liability, asset and owner trust money are listed beside net income, never in it). Its December 31 balance sheet is `/books/<entity>/balance-sheet?year=` (`src/lib/books-balance-sheet.ts`): opening figures as of one date per LLC, then the same ledger, each row's account on one side and its category on the other, plus year-end journal entries (the 1098's interest out of a mortgage, the CPA's depreciation) that the P&L reads too. It balances by construction; each bank account is checked against Chase's Balance column |
| `/payments` | Stripe lookup: did this guest pay, read live from the home's own Stripe account (read-only). Balance charges at `/payments/balance-charges` (owners only). The lookup is open to staff, read-only, since 2026-10-19, and the guest card and booking record link to it for every login; a tab on the Financials strip |
| `/cost-analysis` | Retired 2026-10-18; redirects to `/forecast#actuals`. Each home's cost to turn is on its property page (Owner & money, owners only) |
| `/turnovers` | Who's going where first: the week grid (`src/lib/visit-grid.ts`, `VisitGrid.tsx`), one row per home and one column per day for two weeks, a mark for whoever is going (a planned walk, a Field contractor, the walker). A tap on an open day before an arrival writes the stay's `inspection_plans` row for the person tapping (`claimWalk` in `plan-actions.ts`), the one record the board's walk column, the home feed and the Field packet board all read; a tap on your own mark releases it; another's mark asks first. Under it the turnover board: one line per house per day (house, `Out 10:00 · In 4:00`, the cleaner verdict, the walk, one verb), today plus tomorrow by default. The model is `src/lib/turnover-board.ts`; the six-stage rail opens only on lock-monitored homes |
| `/turnovers/calendar` | The occupancy calendar, 7, 14 or 30 days. The only place it renders; the pipeline links to it |
| `/turnovers/schedule` | Cleaner checkout schedule, merged with late checkouts and extensions. Each row links to its board row and back |
| `/turnovers/cleanings` | From Cape Ann Elite: only what no board row can show (a visit booked where nobody checks out, unannounced days). Not a tab; reached from the board and the home feed. Every checkout's verdict prints on its board row; a three-day strip of the same data sits on the home page |
| `/inspections` | Property inspection runs |
| `/fieldwork/*` | Contractor-facing ops: packets (one "Send a job" form at `/fieldwork/packets/new`; the maintenance bundler on the Handymen board), roster (hiring folded in as Applicants at the top; `/fieldwork/hiring` redirects there), shoots (creative pay ledger), trades (the outside vendor directory), close (the field's handoff before the statement close; staff add items, owners file them through the receipt path) |
| `/field` | The external 1099 contractor portal. Separate auth plane, magic-link tokens |
| `/work` | Work slips per property plus office to-dos (the `tasks` table). A slip belongs to a house; an office to-do does not. Both share one priority scale (Low / Normal / High), the close verbs (Mark done, Dismiss, Reopen) and a page where each field saves on its own. The strip is Board and Maintenance |
| `/properties` | Property registry. The largest module: 32 pages. Coming online (every home still on its Launch list) sits above the roster at `#coming-online`; `/properties/onboarding` redirects there. `/properties/guest-gear` is the guest gear grid (a tab on the Properties strip; `/work/gear` redirects) |
| `/properties/contracts` | Owner agreements, renewal mechanics, notice deadlines |
| `/properties/prospects` | Prospect funnel. Generates projection decks and partnership guides. A prospect's workroom is `/prospects/<id>` (`/projections/<id>` redirects there; the deliverable renders stay under `/projections/<id>/`) |
| `/properties/leases` | Winter lease leads from Zillow, owners only. `/api/cron/lease-leads` (every 30 minutes) reads the renter mail, files it by renter and listing and vets each lead; a lead that needs answers gets the fixed screening message once, through Zillow's relay, and only a serious one reaches the owners' home feed. The model reads facts, code decides (`src/lib/lease-leads-core.ts`) |
| `/staff-documents` | Offer letters and staff agreements, owners only: the team member signs at `/sign/<token>`, an owner countersigns, and the signed PDF is emailed and filed in Drive |
| `/messaging` | The Guests tab: guest message drafts awaiting approval (Inbox), Send (`/messaging/send`: a message, or a payment link under Charge), Saved replies and Quality; Delivery & sync at `/messaging/status`. The Inbox carries the New numbers card, where a text from an unknown number is attached to a contact, made a new one, or set aside (Not ours). Conversations steps back past its 60 days and takes a check-in range |
| `/owner-messaging` | Owner reply drafts (SMS + email), owners only |
| `/messaging/team` | The Team inbox: cleaner drafts (Portuguese with the English beside them) and contractor drafts in one list, an All / Cleaners / Contractors filter, the schedule text and "clean after?" under it. `/cleaner-messaging` and `/contractor-messaging` redirect here |
| `/guests` | Reviews (the last 30 days by default). The subscriber list is `/guests/contacts` (Add contact, New campaign, and a Manage list menu: campaigns, the CSV import, Sync from Guesty); `/guests/import` redirects there and `/guests/segments` to `/guests/campaigns/new`, whose audience select carries the segments. `/guests/agreements` for SCA rental agreements. `/guests/quotes` for SCA custom quotes and booking requests (composed here, paid on staycapeann.com). All of these, `/marketing` and `/competitors` share the Growth strip |
| `/crm` | Contacts, each with its Activity (calls, texts, emails and notes), and meetings. It opens on the contact list; one Refresh runs its syncs. Unknown numbers are triaged on the Messaging inbox (the New numbers card), not here. An important meeting (owner and prospect meetings by default) texts the evening before from the 24/7 line to `MEETING_REMINDER_PHONES`, else `DOTTI_PHONE` (the AirDNA reminder's rail); business meetings in the next 30 days feed the home agenda for owners, with attendance held for review; staff see the meetings they logged. The reminder cron and the home card failed every read from 10/07 until #2040 (2026-10-22): `contact_meetings.property_id` has no foreign key, so never embed `properties(...)` on it |
| `/channels` | The Helm-native Guesty replacement: multi-channel listings, iCal sync, bookings. Hidden from the nav lists (the route and Cmd+K stay) until a Cape Ann home is Helm-run; its pages light the Properties tab |
| `/marketing` | Site traffic and conversions for both sites. `/marketing/airdna` for comps (owners only) |
| `/competitors` | Other Cape Ann managers, inventory tracking. Owners only: owner-of-record research is prospecting |
| `/playbook` | SOPs and institutional knowledge |
| `/onboarding` | Owner intake forms, token-gated, public |
| `/today` | Retired into the home on 2026-10-18 and redirects to `/`. Today's check-ins, checkouts and walks are the home's "Today at the houses" section; sync health and Helm-run homes are on `/messaging/status` |
| `/search` | Long-form view behind the Cmd+K palette |

**Work slips are filed into lanes, and the lane is never stored.** `src/lib/work-slip-lanes.ts`
derives it from columns the app already keeps: supply (inventory), this visit (maintenance,
inspector scope or untriaged), handyman run, licensed pro, owner (category `owner` or the
`owner_action_required` flag, which wins over everything), office (`rising_tide`, `ad_hoc`,
and the concierge's desk-work rails under `other`; the concierge's `gear:` and `staycontact:`
slips ride the visit). The board groups by lane, the per-property print sheet prints one section
per lane with a synthesized line per row (`slipDetailLine`: the action summary when it says more
than the title, else the description collapsed and clipped; a pasted review never prints whole),
and a Field stop lists owner-waiting slips last. `src/lib/organize-work-slips.ts` is the nightly
pass (`/api/cron/organize-work`, 04:50 UTC, ahead of the field-packets planner; the board's
Organize button runs it on demand) that reads each NEW slip's language once per home and writes
only `category`, `run_scope` when untriaged, the owner flag and ask, `action_summary` when empty
and the description is a pasted source or long, and `organize_group` for slips about the same
object. It never writes title or description. `organized_at` is the once-only stamp: the sweep is
`organized_at IS NULL`, and every operator lane edit (category, scope, owner flag) stamps it, so a
human decision is never re-filed. Concierge-keyed, supplies-check, prep-rule and packet-backing
slips are skipped; they have their own lanes and lifecycles. On the slip page a person answers one
question, **Work type**, with the six lane words; `laneChoicePatch` in `work-slip-lanes.ts` is
what each answer writes (category, `run_scope`, owner flag), checked against `slipLane` so it
always reads back as the lane picked (`work-slip-whose-hands.test.ts`), and `updateWorkSlipLane`
is the one server writer. There is no separate category or scope picker on a slip.

A slip also has an office coordinator and next follow-up date, independent of the worker,
lane and scheduled visit. The detail shows linked active Field jobs (including bundled
attachments); a draft job is labelled proposed. My work includes slips a person coordinates
or performs. The board can filter for missing coordinators and assign selected slips to the
signed-in coordinator without changing their workers.

**One repair can have several original reports.** A person explicitly selects and
confirms related reports on `/work/[id]`. Suggestions based on matching text or
an existing object grouping never link automatically. Only reports at the same
property and with the same open/completed state can link; recurring supplies,
prep rules and guest requests stay independent. Work, property lists and home
work counts collapse confirmed memberships; original reports remain available.
The earliest visible deadline, high priority, active progress and every assigned
person remain represented. Completing any member completes all members atomically;
reopening one reopens the issue. Separate reports first for different outcomes.
This behavior lives in database triggers so existing Field and integration writers
follow it too; the table map and RPCs are in `SCHEMA.md`.

Work opens on **Next actions** (staff: **For me**): due this week, overdue, high
priority, in progress, or waiting without a follow-up date. Scheduled, Waiting,
Backlog and All are one click away; older filter URLs still work. Missing dates
or coordinators alone are not row warnings. Team keeps answered owner questions
and cleanly sent schedules folded; pending approvals, failed sends and unavailable
schedule data remain open. After all statements are marked sent, the dashboard
shows delivery and finalization separately from current checks. Those checks do
not establish whether an exception existed when the statement was sent.

**Every home also carries a brief** (`property_work_briefs`, `src/lib/work-briefs.ts`): a one-line
headline for the Work board's home header and three to seven bullets (`items`, each a lead naming
whose hands it is in and one clause) that lead the property page's Open Work section and the
print sheet, written by the model from the open slips grouped by lane
(what is blocking, what needs a pro, what a handyman run covers, what the next visit knocks out,
what to bring, what the owner owes, what is for the office; never a guest's name). It is rewritten
only when the slip set changes (`briefFingerprint` in `work-brief-rules.ts`), so the text is stable
and the model runs only for homes that moved: `/api/cron/work-briefs` at 05:05 UTC, after the
organize pass and before the field-packets planner, and after the board's Organize button. The
ledger under the brief is dense on purpose: the shopping list is one chip line, office items one
line, clustered slips one header, and a row carries no "Unclaimed" or OPEN pill.

**A signed management contract's terms are locked** (`src/lib/contract-terms.ts`, since
2026-10-15). The contract is not a stored document: `/contract/<token>`, the prospect page and
every PDF re-render it from the `projections` row. So once `contract_signed_at` is set, every
writer of a rendered term refuses (the prospect form, the three redline actions); the lock compares
the same `buildTemplateVars` the renderer uses, so it guards exactly what the owner signed. The
prospect form's Contract terms section is the one direct editor; the owner-redlines panel (Interpret
only) proposes edits, and both save through one writer, `writeContractTerms` in
`src/app/projections/actions.ts`, which holds the lock and the signature filter. The way
through is **Withdraw signature** (owners only, before countersign), which keeps the old signature
in `contract_signature_history`. Each signature also seals the PDF it emailed, with its SHA-256,
in the private `contract-records` bucket (`src/lib/contract-seal.ts`); the executed certificate
prints the owner-signed copy's fingerprint. Countersigning takes an owner login and records it
in `contract_countersigned_by`. A new writer of contract terms must check the lock;
`contract-terms.test.ts` reads the source for each one. The contracts register
(`property_contracts`) has three writers: countersign of a Helm renewal, promote of a new owner
who countersigned before the home existed (so a new home never opens on "Operating with no live
contract"), and the register's own "Register this agreement" form
(`src/app/properties/contracts/actions.ts`, owners only). The first two write the row through
`executedRegisterRow`; for an agreement signed in Helm all three take every stated term from the
projection through `registerTermsFromProjection` in `src/lib/contract-register.ts`, and the form
never writes the projection; it fills only what the contract leaves unstated (renewal summary,
Drive copy, notes).

**Every messaging queue renders one approval card** (`src/components/messaging/card/`, since
2026-10-18): who wrote and what they said, the proposed reply, then the same verbs on every tab
(Approve & send with Send later, Edit, Coach, Redraft, Mark handled with a reason, Undo and the
Decided recently ledger). What approving also does (a work slip, a payment link, a note to Rosa,
owner follow-up work) is one "Also on approve" line each, and a waiting card says why it waits in
one line (`src/lib/card-wait-reason.ts`, from the concierge's `send_attempts`/`last_send_error`).
Each audience wraps the card with its own blocks; add a verb or a rail to the card, never to one
queue. The team verbs (edit, redraft, undo, handled reasons) are stay-concierge's
`team_card_rails.py`.

The queues share the card and the proactive panel (`src/components/ProactiveRemindersPanel.tsx`)
but keep separate server-action files by audience. That split is deliberate: Next server actions
are per-route.

Team replies have a calendar-day send guard (`draft-validity.ts`): relative English/Portuguese
day words are anchored to the draft's Eastern date, and elapsed ISO dates require review.
Helm re-reads the draft before approving or scheduling it. Evergreen work stays open. This
is a Helm boundary; already scheduled sends and direct service callers still belong to
stay-concierge's dispatcher.

**A guest reply can draft a note to a teammate.** When the AI sees that a reply COMMITS something
a teammate must act on (an 11 AM late checkout Rosa has to plan the turnover around, a repair for
a contractor), the guest card carries a preview of that teammate's message and a ticked checkbox.
Approving files it as a PENDING card in that audience's own queue, where it waits for a second
approve. Nothing sends from the guest card, and nothing reaches the crew unattended.

Detection and the preview live in stay-concierge (`src/team_handoffs.py`), because that is what
composes the draft; Helm renders the block and passes `create_handoff` back on approve. Two rules
are load-bearing and were both learned the hard way:

- The gate reads the guest's message AND the reply, never the reply alone. The settlement is the
  shortest line in the thread and carries no vocabulary at all ("11am works, you're all set"); the
  ask carries all of it.
- The commitment is created by the approve TAP, not by history. The three thread miners
  (`messages-to-slips`, `mine-checkout-changes`, `turnover-notes`) all read the past on a cron and
  all three miss this by design or by timing. Do not "fix" one of them to cover it.

**Confirmed checkout changes update the cleaner schedule.** Stay-concierge records a
`checkout_commitments` outbox event in the successful-delivery transaction for approved
and scheduled replies, and in the manual-send audit transaction. Its worker retries
extraction and `/api/checkout-commitments` delivery separately, with a stable event key.
Helm resolves the property through the registry, reuses `checkout_adjustments`, and
refreshes pending digests. Sent digests are left intact; the resolved-message follow-up
links to the schedule's existing Send update review. No correction texts automatically.
Date changes, uncertain extraction, and conflicts with stronger schedule decisions are
proposals. The bridge uses the existing header-only stay-concierge authorization.
This covers concierge-delivered guest messages; Helm-native thread delivery is a separate
rail and is not handled by this outbox.

**A trade vendor's confirmed day is a hold card, never a write** (`docs/vendor-visit-holds.md`,
since 2026-10-18). When a `trade_vendors` number texts a visit day on any line, the Quo ingest
files one `vendor_visit_proposals` row (`src/lib/vendor-visits.ts`) and nothing else. The Team
inbox shows it as a Vendor card under Contractors: what it reads as, the nights it would hold, the
slips it would schedule, and what the calendar says first. Only Approve writes, through
`src/lib/vendor-visit-approve.ts`: open nights only, re-read live (in Guesty itself on a guesty-run
home, so a night booked since the card was drafted stops it), then the ticked slips go
`scheduled` with `Vendor: <name>`. The reader (`src/lib/vendor-visit-dates.ts`) never guesses: an
unclear day or home is a question on the card. A home is matched by street number AND a street
word with dates stripped, never by a bare number, because "Wed 10/21" is not 21 Horton.
`vendor-visit-guard.test.ts` holds the never-write-before-approve rule.


The home appointment agenda also has `/appointments` for capture, review,
rescheduling and cancellation. Saved business appointments are private to the
signed-in email, including between owners; View as staff hides them. Existing
CRM visibility is unchanged. Confirmed times, arrival windows, tentative plans,
team coverage, owner-handled visits and unscheduled requests stay distinct.
Explicit source identities merge reviewed Calendar/email copies or a legacy CRM
row. Similar titles never merge automatically. Reviewing a CRM row in your own
agenda does not change the original shared record or its reminder texts.

Calendar and message ingestion is not comprehensive: no OAuth scopes are added
by the agenda. Its source coverage must remain visible until real connections
and successful syncs exist. Do not import private family/medical content or use
occupancy/cleaning events as personal attendance. The bootstrap import script is
offline by default and accepts reviewed business snapshots only; it is not a
sync worker. See `docs/appointment-agenda.md` for rollout and checks.

The separate hourly `/api/cron/appointment-capture` worker is opt-in through
`AGENDA_CAPTURE_EMAILS`, reuses only existing identity-verified Google credentials
and existing Quo business contact history, and records per-source freshness.
`agenda_capture` observations are private, service-only, and distinct from saved
appointments. Changed provider revisions require explicit review; they never
silently overwrite reviewed details or send anything. Gmail/Quo capture is a
bounded candidate queue, not exhaustive extraction. Calendar reads only the
account's primary work calendar. Missing scopes remain a visible coverage gap.

## Auth and routing

`src/proxy.ts` gates everything by default. A route is public only if it appears in
`PUBLIC_PATH_PREFIXES`, `PUBLIC_API_PREFIXES`, or one of the deliverable regexes. Anonymous `/api`
callers get a 401 JSON, not a sign-in redirect, so integrations can read the failure.

**Two roles sit behind the sign-in: owner and staff** (`src/lib/helm-access.ts`, since
2026-10-12). Owners are the explicit `access: 'owner'` rows in `src/lib/team.ts` (Ryan, Allie,
Dotti); every other `@risingtidestr.com` sign-in is staff, so a new Workspace seat fails closed.
Staff see operations and not money: the proxy turns them away from `OWNER_PATH_PREFIXES`
(statements, books, forecast, revenue, balance charges, contracts, prospects and `/projections`,
leases, owner messaging, quotes, the AirDNA upload, competitors, creative pay, rate card, the field
test page, staff documents) with a redirect to `/not-available`, and from `OWNER_API_PREFIXES`
(the statement pipeline and every session-called `owner_payout` writer, bank and receipt writes,
Stripe, the books, contracts, the prospect mail sync, the AirDNA upload and competitor sync, W-9
reveal) with a 403. Cron routes are left out on purpose: re-running a stuck feed is an operations
duty, so `/api/cron/sync-stripe` rewrites payouts for any signed-in session through
`authorizeCron`. Three things must agree, and `helm-access.test.ts` checks that they do:

- a module with `access: 'owner'` in `helm-modules.ts` is hidden from the staff nav and search,
  and its href must sit behind a gated prefix;
- a server action that moves money or reveals a contractor's pay or tax details calls
  `requireOwnerEmail()` from `helm-access-server.ts` (a server action posts to whatever page
  rendered it, so the path gate alone cannot cover an action shared across pages);
- Ask Helm builds its tool set per role (`createAskTools({ role })`), because the home page is
  open to everyone.

When you add a money page, add its prefix to the list AND the flag to its module. When you add
a money action, call `requireOwnerEmail()`. Owner money on the pages staff keep renders for owners
only, decided on the server with `isOwnerSession()` (#1772 and after): the home payout tile, the
fee on the properties list ("Managed" for staff), a property page's fee, bank, owner emails,
statements and contract, the calendar hover payout, the Field board and the channels bookings
payouts; only an owner sets a nightly price. `helm-access.test.ts` asserts each one. A new
owner-money figure on a page staff can open needs the same check and a line in that test.

**View as staff** (#1961): an owner can switch their own session to staff from the avatar menu
(the `helm_view_as` cookie); it only ever lowers a role. So every gate reads the effective role:
`effectiveRole()` in the proxy, `sessionRole()`, `isOwnerSession()` and `requireOwnerEmail()` on
the server, `useHelmRole()` in the client. `roleForEmail()` is the login's own role and is
allowed only in `helm-access.ts` and `view-as-actions.ts`; `view-as-staff.test.ts` fails on any
other caller.

**Team notices resolve by role and duty, never by a named inbox** (`src/lib/team-recipients.ts`,
since 2026-10-13). `team.ts` says who runs operations (role `operations`), who approves Field
pay and answers contractor questions (`duties: ['field_pay']`, Ryan), who runs the creative
program (`duties: ['creative']`, Dotti), who countersigns staff documents (`countersign`, Ryan)
and who is copied on them (`staff_copy`, Allie); a member with a `starts` date joins every list
on that day. `officeNotice()` is the Field office (first operations seat, the rest and field pay
on copy), `operationsEmails()` is the CC on contractor-facing mail, `fieldReplyTo()` is the one
inbox a contractor's reply lands in, `creativeLeadEmail()` the shoot and view-count reminders.
`team-recipients.test.ts` fails if `field-notify.ts` names an `@risingtidestr.com` address, and
checks the operations manager's start date agrees across `team.ts`, the payroll matcher and the
forecast. The AirDNA nudge and meeting reminders are owner work and still text `DOTTI_PHONE`
(meeting reminders go to `MEETING_REMINDER_PHONES` instead when it is set).

Two shared auth helpers exist. Use them; do not hand-roll a check:
- `authorizeCron(request)` in `src/lib/cron-auth.ts`. Accepts Vercel Cron's bearer or a signed-in
  Helm session. **Fails closed** when `CRON_SECRET` is unset. Every cron route uses it.
- `authorizeStayConcierge(req)` in `src/lib/stay-concierge-auth.ts`. Header only, always
  `x-stay-concierge-key`. **Never accept a secret in a query string.** URL logging was the leak
  vector behind the 2026-08-20 rotation. A bridge route is a `PUBLIC_API_PREFIXES` entry in
  `proxy.ts` whose handler calls it; three older ones (`payment-links`, `achieved-rates`,
  `balance-charges`) check the same header inline instead.

Public surfaces that self-guard by token rather than session: `/onboarding/<token>`,
`/contract/<token>`, `/agreement/<token>`, `/sign/<token>` (staff documents), `/c/<token>`
(cleaner schedule; `/clean/` stays open only for its redirect), `/b/<token>` (shoot briefs),
`/field/*` (contractor session cookie), `/book/*`, and the puppeteer-rendered deliverables under
`/projections/<id>/`, `/properties/<id>/`, `/inspections/<id>/render`, `/statements/render`.

The property Home Guide and WiFi placard contain credentials. They pass the proxy for PDF
rendering but self-guard before data access: a Helm staff session or a two-minute HMAC token
scoped to one property and document. `/api/property-pdf` authenticates staff before rendering.
`property-pdf.ts` sends the token only on the exact document navigation, in a header, never a
URL. Keep the document-root check: Next can stream a 200 shell for an unauthorized not-found
page. Printed WiFi QR codes encode network details directly and do not use these web routes.

`/api/archive-onboarding` also self-guards: staff may archive by projection ID; owners must
send that projection's onboarding token in the POST body. The thank-you page passes its
validated token to the silent archive trigger. Keep authorization ahead of both the existing
Drive URL response and all PDF/Drive work; the public proxy exemption is needed for owners.

# Money: the canonical statement math

**This chapter is load-bearing. Read it fully before touching anything that writes
`owner_payout`.** Per standing instruction, revenue, fee, payout and Stripe-fee code is not to be
rewritten without explicit approval plus a parity harness.

## Source of truth

1. **Guesty Owner Statement PDF** is the primary reservation source for `/api/ingest`. It is no
   longer the only one. Reservations also enter a statement through cross-month installment
   synthetic injection (`src/app/api/ingest/route.ts`) and through `/api/refresh-statement`, which
   builds rows from `guesty_reservations` for bookings the PDF missed.
2. **`guesty_reservations` table** carries the revenue-bearing fields: `total_paid`, `total_taxes`,
   `channel_commission`, `owner_net_revenue_guesty`. Populated by `/api/sync-guesty` or the
   `/api/ingest-guesty-csv` fallback. This table, not the platform CSV, drives the revenue
   reconstruction.
3. **Platform CSV** maps confirmation code to channel and guest name. Cached per month in Supabase
   Storage, so it only needs uploading once per month for the whole portfolio.
4. **Chase bank CSV** is corroboration plus cleaning charges. Revenue is never automatically
   derived from bank deposits.

**Why not bank deposits?** Stripe deposits include prepayments for future stays. A March deposit
may cover a June booking.

**The one deliberate exception**: the operator-reviewed add-on queue. An unmatched non-Stripe
deposit the operator explicitly attributes to a property-month becomes add-on revenue, and an
attributed debit becomes a payout deduction (`bank_deposit_attributions`). Nothing enters a
statement from a bank row without an operator decision.

## Recognition

Revenue is recognized **at checkout**, never at deposit.

The exception is an operator-created cross-month installment (`reservation_installments`): a long
stay can be opt-in split so each calendar month gets its nights-in-month share, with the Stripe
fee pro-rated by revenue ratio. Cleaning, repairs, `num_stays` and `nights_booked` attach only to
the `is_final_month` installment so nothing double-counts. See `src/lib/installments.ts`.

## Channel logic

- **Airbnb / Booking.com**: Guesty's rental income is correct as-is. `stripe_fee = 0`. Airbnb pays
  net of its fees; Booking.com uses its own payout schedule.
- **VRBO (HomeAway) / Manual / Direct**: Rising Tide's own Stripe processes the card, so revenue is
  **rebuilt from the guest gross**, not netted down from Guesty's rental income:

  ```
  stripe_fee       = TOTAL_PAID * 0.039 + 0.40
  adjusted_revenue = TOTAL_PAID - TOTAL_TAXES - effective_commission - stripe_fee
  ```

  `effective_commission` is post-kludge. See the legacy commission note below.

  **Fallback only** when `TOTAL_PAID` is missing: `stripe_fee = rental_income * 0.039 + 0.40` and
  `adjusted_revenue = rental_income - stripe_fee`. This path raises a data gap telling the operator
  to run Sync Stripe. Do not treat the fallback as the primary rule; earlier versions of this
  document did, and it was wrong.

  stripe-sync then moves revenue to what Stripe actually collected, not only the fee. When Stripe
  collected more than Guesty's `TOTAL_PAID` (Guesty recording one payment of a two-payment plan,
  seen from July 2026), it rebuilds `adjusted_revenue` from Stripe's gross with the same formula
  and the real fee, upward only. A Manual/Direct stay of 28 nights or fewer whose charge disagrees
  with the folio is recognized at what was charged: `collected_gross / the stay's tax multiplier -
  actual_fee`, either direction. Neither runs on a refunded charge, an installment row or a
  `paid_off_stripe` row, and the second skips legacy Guesty Payments charges.
- **Manual with $0 revenue**: homeowner stay. Skipped, no fee.

**Legacy commission kludge.** Before the accounting overhaul, a 4.4% gross-up was added to
Guesty's CHANNEL COMMISSION column so its PDF would approximate the post-Stripe net. Historical
rows still carry it. `stripLegacyCommissionKludge` in `src/app/api/ingest/route.ts` removes it:
Manual real commission is 0 (anything above a 2% ratio is the kludge); VRBO real commission is 5%
(anything above 7% is the kludge stacked on top); Airbnb and Booking.com pass through untouched.
**Except Vrbo bookings made on or after 2026-10-29**, when Vrbo moved to a flat 12% commission: the
ratio rule would cut a real 12% to 5% and overpay the owner, so a Vrbo row whose
`guesty_reservations.booked_at` is on or after the cutoff keeps its commission as given. The cutoff
and predicate live in `src/lib/vrbo-commission.ts`, every strip copy consults it, and
`vrbo-flat-commission.test.ts` guards all four sites. A null `booked_at` (every row before
2026-09-02) keeps the old rule.
`src/lib/revenue-math.ts` holds the UI-side mirror of this, and its docblock explains why the
canonical copy in `/api/ingest` must not import from it.

## The canonical formula

`computeStatementTotals` in `src/lib/statement-totals.ts` is the formula: pure, no imports, and
pinned by `statement-totals.test.ts`. `src/lib/statement-addons.ts` repeats it in its docblock
and loads the add-on terms. Each money figure is rounded to the cent:

```
fee_base       = rental_revenue + add_ons_mgmt_base
management_fee = fee_base * (management_fee_pct / 100)
owner_payout   = rental_revenue + add_ons_revenue
                 - management_fee
                 - cleaning_total
                 - repairs_total
                 - attributed_debits
                 - reserve_holdback
```

`rental_revenue` is the sum of `adjusted_revenue` across the month's reservations.
`add_ons_revenue`, `add_ons_mgmt_base` and `attributed_debits` all come from
`bank_deposit_attributions` rows with `status='attributed'` for that `property_id` + `month`,
loaded by **`loadAddOnTotals()`**. A statement with no attributions gets zeros and produces
numbers identical to the pre-add-on formula. `cleaning_total` is the bank-charged
`cleaning_events` rows (`CLEANING_MONEY_SOURCES`) net of `credit_amount`; an invoice-only row is
attribution and never bills. `repairs_total` and `reserve_holdback` are owned columns: read as
stored unless the writer that owns one passes a new value (ingest, fill-gap and the receipt
routes own repairs; the reserve route owns the reserve).

`management_fee_pct` is a whole number (25 means 25%), snapshotted onto the statement at ingest
from the home's `properties` row.

`reserve_holdback` is the per-statement Owner Reserve withhold, $0 by default, opt-in per statement
via the "Withhold Owner Reserve" checkbox. Policy: new owners give a $2,000 check on onboarding as
a minimum account balance; for owners who have not paid, the operator holds $2,000 from the next
payout instead. Preserved across re-ingest via SELECT-before-delete.

### One writer: `writeStatementTotals`

Since #1464 (2026-09-02), `writeStatementTotals` in `src/lib/statement-totals-write.ts` is the
only code that writes a money column on `property_statements`. On every call it reads its inputs
fresh and fails closed on any read error; refuses an empty reservations or cleaning read against
a stored statement that has stays or cleaning (the wipe-to-zero signature) unless the caller
asserts it; runs the finality guard before writing; then recomputes every derived column,
`management_fee` included, and writes them together. A caller that writes child rows first (a
credit, an attribution, a receipt, a removed stay) runs `assertStatementWritable` before those
writes and hands its receipt in, so a refused override leaves nothing half done.

Eleven sites call it: `/api/ingest`, `/api/fill-gap`, `/api/refresh-statement`,
`/api/resolve-gap`, `/api/reservations/remove`, `/api/bank-deposits/[id]`,
`/api/cleaning-events/[id]`, `/api/receipts`, `/api/receipts/[id]`,
`/api/property-statements/[id]/reserve` and `src/lib/stripe-sync.ts`. `/api/ingest` inserts the
row with its own figures first, then calls it; a difference over $0.02 files an
`ingest_recompute_mismatch` gap and the row-derived figure is stored. `/api/reconcile-emails`
writes no payout: it reads statements and files `data_gaps`. No caller adjusts the payout by its
own line against a stored fee any more; every one gets the full recompute.

If you add a writer, call `writeStatementTotals`; never update a money column directly. If you
change the formula, change `computeStatementTotals` and its test, and run
`scripts/single_write_path_parity.sql` (read-only, against the linked database) before and after.

Keep it that way. Before the single path every site carried its own copy, and the copies drifted:
#1327 folded the add-on terms into two recompute sites that had dropped them, and #1348 fixed
`/api/ingest`, which hand-rolled the add-on read, omitted the `direction` column, and so added an
attributed debit as add-on revenue instead of subtracting it. On a $275 debit at a 25% fee that
overpaid the owner by $481.25 and under-charged the fee by $68.75.

## Stripe fees: actuals are the rule

**Standing directive.** The `0.039 + 0.40` estimate is a placeholder written at parse time.
`stripe-sync` (auto-run on ingest, or the Sync Stripe button, or the nightly
`/api/cron/sync-stripe`) replaces it with the real `balance_transaction.fee` on every reservation
it can match. Never treat the estimate as final, and never revert a synced actual to the formula.

The matcher is a four-stage chain in `src/lib/stripe-sync.ts`, tried in order:
1. confirmation-code token in the charge description (Guesty-routed only)
2. amount fallback: expected gross is `total_paid` when > 0, else `guesty_rental_income + total_taxes`,
   matched within $1 against exactly one orphan charge
3. date-range fallback: the description's `YYYY-MM-DD to YYYY-MM-DD` equals the stay's dates. Sums
   every orphan charge sharing the range, which is how split payments are caught
4. guest-name fallback for one combined charge covering several stays, fee apportioned pro-rata

Fully-refunded charges and bridge-minted add-on links (charges carrying `helm_request_key`
metadata from `/api/payment-links`) are excluded from candidacy. Only a stay unmatched by all four
raises a `stripe_missing_charge` gap.

**The estimate also survives, deliberately, on three protected classes stripe-sync will never
rewrite**: frozen statements, reservations carrying installment rows (already pro-rated), and rows
marked `bank_match_status='paid_off_stripe'` (paid by check or wire).

**A statement is frozen** when its `close_tasks.email_sent_at` is set or its period's
`statement_periods.status` is `'final'` (Finalize Month), in every month;
`src/lib/statement-finality.ts` decides. The freeze is not a stripe-sync rule:
`assertStatementWritable` refuses every payout write to a frozen statement, from any caller, unless
the caller passes `force` after the operator confirms, and every forced write files a
`post_send_write` gap. stripe-sync never forces; it skips the property. This is a safety invariant:
a sync once moved a payout that had already gone out.

Per-property restricted Stripe keys resolve through `getStripeKeysMap()`, merging `STRIPE_KEYS_JSON`
(legacy blob), `STRIPE_KEYS_JSON_EXTRA` (overlay), and `STRIPE_KEY_<PROPERTY_ID>` (one key per
property, the standard for new ones). Adding a property never means reopening an existing var.

## Guest payment links

Add-on charges (late checkout, pet, extra night, replacement cost) are Stripe Payment Links minted
in the property's OWN Stripe account, so the paid charge reaches the statement through the extras
queue (`bank_deposit_attributions`) via stripe-sync's `helm_request_key` metadata check. Two doors
mint them and both run through `src/lib/payment-links.ts`:

- **Reactive**: stay-concierge detects a fee commitment in a reply draft (or a composer send) and
  calls the bridge `POST /api/payment-links`; the concierge texts the link itself.
- **Proactive**: the Payment link panel on `/messaging/send`. The operator picks the stay, types
  what for and how much (pre-tax; occupancy tax is added per `src/lib/addon-tax.ts`), and Helm
  mints the link and texts it from the GUESTS line (`quoFromNumber('guests')`). Typing "make a
  payment link" into the Send composer does NOT do this: the composer sends that text to the guest.

`payment_link_requests` is the ledger for both doors. `/api/cron/payment-links` (every 15 minutes)
and the bridge's `?status_key=` lookup stamp `paid_at` from the link's Stripe checkout sessions (a
poll, not a webhook: the accounts are the owners'). The ledger on `/messaging/send` and the home
For Me feed's Payments cards (paid this week; unpaid after 24 hours, with Nudge and Cancel) are the
alert surface. Nothing texts or emails the team, per the team-notification policy.

## Channel edge cases

### staycapeann.com (SCA) direct bookings

Rising Tide's own booking site is built so payment does **not** route through Guesty, which would
charge a per-booking fee. SCA bookings take payment through the property's own Stripe account via a
Payment Link, land in Guesty as `Direct` (normalized to Manual) for calendar sync only, and show
`TOTAL_PAID = 0` in Guesty because Guesty never sees the money. They are matched to their real
charge by the amount and date-range stages above. Treat this as the standard path for Direct stays.

**Occupancy tax is per-property**: base 11.7% (5.7% state + 6% local); CIF properties also owe the
3% Community Impact Fee for 14.7%. Rates live in `src/lib/occupancy-tax.ts`, keyed by property id,
with a quote-side twin in stay-cape-ann's `lib/occupancyTax.ts` keyed by **Guesty listing id**. The
Guesty listing's own tax config is what live quotes actually charge, so all three must agree when a
rate changes, and the two lookups are keyed differently.

### Custom quotes (Helm-issued, paid on staycapeann.com)

`/guests/quotes` composes a custom quote or booking request for a named guest: property, dates,
guests, a negotiated nightly rate or total, cleaning, extra fees, a discount, tax (owed rate, auto,
exempt over 31 nights), pay-in-full or a deposit now with the balance by a date, a note, an expiry,
and the cancellation wording. Helm sends it by email (Resend, from and CC hello@staycapeann.com) and/or SMS (Quo GUESTS
line) with a link to `https://staycapeann.com/quote/<token>`. Table `sca_quotes` (service-role
only); pure math and the wire types in `src/lib/sca-quotes-types.ts`, with a byte-compatible copy
in stay-cape-ann `lib/helmQuotes.ts`. Change one, change both.

**Helm owns the record; staycapeann.com owns the payment.** The guest page reads the quote through
`GET /api/sca-quotes/<token>` (bridge, `x-stay-concierge-key`) and, on accept, SCA's
`/api/quote/accept` authorizes the card on the property's own Stripe account, creates the Guesty
reservation at the negotiated price (`POST /v1/reservations-v3` with `accommodationFare` and
`cleaningFee`; `ignoreCalendar` / `ignoreTerms` only when the operator ticked the overrides, and
never over a booked night), captures, posts the payment to Guesty, files the rental agreement, and
reports back through `POST /api/sca-quotes/<token>/events`. Helm never touches a Stripe secret.

**Statements see it as an ordinary SCA booking.** The charge is a plain PaymentIntent described
`<title> - <check_in> to <check_out>` with NO `helm_request_key`, so stripe-sync's date-range
matcher pairs it (and a split deposit + balance pair, summed) to the reservation as stay principal.
Never mint quote money through `/api/payment-links`; that would classify it as an add-on. The
Guesty reservation's own total is read back after creation into `guesty_total_cents`; the detail
page flags a mismatch against what the guest paid so the operator can check the listing's tax config.

A daily cron (`/api/cron/sca-quotes`) expires stale quotes and sends balance reminders. This flow is
the durable fix for the 2027 pre-release gap where approved requests never got their payment link:
the composer accepts prefill from a Guests-queue card and the guest pays on the page.

### Legacy "Stay Collections" (Guesty Payments) charges

A shrinking back-catalog. Before SCA moved to per-property Stripe, some Direct bookings were paid
through Guesty Payments. These split one stay across multiple charges and carry a Guesty
application fee (~1%) on top of a higher processing rate, so the effective fee is well above the
3.9% estimate. **The tell is `application_fee_amount != null` on the Stripe charge**; current
RT-direct charges have none. `/api/installments/verify-source` expands `balance_transaction` and
sums all charges carrying the code, reporting actual net after real fees. It deliberately does not
change `calcStripeFee`, which would retroactively shift already-sent statements.

### Booking.com payouts

Payouts land in the central "Bookingcom Deposits" Chase account (...5623), then transfer to the
property's own checking as a plain "Online Transfer". Nothing Booking.com-labeled ever hits the
property's own bank CSV. The operator uploads the 5623 activity CSV monthly from the Statements
page; rows accumulate in `booking_account_activity` (dedupe-hashed, re-uploads idempotent).
Corroboration order: exact 1:1 deposit match within $5, then Booking.com-labeled text in the
property's own CSV, then the central 5623 transfer within the statement window (month start to 60
days past month end).

# Cleaning logic

**The bank statement is the source of truth for total cleaning cost.** On the property's Chase
account, `classifyBankRow` in `src/lib/bank-charges.ts` matches on the uppercased Description
column only (the Type column is deliberately unused so a match survives Chase relabeling the rail):

- **Cape Ann Elite** ACH charges: housekeeping, matched 1:1 to a checkout as a turnover
- **Nor'East** (`LINEN_VENDORS`): linen service, additive, not a turnover
- **Laundry Plus** (`LAUNDRY_VENDORS`): laundry service, additive, not a turnover
- **`MAINTENANCE_VENDORS`** is a fourth category and feeds `repairs_total`, not `cleaning_total`

All three cleaning-family vendors roll into a single `cleaning_total`. The owner sees one Cleaning
line with no turnover count.

**Adding a new vendor**: a new vendor inside an existing category (say a second linen service) is a
one-file change: add it to `LINEN_VENDORS` or `LAUNDRY_VENDORS` in `src/lib/bank-charges.ts`.
Everything downstream keys on `classifyBankRow`'s `kind` and the stored `cleaning_events.source`,
so ingest, fill-gap, cost analysis, the dashboard and the 1099 rollups pick it up automatically.
(`NON_TURNOVER_VENDORS` in that file is dead code with no consumers. Editing it does nothing.)

**Vendor credits are refunds, never income.** A positive bank amount on a recognized
**cleaning-family** descriptor is auto-netted at ingest against a same-month, same-category charge
for the same amount to the cent, nearest bank date winning, one credit per charge. The charge stays
on file with `credit_amount`/`credit_reason` and renders struck through; `cleaning_total` bills the
net. A credit with no exact same-month match raises a critical `vendor_refund_unapplied` gap and
parks in the bank review queue. Maintenance-vendor credits are never auto-netted by design
(`repair_events` has no credit columns), so they always raise the gap.

Laundry rows attribute to the nearest Cape Ann Elite cleaning within 7 days for display grouping;
outside that window they render standalone.

Cape Ann Elite bills through QuickBooks addressed to Allie. `/api/sync-invoices` pulls those from
Gmail. Invoices are for **attribution** (which checkout cost what) and never override the bank
total. The matcher restricts to `source IN ('matched','bank')` so an invoice cannot false-match a
linen or laundry row that happens to share an amount.

**Which property an invoice belongs to** is decided by `src/lib/invoice-property-match.ts`, used
by `/api/sync-invoices`. Needles come from the registry in three
layers, later winning: a hardcoded fallback (the floor, so an unreachable DB degrades to the fleet
we already knew), needles derived from each row's `name` and `address`, then explicit
`properties.invoice_match` entries. Matching is **longest-match**, because a sub-unit needle
contains its parent's and a first-hit scan bills the downstairs apartment to the main house. An
ordinary new property needs no stamping; `invoice_match` is only for spellings the address does not
yield (abbreviations, sub-units, suffix variants). Derived needles are restricted to strings
starting with a house number, so a bare-word name like "Marina" never becomes a needle.

**`/api/fill-gap` and `/api/ingest` share the cleaning rules; they do NOT hold two copies.**
This paragraph used to describe fill-gap as holding its own duplicate of the classification
pipeline, and as lacking credit netting. Both were true once and both are now wrong, which is
worse than saying nothing: it invites a fix duplicated into a file that already imports the
rule, and it warns you off editing the one place that actually owns it.

What is true, checked 2026-10-22:

- **`classifyBankRow` is one function** in `src/lib/bank-charges.ts`. Both routes import and call
  it (`ingest` line 916, `fill-gap` line 746). Adding a vendor is still the one-file change
  described above, and it reaches both routes with no lockstep edit.
- **Vendor-credit netting is shared** via `src/lib/vendor-credit-netting.ts`. fill-gap imports
  `netVendorCredits`, `vendorCreditFields` and `unappliedRefundGap` and does implement it.
- The two routes share fourteen `src/lib` modules in all, including `insertCleaningEvents`,
  `cleaning-credit-overrides`, `remittance`, `installments`, `statement-finality` and
  **`statement-totals-write`**, which is the single payout write path.

What can still drift is the ORCHESTRATION around those shared pieces: ingest is ~2,750 lines and
fill-gap ~1,250, and they differ in what they do with the results (ingest alone carries the
month gate, cancellation matching, internal transfers and the platform-CSV cache). So read both
before changing either. Just do not go looking for a second copy of the classification rule,
because there is not one.

# Trash and recycling

**`src/lib/civic.ts` owns the receptacle rule. Nothing else may state one.**

What a household puts waste in, and when it reaches the curb, is city policy. A property row says
where its bins and carts live; it does not get to contradict the city. Every surface reads
`civicForProperty(p).receptacleRule` rather than carrying its own copy, which is what keeps a
Gloucester cart sentence off a Rockport home that has no curbside collection at all.

| City | Rule |
|---|---|
| **Gloucester** | Automated Casella carts since **2026-10-01**, one 65-gal trash and one 65-gal recycling per unit, $300/yr billed $75/quarter on the utility account. STRs are not exempt. Everything inside with the lid closed; nothing beside a cart is collected. |
| **Rockport** | No curbside collection at all. Transfer Station, Town PAYT bags. |
| **Beverly** | Casella carts since 2026-07-01 on its own specs (95-gal recycling). Not Gloucester's rule. |

Three things to know before editing any of it:

1. **Purple bags are gone.** The program ended 2026-09-30 and its code, KB text and facts were
   deleted on 2026-10-02. No surface may mention them; stay-concierge's `content_guard` swaps any
   sentence that does for the cart rule.
2. **The wording is short (Dotti, 2026-10-02):** *"Carts go out the night before pickup and come
   back in once they're emptied."* Pickup is in the morning. The "back in" half is the compliance
   clause, not politeness: Gloucester STR ordinance **Sec. 5-66(q) fines $400 per occurrence** for
   a cart left at the curb, each day a separate offence, chained to the Board of Health rental
   permit. Never drop it.
3. **`properties.trash_notes` is LOCATION ONLY.** Where the bins and carts live, nothing else. The
   day and the city rule compose on top of it at render time. This keeps the column regime-neutral
   and matches what stay-concierge's `_house_lines` filter expects: it drops note sentences
   carrying a weekday or a clock time and keeps location sentences.

Collection days come from the DPW street list in `civic.ts`, overridable per property via
`properties.trash_day`. The city's PDF is checked in at
`docs/civic/gloucester-trash-street-list-2023-11-16.pdf`; the table was diffed against it row for
row on 2026-10-02 (690 streets, no differences). Checked against the city on 2026-09-25: the 11-16-23 revision is still
the current published list and the cart rollout does not move days. **Twelve streets carry two
published days** (the route splits them, and ten give no segment note), so `civic.ts` refuses to
answer for those rather than guessing; only an operator who has phoned DPW should fill the column.
Both live split-street homes are confirmed with DPW by Dotti on 2026-10-02 and set on the row:
`84_thatcher` is **Friday** (migration `20261002_thatcher_trash_friday.sql`) and `225_washington`
is **Wednesday** (the row already said so; now verified). `/api/kb-facts` bridges the **resolved** day plus `city` and
`receptacle_rule`, so the guest AI can gate its own wording, and it does: the concierge's trash
engine (the reminders and the schedule added to reply prompts) admits Gloucester homes only, and a
missing city reads as not Gloucester (stay-concierge #102, 2026-10-22). A Rockport or Beverly
`trash_day` reaches the guest only as the plain "Trash day" KB line.

**Guest messages** (stay-concierge `src/trash_reminders.py`, approval-gated): any stay of **5+
nights** that spans a pickup, so the city hauls the trash instead of the cleaner (3 nights from
2026-10-02 to 2026-10-27; Dotti dismissed 9 of the 15 cards that produced, so it went back to 5). A pickup the
morning after check-in is skipped (the turnover just emptied the house). A pickup on checkout
morning counts: the guest rolls the carts out on their last night and the turnover cleaner brings
them back in, which Rosa's schedule (`/c/<token>`) flags with a "bring the carts in" tag. Day-2 evening check-in naming the next pickup (or "tomorrow morning, carts out
tonight"), then a reminder two days before each later pickup.

# Properties

## Naming convention

Three forms exist for every property. Use the right one.

| Form | Field | Use for | Example |
|---|---|---|---|
| **Internal name** | `properties.name` | Helm UI, internal comms | `21 Horton` |
| **Full address** | `properties.address` | Statements, billing, tax filings | `21 Horton Street` |
| **External title** | `properties.title` | Airbnb, SCA, anything a guest sees | `Stay at Rocky Neck` |

Internal name is the street address without the suffix (St, Ave, Rd, Ln). Always. When in doubt,
the internal name is what staff would say in Slack.

## The fleet

`src/lib/properties.ts` `PROPERTIES` is the code-side roster (16 entries, 2026-10-22). The live
bookable fleet is larger and **Guesty is canonical for what is bookable**, not this list. Do not
treat the table below as the fleet.

**Statements read the `properties` table, not this list.** Since #498, ingest, the render page
and the statement email load each home through `getActivePropertyForStatements` /
`getActivePropertiesForStatements` (fee, owner, emails, bank, listing match, tax cert);
`PROPERTIES` is only their fallback when the database is unreachable. So a fee or owner change
goes in the DB row. A few routes still check the map itself (`/api/receipts` rejects an id it does
not list, `/api/reconcile-emails` matches names through it), so a new home still gets an entry.

| ID | Internal name | Owner | Mgmt fee | Bank last4 |
|---|---|---|---|---|
| `3_south_st` | 3 South | Bailey | 25% | 5622 |
| `21_horton` | 21 Horton | Kittredge | 22% | 1323 |
| `53_rocky_neck` | 53 Rocky Neck | Prudenzi | 25% | 9910 |
| `53_rocky_neck_2` | 53 Rocky Neck, Downstairs | Prudenzi | 25% | 1228 |
| `4_brier_neck` | 4 Brier Neck | Armstrong | 20% | 7876 |
| `30_woodward` | 30 Woodward | McWethy | 25% | 8221 |
| `20_hammond` | 20 Hammond | Ramsey | 25% | 9969 |
| `20_enon` | 20 Enon | Snyder | 25% | 1307 |
| `73_rocky_neck` | 73 Rocky Neck | Moynahan | 25% | 3227 |
| `17_beach_rd` | 17 Beach | Nolan | 22% | 5621 |
| `3_locust` | 3 Locust | Rising Tide (Goose of Astoria LLC) | none | - |
| `19_rackliffe` | 19 Rackliffe | Silverman | 25% | 0628 |
| `84_thatcher` | 84 Thatcher | Lopes | 25% | - |
| `225_washington` | 225 Washington | Babson | 25% | 1229 |
| `3_windward` | 3 Windward | Moynahan | 18% | 1232 |
| `47_atlantic` | 47 Atlantic | Erickson (47 Atlantic LLC) | 22% | - |

`53_rocky_neck_2` is a sub-unit; sub-unit matching uses longest-match on the listing name.
Multi-property owners (Prudenzi) get per-section ingest and one combined statement email.

**`3_locust` is the one row in that table with no owner.** Rising Tide owns 3 Locust outright
(title held by Goose of Astoria LLC, see `LLC_ENTITIES` in `src/lib/books.ts`), so no owner
statement is ever produced for it and no management fee is earned; `property_statements` has never
held a 3 Locust row and correctly never will. It stays in `PROPERTIES` because it IS in the
guest-facing ops fleet -- live Guesty listing, `/book` page, channels, turnovers, cleaner-text
routing, notes, invoice matching -- and `is_rising_tide_owned: true` on the entry is what marks it
out of the statement flows. `properties.is_rising_tide_owned` in the DB is the source of truth and
3 Locust is the only row carrying it. Do not read the `fee_pct: 25` still on that entry (and the
`management_fee_pct = 25` still on its DB row) as a billed rate: both are stale seed values kept
because fee numbers are payout math, and `is_rising_tide_owned` is what zeroes the fee in
`revenue-snapshot.ts` and `forecast-smart.ts`.

**House policy is one store** (`src/lib/house-policy.ts`, since 2026-10-18). The nine House
policy columns on `properties` are the only home for guest checkout, pets, quiet hours, max
occupancy, cancellation and house rules. The rate plan and the listing record read them (every
loader overlays them) and their forms no longer edit those fields; the retired copies on
`property_rate_plans` and `property_listing_content` were dropped on 2026-10-29, one release later
(`20261029130000_drop_retired_house_policy_and_walkthrough_stores.sql`). Check-in
is two values with two names: **Guest check-in** is the rate plan's `checkin_time`, **Cleaner
deadline** is `properties.default_checkin_time`. The climate automation runs from the same guest
times. `house-policy.test.ts` reads the forms and readers so a second writer cannot come back.

**Guesty listing mapping**: Guesty's platform CSV uses the External Title. The `listing_match`
field in `src/lib/properties.ts` is a lowercase substring matched against incoming Guesty listing
names. Where a title collides across properties (Brier Neck / 17 Beach / 84 Thatcher all read
"Good Harbor"-ish), match by Guesty listing id instead.

# The statement render page

`src/app/statements/render/page.tsx` is the deliverable. Server-rendered HTML designed to look
like a premium editorial document.

- **URL parameters**: `id` (property_statements UUID) and `month` (YYYY-MM). **That is all.** There
  is no `csv` parameter. Reviews and upcoming bookings are read server-side from Supabase.
- **PDF**: `src/lib/pdf.ts` drives Puppeteer over this same URL. `/api/statement-pdf`,
  `/api/archive-statement` and `/api/draft-email` all call it. Cmd+P still works for a human.
  **Never build a statement PDF by drawing primitives.** `pdf-lib` builds no PDF in the app, but
  `scripts/property-document-smoke.mjs` uses it in CI (`property-documents.yml`) to open the
  rendered PDFs, so it stays.
- **Reads with the service-role key**, not anon: it is a server component never bundled to the
  browser, and the statements tables are RLS-locked.
- `force-dynamic` on purpose: it reflects mutable review-queue state.
- **Design system**: warm paper `#faf7f1`, dark ink `#1e2e34`, signal `#c85a3a`, 816x1056px sheet
  (8.5x11" at 96dpi). Inline CSS only, no Tailwind on this page.
- Property display details come from `public.properties` at render time, not hardcoded.
- The two ADR figures are a **display-only guest-facing gross reconstruction**, deliberately walled
  off from payout math. Do not wire them into anything that pays an owner.
- Reviews are month-scoped and deduped by normalized text. If none qualify, the section is omitted.
- The Issued/Payout date comes from `statement_periods.funds_sent_date`, falling back to the first
  Monday of the following month.

# Integrations

## Guesty

`/api/sync-guesty` pulls reviews, reservations, and the listing map. `/api/ingest-guesty-csv` is
the fallback when the API is unavailable. Token caching is shared through the `guesty_auth` table.

**The sync runs its nine steps under a 240s budget** (`src/lib/guesty-sync-plan.ts`, since
2026-10-22; `maxDuration = 300` on it and on `/api/cron/sync-guesty`). Reservations and the three
steps that finish them (cancel reconcile, ghost bookings, the copy into `bookings`) run first; the
calendar pair and the reviews pair follow and swap places every UTC day. A step starts only if its
estimate still fits, so a slow run ends partial (`waiting_steps` in the response, one line on
Statements and Revenue) instead of dying mid-step. Body `steps` picks steps; the Revenue page's
auto-refresh asks only for the reservation steps. The reviews step looks a guest up in Guesty only
when no stored review names them: re-fetching ~465 guests a night against Guesty's ~120 calls a
minute was 190s of a 237s run. After the fix (2026-10-23): nightly 43s, Revenue refresh 11-12s.

Two clients exist: `src/lib/guesty.ts` (9 importers, 2026-10-22) and `src/lib/guesty-client.ts`
(4). They share the token cache and differ in one way that matters: `guesty-client.ts` throws a
typed `GuestyNotFound` on 404, `guesty.ts` throws a generic error.

Watch-outs: the reservations feed drops non-confirmed rows, so a reconciler catches cancels the
feed silently omits. A missing "Business model" setting on a Guesty listing means no OWNER NET,
which is the first thing to check when statement reservations vanish.

Guesty `closed` retires a reservation RECORD, not the stay. After checkout it is a real stay; beside
a confirmed record it is a superseded one (an altered Airbnb code, or a Booking.com "Guest to be
announced" placeholder replaced by the named record). Only closed BEFORE arrival is a cancellation:
`src/lib/guesty-legacy-status.ts` maps it so for the `bookings` backfill, and the dedupe never lets
an unnamed record's cancel hide a named twin (`isUnnamedRecord` in `src/lib/booking-dedupe.ts`).

## Quo (OpenPhone)

Rebranded OpenPhone. Cross-cutting: cleaning completion pings, CRM contact timeline, owner
last-contacted stamping, and outbound SMS.

**Three lines, three audiences** (Dotti, 2026-09-08). `QUO_LINES` in `src/lib/quo-lines.ts` is the
registry; `quoFromNumber(<audience>)` is the only way to pick a sending number. There is no
"first number Quo lists" fallback any more: that fallback put contractor texts on the GUESTS line
the afternoon it was created.

| Line | Number | Quo id | Who |
|---|---|---|---|
| GUESTS | (978) 865-2575 | `PNTSICOAAA` | anyone staying with us: Stay Cape Ann, OTA guests, add-on links |
| RISING TIDE 24/7 | (978) 865-2500 | `PNq253fFrk` | the back office: cleaners, contractors, vendors, staff, internal pings |
| OWNERS | (978) 865-2387 | `PNpVESxsNW` | homeowners and prospects |

If it came in on the GUESTS line it is a guest. Helm texts the back office on 2500 (cleaner
digest, Field texts, the AirDNA nudge, meeting reminders, cleaner automations) and guests on 2575:
payment links (`payment-links.ts`), custom quotes (`sca-quote-email.ts`), and on helm-run homes the
message automations (`automations.ts`) and inbox replies (`helm-inbox.ts`,
`/api/pms/threads/[id]/messages`). Owner texts and the concierge's guest replies go out from
stay-concierge, which carries the same split (`QUO_GUEST_PHONE_NUMBER_ID`,
`QUO_OPS_PHONE_NUMBER_ID`, default id = OWNERS). The webhook ingest stamps
`quo_unknown_numbers.quo_line` from the event's `phoneNumberId`, and the New numbers card on the
Messaging inbox (`src/components/messaging/NumberTriage.tsx`) badges it. Every Quo webhook has
its own signing key: the app-made original is `QUO_WEBHOOK_SECRET`, API-made ones ride in
`QUO_WEBHOOK_SECRETS` (comma list); any may sign.

- **A trade vendor's text** (`trade_vendors.phone` / `after_hours_phone`, any line) also files a
  vendor visit proposal when it names a day, beside the paths below and short-circuiting none.
- **Live path**: `POST /api/webhooks/quo` verifies the `openphone-signature` HMAC
  (`hmac;1;<timestamp>;<base64-digest>`, signed payload `<timestamp>.<JSON.stringify(body)>`, secret
  base64-decoded), persists into `quo_events` (unique on `quo_event_id`, so replays 200), and
  dispatches per event type.
- **A number Helm can already name is never a new number** (`src/lib/known-numbers.ts`, since
  2026-10-19). One resolver reads every place a phone lives: contacts, the owners registry, a Quo
  address-book name that strictly matches an owner household (given name and surname, one
  candidate), the Field roster, trade vendors, prospects. The webhook files a household's text onto
  it (fill-empty phone), capture skips the Field roster and trade vendors, the address-book route
  sweeps the queue after its pass (`known-numbers-sweep.ts`), and the New numbers card names what
  is left. Add a phone-bearing table to the directory there, never a second lookup.
- **Subscribe to** `message.received`, `message.delivered`, and `call.completed` as the minimum.
  `call.completed` is what creates the call touch; `call.summary.completed`,
  `call.transcript.completed` and `call.recording.completed` only enrich an existing touch and are
  useless on their own.
- **Quo also sends.** `sendMessage` backs the cleaner schedule digest, guest SMS, and proactive
  reminders.
- `/api/sync-quo` is the backfill and gap-fill path. It is still its own implementation of the
  per-message work, not the webhook's dispatcher, but since #1627-#1636 it calls the webhook's
  pieces: the one checkout resolver (`mostRecentCheckout`), cleaner-issue work slips, forward-only
  owner stamping, unknown-number capture (`quo-ingest.ts`) and the cleaning-session mirror
  (`cleaning-sessions.ts`). Changing either path still means reading both.
- API traps: `maxResults` caps at 50 on every list endpoint, and `participants=` must be repeated
  keys, not a bracketed array. Both return 400 otherwise.
- `cleaner_phones.property_ids = '{}'` means "serves all properties" and falls back to body matching.
- A 402 from Quo means the prepaid balance is exhausted. It is billing, not code.

## Seam (smart locks and devices)

**Seam is Helm's smart-device platform, not just a battery feed.** It does three things:
1. battery telemetry into `lock_battery_status`, plus an auto work slip at or below 20%
2. `lock.unlocked` / `lock.locked` dispatched into `cleaning_sessions` (cleaner entry via the
   cleaner code), `inspection_sessions`, Field packet arrival verification, and the guest-in-
   residence indicator
3. access-code programming: time-boxed guest PINs, rotating contractor PINs, a fleet-wide
   maintenance PIN

**Subscribe to** `device.low_battery`, `device.battery_status_changed`, `device.connected`,
`device.converted_to_managed`, **`lock.unlocked` and `lock.locked`**. Without the lock events the
cleaning lifecycle, inspection detection, Field arrival verification and guest-presence all go dark
while the battery pipeline keeps working, which makes the failure hard to spot.

PIN digits are never stored. `lock_access_codes` holds the Seam `access_code_id`, a human name and
a derived role. Seam writes are asynchronous: a POST returns an action attempt that must be polled;
a 200 does not mean the physical lock applied the change.

**Four fleet-wide PINs.** Only the master inspection code is a secret; the rest are deliberate
operator-known constants that ride in briefs and work orders. Each is env-overridable and each
refuses to program itself if it would collide with another, because a shared PIN makes keypad
unlock attribution ambiguous.

| PIN | Default | Who | Module |
|---|---|---|---|
| Cleaner | 2222 | housekeeping | `cleaning-sessions.ts` |
| Master / inspection | env only | Rising Tide | `inspection-sessions.ts` |
| Maintenance | 3333 | vendors, handymen | `maintenance-code.ts` |
| Creative | 5555 | photo + video contributors | `creative-code.ts` |

The bottom two **converge**: `/api/cron/sync-seam` nightly, and the property page's **Sync Seam
devices** button on demand. Both run the same `ensure*Code` pass, so a lock connected this morning
does not have to wait for 2 AM.

`ensureCreativeCode` stamps `lock_devices.creative_access_code_id` once Seam confirms the PIN on the
device, mirroring `cleaner_access_code_id`. **That stamp, not "this home has a lock", is what the
shoot brief reads before printing 5555**. An unstamped lock falls through to the home's own code,
so a contributor is never sent to a door the PIN has not reached. `resolveEntry` in
`creative-brief.ts` is the single place that picks: creative code, then the listing's own code, then
the lockbox, then the office.

Device-to-property mapping is manual: run `/api/sync-seam` once so devices register, then set
`lock_devices.property_id`.

## stay-concierge

The guest AI lives in a separate repo (`~/Developer/stay-concierge`, Python, port 8000 locally). It
reaches Helm through the bridge routes (the `PUBLIC_API_PREFIXES` entries in `src/proxy.ts` whose
handlers call `authorizeStayConcierge`, plus the three inline checks named under Auth), always with
the `x-stay-concierge-key` header. `/api/kb-facts` is the only Helm-to-guest-AI knowledge pipe.

# Environment variables

Set in Vercel. `.env.local.example` documents a fraction of what the code reads (about 73 names,
counted 2026-10-22).

- **Core**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Auth**: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`
- **Cron**: `CRON_SECRET`. All 34 cron routes fail closed without it (verified 2026-10-22: every
  one calls `authorizeCron`).
- **Guesty**: `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`
- **Stripe**: `STRIPE_KEYS_JSON`, `STRIPE_KEYS_JSON_EXTRA`, `STRIPE_KEY_<PROPERTY_ID>`
- **Gmail**: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (bare = Allie's
  mailbox), plus `_DOTTI` / `_RYAN` / `_ALLIE` variants for identity-specific sends. These are
  **not** the SSO credentials. Work orders and owner emails draft in the signed-in person's own
  mailbox: `sessionMailbox()` in `gmail-draft.ts` picks the token whose Gmail profile address is
  the session's, and with none the surface offers Copy instead of Create (`lib/copy-email.ts`).
  Production holds the bare token and `_DOTTI` only (checked 2026-10-18), so Ryan and staff copy
  until a token is minted for them.
- **Email out**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_AUDIENCE_ID`, `RESEND_WEBHOOK_SECRET`
- **Quo**: `QUO_API_KEY`, `QUO_WEBHOOK_SECRET`, `QUO_WEBHOOK_SECRETS`, `QUO_FROM_NUMBER` (24/7 line
  override), `QUO_GUEST_FROM_NUMBER`, `QUO_OWNER_FROM_NUMBER`
- **Seam**: `SEAM_API_KEY`, `SEAM_WEBHOOK_SECRET`, `SEAM_CLEANER_CODE`, `SEAM_INSPECTION_CODE`,
  `SEAM_MAINTENANCE_CODE`, `SEAM_CREATIVE_CODE`
- **Bridge**: `STAY_CONCIERGE_KEY`, `STAY_CONCIERGE_URL`
- **Maps**: `NEXT_PUBLIC_CARTO_API_KEY`, optional. CARTO basemap tiles need a key since September
  2026 or they render watermarked. `src/lib/map-tiles.ts` carries Rising Tide's key (public by
  nature, shared with staycapeann.com) as the fallback, so the var only matters for an override.
- **W-9 encryption**: `FIELD_W9_KEY` is the key for contractors' stored TINs
  (`src/lib/field-crypto.ts`). **When it is unset the key is derived from
  `SUPABASE_SERVICE_ROLE_KEY`, so rotating the service-role key makes every stored TIN
  unreadable.** Setting `FIELD_W9_KEY` for the first time does the same to TINs already stored.
  Whichever secret encrypted them must stay until they are re-encrypted.
- **Other signing secrets**: `HELM_INQUIRY_WEBHOOK_SECRET` (`/api/webhooks/inquiry`, 503 when
  unset), `STORY_FACTORY_SECRET` (`/api/notify-dotti`, `/api/review-stories/*`, fail closed),
  `AUDIENCE_UNSUBSCRIBE_SECRET` (marketing unsubscribe links; falls back to `AUTH_SECRET`, so
  rotating `AUTH_SECRET` while it is unset breaks every unsubscribe link already mailed)
- **Texts and codes**: `DOTTI_PHONE` (the AirDNA nudge; meeting reminders when
  `MEETING_REMINDER_PHONES`, a comma list, is unset), `VENDOR_DISPATCH_PHONE` (A-1's Jobber relay,
  defaulted), `SUPPLY_CLOSET_CODE` (prints on a claimed packet; unset hides the line; never in
  source)
- **Email routing**, all defaulted: `STAFF_NOTIFY_EMAILS` (agreement, contract and quote notices),
  `AUTOMATIONS_REPLY_TO`, `FIELD_FROM_EMAIL`, `READINESS_FROM_EMAIL`, `READINESS_REVIEW_TO`,
  `READINESS_REVIEW_CC`
- **Origins in links**, all defaulted: `SCA_PUBLIC_ORIGIN` (quote links), `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_HELM_URL`, `NEXT_PUBLIC_HELM_ORIGIN`, `NEXT_PUBLIC_SITE_URL`
- **Other**: `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`,
  `DRIVE_HELM_RECORDS_FOLDER_ID` (with the service account, turns on the Drive archive),
  `VERCEL_API_TOKEN` (Speed Insights on `/marketing`), `CLEANING_AUTO_CONFIRM_MINUTES` (default
  45), `AIRBNB_REQUEST_ALERTS_ENABLED` (its sender has no caller since #1917),
  `CHROME_EXECUTABLE_PATH` (local PDF), `VERCEL_PROTECTION_BYPASS`

Locally, `.env.local` ships several secrets empty (service-role, `GITHUB_TOKEN`). Field pages and
anything service-role will 500 or silently degrade in local dev. That is expected.

# Testing

**`npm test` is the suite. Run it.** Node's own test runner over `src/**/__tests__/*.test.ts`,
native TypeScript, no bundler and no network. It is fast (about 7 seconds for about 3,150 tests,
2026-10-22) and currently green. CI runs it with `TZ=America/New_York`, because the civic date
fixtures assume Massachusetts midnight. This file used to say there was no test runner; that was
true once and stopped being true, and an agent believing it duplicated an existing test into
`scripts/`. **Put a new pure-logic test in `src/lib/__tests__/`, not in `scripts/`**, or it only
runs when somebody remembers it exists.

A test here is not only for arithmetic. Several guard an invariant that is spread thin across
files and easy to delete by accident, by reading the source and asserting the guard is still
there: `shoot-offer-optin.test.ts` is the clearest example (an offered shoot must never be
treated as work). When you add one of those, break the guard once and watch the test fail before
you trust it.

Imports inside a test need the explicit `.ts` extension or Node cannot resolve them.

`npm test` also runs `tests/reliability.test.mjs` (imported by
`src/lib/__tests__/helm-reliability.test.ts`). It renders real pages and components with every
import mocked by hand, so adding an import to one of them fails `npm test` with
`Unmocked import: <id>` until you add a mock there.

The smoke fixtures, `scripts/*-smoke.mjs` (29; CI runs 23 of them in
`.github/workflows/property-documents.yml` on every PR touching `src/`), bundle real components
with webpack against a hand-written alias map. A new import in a component one of them bundles
fails CI until it is registered in that script's map.

Also present, and NOT part of `npm test`:

- `scripts/*_parity.py`: read-only harnesses that prove a specific past change did not move any
  owner payout. They need a service-role key and are one-shot audits, not regression guards.
- `scripts/single_write_path_parity.sql`: read-only. Re-derives every statement's money columns
  from its rows with the rules in `statement-totals.ts` and compares them to what is stored. Run
  it before and after any change to the formula or the write path. It reads live statements, so
  it needs the user's go-ahead (`AGENTS.md`).
- `scripts/addon_recompute_parity.mjs`: pure arithmetic, no database. Proves the add-on recompute
  sites agree with the canonical formula and that zero-attribution statements are unchanged.
- `scripts/paged_select_check.mjs`: exercises `selectAllPaged` page boundaries via Node's native
  TypeScript stripping.

For code changes, the gate before shipping is `npx tsc --noEmit` **and `npm test`**.
Run both before committing. Documentation-only validation and deployment authorization
are defined in `AGENTS.md`.

# Known watch-outs

1. **PostgREST caps a bare `.select()` at 1000 rows, silently.** This has caused two data-integrity
   bugs. Use `selectAllPaged` from `src/lib/paged-select.ts` for any table that can grow, and
   always pair `.range()` with an `.order()` or the offset windows are unstable.
2. **`property_statements` has no `month` column.** The month is reachable only through
   `period_id -> statement_periods.month`. Writing `prop.month` evaluates to `undefined` and matches
   zero rows. This exact mistake already shipped a production bug.
3. **`reservations` has no `rental_income` column.** The column is `guesty_rental_income`.
   `rental_income` is the in-memory name inside `/api/ingest` before the write.
4. **Deploy skew.** A tab on an old bundle cannot apply a new build's RSC payload. The tell is a
   DB write landing while the button spins forever. Platform Skew Protection has been on since
   2026-08-26 (12h), so a stale tab is routed back to its original deployment instead of breaking;
   past the 12 hours, Next's `deploymentId` check hard-reloads the tab on its next navigation,
   refresh or action. VersionGuard, `/api/version` and `lib/version-skew.ts` were retired on
   2026-10-22. The Button/SubmitButton watchdog's 30s reload stays (it covers a shed response,
   not skew), and AutoRefresh skips its tick while a page holds unsaved work. See `next.config.ts`.
5. **Agent sessions run in git worktrees** under `.claude/worktrees/<branch>`, which start with no
   `node_modules`. Run `npm ci --no-audit --no-fund` in the worktree (about 11 seconds). Do not
   symlink the parent checkout's: it is stale (it lacked `@vercel/analytics` on 2026-10-22), so
   `tsc` fails on errors that are not yours.
6. **This is a high-concurrency multi-agent repo.** Branch off fresh `origin/main` and stage only
   your own files.
7. **`bookings` holds duplicate rows per stay by design** (one per source). Never key per-stay logic
   on `bookings.id`; filter `duplicate_of is null` for canonical rows.
8. The legacy `/api/statement` route was deleted long ago. All statement rendering goes through
   `/statements/render`.
9. **Writing an EVENT's timestamp needs a forward-only guard; writing `now` does not.** A column
   holding when something *happened* (a message's `createdAt`, a cleaner's finish) can be written
   out of order: the feed delivers late, an operator promotes an unknown number and the events
   replay, or a six-hourly backfill walks history. A blind `update`/`upsert` then moves the
   column BACKWARDS, and nothing fails. This produced four bugs in one corner of the Quo ingest
   (#1627, #1634, #1635, #1636): the checkout resolver needed an `as-of`, owner last-contacted
   and the unknown-number capture needed forward-only guards, and the cleaning finish needed
   both plus a provenance rule (estimate < quo < manual, so a backfill never overwrites an
   operator's own confirm).

   The guard belongs in the WRITER, not the callers, as an `or` filter on the update's where
   clause: `.or('col.is.null,col.lt.<value>')`. A losing write then matches no rows instead of
   depending on three call sites remembering. Seed the row first with
   `upsert(..., { ignoreDuplicates: true })` when it may not exist.

   A `now`-based stamp (`last_seen_at`, `gmail_synced_at`, a sync run's `cancelled_at`) is
   monotonic by construction and needs none of this. Audited 2026-09-26: every other timestamp
   write in the cron and sync paths is `now`-based, so the Quo ingest was the only place the
   hazard lived.
10. **A new table grants itself, in the same migration.** From 2026-10-30 Supabase stops
    granting Data API access to new `public` tables on this project (final notice, 2026-10-20);
    existing tables keep theirs. A table without a grant answers every service-role read and
    write with "permission denied". So every `create table` migration also enables RLS and runs
    `grant all on public.<table> to service_role` (a narrower set that includes `select` is a
    choice the migration may make), as `20261018200000_vendor_visit_proposals.sql` does.
    anon and authenticated get nothing unless a `-- client grant <table>: <reason>` comment in
    the migration says why. `migration-grants.test.ts` holds this for every migration dated
    2026-10-23 or later, a week early because migrations here are applied by hand, often days
    after they are written.

# Style

- **No em dashes, ever.** Use regular dashes or rephrase.
- Direct and concise.
- The statement design is editorial and premium, like a magazine layout. Not corporate.
- Let the design breathe. More whitespace beats cramped.
- **Three shared controls; use them when you touch a page, never sweep working pages onto them**
  (Phase 4 of the 2026-10-17 audit):
  - **Button** (`src/components/Button.tsx`): `primary` (the one dark verb a block is for),
    `secondary`, `quiet` (a text exit), `danger`; sizes `sm` (a dense row's verb), `md`, `lg`.
    `pending` shows the label with three dots and runs SubmitButton's watchdog
    (`src/lib/use-pending-watchdog.ts`); pass `watchdog={false}` when waiting is the job (an AI
    call, a planner). A server page puts the same face on a SubmitButton or a link with
    `buttonClass()` from `src/lib/button-class.ts`.
  - **ConfirmDialog** (`src/components/ConfirmDialog.tsx`, mounted once in `Providers`):
    `useConfirm()` gives `ask`, `choose` (two real answers plus Cancel), `askText` and `notify`;
    `askThenSubmit` for a submit button; SubmitButton's `confirm` prop opens it. Name the button
    for the action, say what it does, `irreversible` only when true, `typeToConfirm` only for an
    action that destroys a lot at once. No new native `confirm()` / `prompt()` / `alert()`:
    `native-dialogs.test.ts` lists the few left and refuses any other.
  - **EmptyState** (`src/components/EmptyState.tsx`): one sentence, at most one verb. Section's
    `emptyMessage` renders through it. An empty state never names a table, a migration or an
    env var (`empty-state.test.ts`); when something is not set up, say "Ask Ryan: ...".
  A smoke fixture that compiles a component using them must register them; the alias list is in
  `scripts/confirm-dialog-smoke.mjs`, the controls fixture.
