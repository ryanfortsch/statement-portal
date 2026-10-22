# Calderwood message handoff rehearsal

Implemented October 13, 2026 in `src/lib/calderwood-rehearsal/message-handoff.ts`.
This pure function reviews synthetic evidence. It does not fetch Guesty records,
change either queue, stop Guesty, persist results, or authorize sending.

## Exact Guesty queue-time handoff — October 22, 2026

The unapplied messaging drafts can now preserve a **reviewed exact source time
for one message** when calendar-day and elapsed-day calculations disagree.
Both guest and cleaner workers share the same candidate calculation and resolution.
An unresolved discrepancy still returns no schedule. The change covers
pre-arrival, pre-checkout and the ten-day cleaner reminder; hourly offsets and
confirmation keep their existing behavior.

For an affected future-unsent entry, the existing owner-only handoff review can
include `source_schedule` with exactly `scheduled_at`, `observed_at` and
`evidence_id`. Times must include an explicit UTC offset; the evidence ID is an
opaque reference to that exact reservation/workflow queue observation. The
observation must follow the reviewed stay timing, precede or equal source stop,
and be no more than five minutes old at submission. The parent review separately
requires fresh stopped/drained/unsent evidence. The canonical `fire_at` must equal
the observed source time and one of the two computed candidates. Ordinary or
hourly schedules cannot use this field to override their time.

`automation_message_schedule_resolutions` retains the selected instant, both
candidates and its context/timing provenance, with no body or recipient details.
Registration, source proof and canonical reservation commit together. A bad
recipient or another failed workflow rolls back the proof as well. Exact retries
retain one record. Holds and disabled route/batch switches remain unchanged.
Later changes to dates, timezone, template/context or the source timing observation
invalidate the proof at the actual worker snapshot. These immutable migration
reviews cannot silently authorize a changed schedule: reconciliation is required.
A new observation invalidates the proof even if its clock values are unchanged;
continuous ingestion must account for that before activation.

Validation: **2,232 application tests / 242 suites**, nonincremental TypeScript,
scoped ESLint and **128 disposable PostgreSQL scenarios** pass (44 guest,
26 cleaner, 20 registration, 13 history, 25 exact-time resolution). Added coverage
includes both candidate choices across spring/fall for all three day workflows,
missing or invented evidence, full rollback, repeat submissions, role denial and
invalidation after changes. All fixtures/provider calls are synthetic.

This implements the handoff capability; it does **not** import the earlier live
queue observations as fresh proof, establish a universal Guesty DST policy, prove
cleaner receipts or activate delivery. All six messaging SQL drafts remain
unapplied. The next acceptance is the combined hosted messaging rehearsal once
its canonical fixture prerequisites are ready, followed by authorized delivery
acceptance and current source reconciliation. Production account/cost and
PriceLabs parity remain separate requirements.

Handoff: `codex/channex-staging-pilot`, base `a148b0e6`, main checked
`0e9ada07c5fa670a1e83079a1f46a4803937aa07`. Scope: three draft SQL files,
four local harness files and existing schema/architecture/handoff documentation.
Unrelated dirty contract-readiness notes remain excluded.

## Live source acceptance and executable timing correction — October 22, 2026

Protected preview `029b99c2` read the complete October 22, 2026–October 22,
2027 exclusive window: **5 confirmed stays, 25 conversation records**, five local
clock observations and five actual confirmation timestamps. No shared/missing
threads were returned. The earlier generic full-window failure did not recur;
its cause remains unknown. Safe error categories now distinguish bounded source
validation failures from validated HTTP status without exposing raw responses.

Guesty's Scheduled/History UI was reviewed for all five source threads. Across
the four recurring guest workflows it shows **14 scheduled/enabled messages and
6 Completed entries**, with no disabled master or row switch and no failure state
observed. These are aggregate observations only; no customer record is saved here.
Completed is Guesty's displayed state, not independent delivery proof. Neither
pending work nor source ownership was changed; this is not stop/drain evidence.

The cleaner workflow Activity Log shows template creation/edit history, not
per-reservation SMS receipts. [Guesty's current documentation](https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members)
explicitly says user/contact/cleaner automated messages do not appear in the
Inbox. A blank guest history cannot establish cleaner completion. Cleaner
obligations remain unverified; no generic conversation record was imported as
an automation receipt and no manual-send fallback was introduced.

The prior DST review correctly withheld disputed times, but the executable draft
SQL still chose calendar-day times. Both guest and cleaner scheduling now return
no schedule when calendar-day and elapsed-day results differ, or when the anchor
or target wall clock is nonexistent/ambiguous. This supersedes earlier statements
that calendar-day offsets preserve Guesty timing through every DST boundary.
It does not establish a universal source timing policy or resolve the existing
source discrepancy. One-hour key-code and seven-hour cleaner offsets preserve
3 PM and 9 AM for the normal 4 PM arrival in both seasons.

Validation: **2,232 application tests / 242 suites**, nonincremental TypeScript,
scoped ESLint and **103 disposable PostgreSQL scenarios** (44 guest, 26 cleaner,
20 registration, 13 history). New cases exercise spring/fall mismatches, invalid
anchors, unchanged hourly offsets and zero provider POSTs for disputed schedules.
All provider calls were synthetic. The first new guest assertion expected the
blocked counter; the implementation returns needs-attention when rendering a
missing time, and the corrected test verifies that result plus zero acceptance
and zero POSTs. No production behavior was altered to satisfy the test.

Handoff: `codex/channex-staging-pilot`, base `a148b0e6`, main reference
`0e9ada07c5fa670a1e83079a1f46a4803937aa07`. Changed SQL is still unapplied; no
schema/recipient/queue activation or subscription occurred. The two scheduler
files, two local acceptance harnesses and current architecture/handoff notes are
the scope. Existing dirty contract-readiness notes remain excluded.

## Atomic source-history handoff — October 22, 2026

Implemented `message-history-handoff.sql`, an **unapplied draft**, after the five
registration prerequisites below. This closes the canonical import gap for
messages Guesty already sent. It does not fetch or stop Guesty's queue and does
not enable either sender. No hosted database, customer record or paid service
was changed in this batch.

`automation_message_handoff_stay(booking_id, canonical_revision, entries)` accepts
exactly six distinct `{send_id, review}` entries: confirmation, pre-arrival,
key code, pre-checkout, cleaner advance and cleaner arrival. All entries must
belong to the same current canonical stay and its verified timing observation.
A `sent=false` review uses the existing future-unsent registration contract.
A `sent=true` review imports reviewed source history. One invalid entry rolls
back the entire call, including earlier receipts and job registrations. Exact
concurrent/retried submissions retain the same identities. Future holds remain
held; route and cleaner-batch enablement stay separate and off.

The sent-history review contains `review_id`, `context_revision`,
`observation_revision`, `workflow`, exact booleans `complete=true`, `sent=true`,
`queued=false`, `uncertain=false`, `evidence_id`, `observed_at`,
`source_account_id`, `source_reservation_id`, `recipient_refs`, and `messages`.
Each message contains only `id`, `recipient_ref` and an offset-qualified `sent_at`.
Guest history has one `guest` recipient. Cleaner history requires a distinct
source message for every reviewed recipient reference; a partial fan-out cannot
settle the whole cleaner reminder. References are opaque identifiers, not message
bodies, addresses, phone numbers or credentials. Observation must be fresh at
submission; actual source send times may be historical and cannot be in the future.

The owner-only `automation_message_import_history(send_id, review)` is also
available for individual reviewed imports. Both entry points require an existing
canonical schedule; they do not invent missing schedules or treat a missing
source message as sent. Queued, uncertain, already claimed and conflicting rows
require reconciliation. A Guesty reservation binds to one canonical stay, and a
source account/message ID can appear in only one imported receipt.

Imports settle the existing row as `status='sent'`,
`delivery_used='guesty_history'`, with its actual source send time. Provider IDs
remain null on the canonical row: the separate source receipt table holds Guesty's
IDs, never a fabricated Channex or Quo acceptance. Unsent draft text, target and
missing-field warnings are cleared so they cannot masquerade as source history.
The existing planner recognizes
the settled booking/key even after rule replacement. A database guard prevents
replay/rerouting and serializes concurrent inserts for that booking/key. The
normal automation panel and booking detail label this as imported Guesty history;
the booking detail uses its actual send timestamp.

Validation: **2,217 application tests / 242 suites**, nonincremental TypeScript,
scoped ESLint, and **99 disposable PostgreSQL acceptance scenarios** passed
(42 guest, 24 cleaner, 20 registration, 13 source-history). The new scenarios
exercise the actual SQL plus the real native planner, mixed six-workflow import,
cleaner recipient completeness, source identity reuse, true concurrent imports
and replacement-rule inserts, rollback, holds and role boundaries.

**Remaining integration:** collect authoritative Guesty sent/queued evidence and
continuously ingest verified timing, prepare canonical schedules for all carried
over stays, apply/rehearse the combined drafts in isolated hosted storage, and
perform explicitly scoped real recipient delivery acceptance. These SQL functions
record reviewed evidence; they do not independently establish remote completeness
or delivery. All live Guesty automation remains operating.

## Registration implementation, October 21, 2026 (prior batch)

The next batch adds **reviewed booking/thread, source-history and timing
registration** in `message-handoff-registration.sql`. It is an unapplied draft;
no real records, senders, source queues or accounts were changed. Install order:
`automation-holds.sql`, `channex-message-worker.sql`,
`channex-message-schedule.sql`, `cleaner-message-worker.sql`, then
`message-handoff-registration.sql`. The final file adds a mandatory provenance
gate to the shared renderer. Earlier rehearsal jobs without verified observations
will consequently block until reviewed; installation does not invent provenance.

The owner-only entry points are:

1. `automation_message_stay_revision(booking_id)` obtains the current canonical
   identity/date/status digest. `automation_message_observe_times(booking_id,
   canonical_revision, expected_revision, observation)` checks that exact digest
   under the booking lock. The observation contains `check_in`, `check_out`,
   explicit nullable `arrival_time`, `departure_time`, `confirmed_at`, and
   `observed_at`, `source_revision`, `evidence_id`. Clock values are HH:MM[:00];
   timestamps require an offset. Missing overrides are rejected rather than
   treated as verified absence. Confirmation remains the actual source event.
2. `automation_message_bind_thread(booking_id, binding)` binds an explicitly
   verified Channex booking/thread to the current route generation and canonical
   revision. The binding contains `canonical_revision`, `route_generation`,
   `channex_booking_id`, `thread_id`, `verified_at`, `evidence_id`. A provider
   booking or thread cannot belong to two canonical stays. No fuzzy matching or
   silent remapping occurs. The transport independently rechecks the live thread
   relationship before its final claim.
3. `automation_message_register_handoff(send_id, review)` reserves an existing
   future canonical schedule, preserving scheduled/held status. The review contains
   a UUID `review_id`, current `context_revision` and `observation_revision`, exact
   booleans `complete=true`, `sent=false`, `queued=false`, `uncertain=false`, plus
   `evidence_id`, `observed_at`, `stopped_at`, `drained_at`, `expires_at`, `workflow`.
   Cleaner reviews also specify `from_number` and `recipient_phones`. All six
   supported workflows must match the existing rule and verified schedule. Guest
   source-stop/drain must also match the route. Cleaner batches start disabled.
   Exact retries retain existing identities; conflicting reviews are rejected.

New observations, thread checks and queue reviews must be at most five minutes
old when submitted. This is an ingestion review policy, not a claim of ongoing
provider freshness. Observation updates use compare-and-swap, retain immutable
provenance for earlier revisions, and invalidate stale concurrent writes. Canonical
identity/status/date changes invalidate observations even when later reversed.
Direct edits to raw timing also fail provenance checks. Both guest and cleaner
renders fail closed until a fresh matching observation is recorded.

Registration writes the reserved job and source audit together; failed validation
rolls both back. Multiple workflow calls can share one transaction. Guest body
hashes initially cannot dispatch: the worker must render and refresh the hash from
current authoritative inputs. The worker and browser roles cannot register,
rebind, write timing or activate anything. A reviewed database-owner ingestion
step is still required; no public endpoint or recurring source fetcher is added.

**SQL records a reviewer's verified evidence; it cannot independently prove that
Guesty's remote queue is complete or stopped.** Real canonical booking/queue
preparation, current source-history collection, ongoing provider-event ingestion,
source expiry decisions and actual channel delivery remain launch work. Already
sent or queued messages are rejected from this new-job path; they still need
source-history reconciliation, not conversion into fresh unsent jobs.

Current validation: **2,202 application tests / 240 suites**, TypeScript and scoped
ESLint passed. **86 disposable PostgreSQL scenarios** (42 guest, 24 cleaner, 20
handoff) passed using Helm's channel/status enum types. The handoff cases cover
source revisions, concurrent observations, stale/reversed dates, identity reuse,
sent/queued/uncertain history, all six held schedules, atomic rollback, role
boundaries, and the real scheduled worker/transport reaching one synthetic POST
and receipt after separate activation. No actual recipient delivery is implied.

## Cleaner execution batch

The subsequent cleaner batch connects **per-recipient Quo execution and receipt
reconciliation** to that same authenticated cron. Install the additional
`cleaner-message-worker.sql` only after the three prerequisites below. It remains
an **unapplied draft** and the runtime is **disabled and undeployed**. No texts,
provider purchases, source shutdown or live configuration changes were made.

Each reviewed future-unsent cleaner schedule row owns an immutable recipient
list, sender, source stop/drain/evidence reference, workflow and expiry. Registration
creates one durable child job per phone and reserves `delivery_used='quo_cleaner'`.
The existing native sender, planner retiming, stale-send cleanup and manual approval
path exclude this rail; a database trigger also prevents fallback. Other properties
keep their existing behavior. The worker cannot register jobs or enable batches.

The reminder workflows retain **10 calendar days before verified ETA** and **7
hours before ETA**. They use the same verified stay-time observations and renderer
as guest messages. Refresh preserves holds/expiry and refuses catch-up or schedule
changes after any recipient has been attempted. Final claim rechecks current source,
property ownership, effective automatic cleaner rule, workflow binding, exclusions,
recipient enablement and property/region assignment, exact target, context and time.
Changing a cleaner's phone cannot redirect a registered job. New recipients require
a separately reviewed handoff; no automatic recipient expansion occurs.

A successful claim permits one private SMS to one recipient. Each child retains its
own provider ID; the parent deliberately stores no arbitrary first-recipient ID.
Partial rejection or timeout cannot resend successful recipients. Unknown outcomes
remain unresolved, with no automatic resend or manual-message fallback. Lost save
acknowledgements retry only the database receipt write. A cancelled parent remains
cancelled even when an already attempted message later returns a receipt.

Receipts use authenticated **GET /v1/messages/{id}**, matching the exact ID, sender,
single recipient, direction and content digest. `queued`/`sent` remain unconfirmed;
`delivered` and `undelivered` are separate terminal receipt states. Undelivered
results flag the existing schedule row and cron sync status. The existing webhook
handler is unchanged: readback recovers independently of webhook ordering or a
receipt arriving before the POST acknowledgement. Reconciliation continues for
accepted jobs when their batch is disabled, while the runtime flag remains on.
No clear body is persisted in these new tables or returned in cron diagnostics.

Runtime contract: `CLEANER_MESSAGES_ENABLED=true`, one canonical
`CLEANER_MESSAGES_PROPERTY_ID`, and the **existing** `QUO_API_KEY`. The batch also
requires its separate database enablement. Sending always uses `quoFromNumber('ops')`;
no first-number discovery or guest-line fallback. Ten recipients maximum per
batch, ten candidate jobs per tick, a 90-second loop budget and 20-second HTTP
timeouts bound work. Matching future work stays out of the due scan; candidates
rotate fairly. `?dry=1` loads IDs/counts only and performs no sends or writes.
The existing 15-minute cron cadence is preserved.

Validation of the combined branch: **2,202 tests / 240 suites**, nonincremental
TypeScript and scoped ESLint. **66 actual disposable PostgreSQL scenarios**
(42 guest + 24 cleaner) exercise the actual SQL and scheduled workers with synthetic
HTTP only. Cleaner cases include multiple recipients, two competing workers,
partial rejection, lost claim/save acknowledgements, database restart, holds,
changed templates/times/phones, missing source observations, property scoping,
role boundaries, monotonic receipts and cancellation. No hosted or customer
message-delivery acceptance is implied.

Official Quo references checked October 21:
[send contract](https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message),
[message lookup](https://www.quo.com/docs/mdx/api-reference/messages/get-a-message-by-id),
and the [OpenAPI schema](https://openphone-public-api-prod.s3.us-west-2.amazonaws.com/public/openphone-public-api-v1-prod.json).
The new transport uses the documented `api.quo.com` origin; the existing general
`quo.ts` client and webhook signature behavior were not changed. Quo's
[API overview](https://www.quo.com/api) says outgoing API texts use paid segments:
reusing the account adds no new subscription here, but activation requires the
existing cost review and an explicit actual-recipient delivery test.


The automatic guest-message path now connects the existing authenticated
`/api/cron/automations` job to authoritative SQL snapshots, the existing message
renderer, schedule refresh, the durable worker and the Channex transport.
`scheduled.ts` processes one explicitly configured property/environment, up to
ten candidates per tick with a bounded processing budget. No additional cron or
server is introduced. It remains **disabled and undeployed**; both messaging SQL
files are **unapplied drafts**. No live messages or charges occurred.

The draft extends canonical `automation_sends`. Registering an existing future
unsent row binds its booking/key to a permanent attempt identity, exact provider
route/booking/thread, source stop/drain evidence and expiry. Registration still
requires a reviewed external history/queue manifest; this worker cannot invent
that evidence, register a job, change a route or enable sending.

`channex-message-schedule.sql` adds provider-normalized timing observations,
bound to the canonical booking dates. A null ETA/ETD means the source was checked
and has no override. A missing observation is unresolved. Confirmation uses the
actual confirmation event, never first-seen/import time. The four guest workflows
preserve confirmation +30 minutes, pre-arrival one calendar day before ETA, code
60 minutes before ETA, and pre-checkout one calendar day before ETD. Listing
fallbacks use rate-plan check-in and `properties.default_checkout_time`, matching
current main. Checkout adjustments take precedence. Nonexistent/ambiguous local
DST times block for source resolution. Cleaner execution is covered by the subsequent batch above.

A single database statement returns the current timing, template and minimum
render inputs with a context digest. Clear access values exist only in server
memory; no clear body is written to the schedule or job. A compare-and-swap
refresh updates only unattempted scheduled/held jobs, preserving holds and their
source expiry. Due work can refresh content, but a changed schedule moving into
the past cannot silently become catch-up. Moves beyond the original expiry need
reviewed replacement evidence; refresh never extends it. Cancelled and attempted
jobs cannot be revived. The native planner no longer retimes reserved jobs.

Immediately before one POST, the durable claim rechecks the current schedule,
hold, booking, effective rule, minimum stay, workflow binding, rendered-context
digest, route generation, Helm ownership and source handoff. Changes after the
snapshot invalidate the render. A hold/cancellation committed before claim wins;
after claim it cannot recall an in-flight request. The existing native sender and
approval path exclude this rail, and SQL prevents manual rerouting.

Attempt identity survives restart. Provider timeout, ambiguous response or lost
acknowledgement cannot trigger another POST. The scheduled caller can retry the
idempotent database receipt save only. Accepted receipts reconcile by exact
provider-ID/history GET; `recorded` is not proof of guest delivery. Unknown sends
without a provider ID remain unresolved. A scan timestamp rotates blocked work
and unconfirmed receipts so they cannot starve other messages. Cron returns only
counts and fixed error text, with attention counts in the existing sync status.

Deployment contract (not activated): install `automation-holds.sql`,
`channex-message-worker.sql`, then `channex-message-schedule.sql` before any job
registration. The message schemas are an initial draft installation, not an upgrade script
for populated message tables. Set server-only `CHANNEX_MESSAGES_ENABLED=true`,
`CHANNEX_MESSAGES_PROPERTY_ID` (canonical Helm ID),
`CHANNEX_MESSAGES_ENVIRONMENT` (`staging` or `production`) and
`CHANNEX_MESSAGES_API_KEY` only after account, cost and handoff acceptance. The
route must also be enabled independently. Absent the exact enable flag, the cron
performs no Channex database/provider work. `?dry=1` only counts candidates; it
loads no access snapshot and writes/sends nothing. The existing 15-minute cadence
is a dispatch opportunity, not a guarantee of instantaneous delivery.

Validation: 11 new scheduling tests; full suite **2,190 tests / 240 suites**;
nonincremental TypeScript and scoped ESLint. The actual SQL, scheduled adapter,
worker and transport passed **42 disposable local PostgreSQL scenarios**, using
synthetic provider responses only. These include concurrent workers, restart,
lost-save recovery, holds, moved ETA, checkout precedence, DST, source/template
races, no catch-up, fair scans and role boundaries. Initial checks caught SQL CASE
syntax and a timestamp-display test mismatch; both were corrected before the
final passing run. No hosted delivery or migration acceptance is claimed.

Remaining delivery work:

1. Prepare actual canonical booking/queue rows and verified source evidence for
   the owner-only registration entry points above. Connect ongoing provider
   events to the timing writer; do not reuse the fictional importer as production.
   Reconcile prior sent/queued work and confirm source expiry and real DST queue
   parity before importing future unsent work. The registration code is complete;
   the real operational handoff has not occurred.
2. Register the verified cleaner handoff and recipient bindings, review the exact
   templates/portal links, then prove actual Quo delivery. The per-recipient
   scheduled execution and receipt path is implemented above but not activated.
3. Review/apply the schema and scoped runtime configuration after production
   account/cost checks. PriceLabs source capture is complete (541 daily values),
   but PriceLabs-to-Channex parity and production access remain unverified.
4. Run an explicitly authorized actual-channel delivery/restart check, then
   activate at the contract-timed cutover. Manual messages are not a substitute.

Branch `codex/channex-staging-pilot`; original base
`a148b0e6d9e9dbc7c6276c79f9000b85788dc0c8`; this batch starts at `21db3063`.
Fetched main `dd85f1c1b61eb28c676fb6a7c542d91777517399`. Unrelated contract edits
are excluded. Main's newer guest-time sourcing is preserved in the new adapter;
existing native guest/cleaner behavior is otherwise unchanged.

## Decisions

- Verified sent history: suppress replay.
- Guesty still has a queued message: retain Guesty ownership; no Helm copy.
- Sent plus queued, uncertain delivery, or a queue remaining after sender stop:
  review the conflict.
- Unsent operator hold: retain hold. A cancelled stay cannot create a message.
- Missing, partial, wrong-reservation, changed-revision, stale or future evidence:
  require review.
- No queued copy is not proof that Guesty cannot still schedule or send one.
- Only a future, unsent message with complete matching evidence collected after
  verified source-sender stop/drain becomes an activation-review candidate.
- Due or overdue messages never become automatic catch-up candidates.
- Every result carries `canSend: false`, including candidates.

## Evidence contract and remaining integration

The caller must supply a validated, trusted snapshot containing explicit states
for each known message, complete sent history and queue coverage, reservation
identity, and a revision covering dates, times, status and source mapping.
Missing per-message entries remain unknown, even when snapshot completeness is
asserted. The adapter must validate raw input; these TypeScript types are not an
API request validator. No live adapter exists yet.

`senderStoppedAt` means verified cessation/drain of applicable sending, not just
an Airbnb disconnection or an operator's intended stop. The source snapshot must
be collected afterward. Evidence maximum age is an explicit caller policy; the
synthetic tests use five minutes, which is not a promised safe cutover interval.

Production activation still needs verified workflow/source applicability,
recipient/channel mapping, access-code readiness, persistent sent identity,
atomic ownership transfer and worker-side rechecking. A snapshot cannot prevent
a race on its own. In particular, a review candidate is not permission to send.
Guesty guest workflow exclusions remain Website, Manual and Direct - stay cape ann;
cleaner reminders cover all sources. This module does not implement those source
mappings or inventory other applicable workflows.

Next integration step: read the actual sent/queued evidence for a single explicitly
authorized Calderwood reservation, map it without storing bodies/contact details
in source, and compare a review report against Guesty's visible state. Refresh
that evidence at eventual cutover. No Guesty settings were changed for this work.

## Validation

Eight synthetic handoff tests cover the decisions above. Full suite: 1,882 passed.
TypeScript and targeted ESLint must also pass before commit. No UI change or
live delivery test is included in this step.

Continues owned branch `codex/channex-staging-pilot` from `2c715dba`.
Remote main observed before work: `c5f220028cc11deeb8f109fd44e418a6e0ab5ad5`.
This change does not merge the pilot into main.

## First live UI evidence review, October 13

Read-only review of the next Calderwood stay was authorized by the user's reply
following the proposed sent/queued evidence check. No message bodies, guest names,
reservation IDs or contact details are retained here or in fixtures.

The reservation's **Guest auto messages** panel showed one completed confirmation
in History and three enabled scheduled guest messages. Their displayed offsets
matched the rehearsal: check-in instructions one day before arrival at 4 PM,
key code on arrival day at 3 PM, checkout reminder one day before departure at
11 AM. These are observations for the sampled standard-time stay, not proof of
all reservations or delivery across every channel.

The panel also displayed explicit expiry timestamps. Handoff evidence now
preserves a source expiry and refuses a candidate when expiry is missing,
invalid, passed, or no later than the proposed send. Do not infer every workflow's
expiry from this single stay or replace it with a hardcoded window.

Cleaner evidence remains incomplete. The guest panel does not include the two
cleaner SMS workflows. The inbox's Scheduled messages page showed no scheduled
messages despite the three automation rows above, so that page cannot be used as
proof of an empty automation queue. The cleaner workflow Activity Log showed
configuration edits, not reservation delivery records. Neither observation proves
cleaner SMS sent/queued state.

Therefore the combined snapshot is incomplete, Guesty remains the sender, and
all six automated handoff decisions remain review-only. The human review has
verified four guest-message states; the two cleaner-message states are unknown.
No live API adapter, persistent evidence import or sender cutover was performed.
Next: locate reservation-specific third-party SMS sent/queue evidence, then build
the adapter against an authoritative source with completeness and expiry fields.

Validation after expiry protection: 1,884 tests passed, including a synthetic
partial guest-only snapshot that cannot produce a takeover candidate. The test
uses fictional dates and identities, not the customer's reservation. TypeScript,
targeted ESLint and diff checks passed before commit.

## Cleaner evidence and delivery path, October 14

Guesty's official guidance explicitly says automated messages to users, contacts
and cleaners do not display in the Inbox:
https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members
This explains the guest-panel coverage gap. It does not establish sent, delivered
or queued status for either cleaner SMS. Recipient confirmation was requested
from the user; no message was sent to the cleaner. A received-text confirmation
can corroborate a historical send, but cannot prove the future queue or sender
stop. Do not repeatedly inspect the guest Inbox for those records.

Source inspection found an existing Helm cleaner SMS path in
`src/lib/automations.ts` (`deliverCleanerSms`) using `sendMessage` from
`src/lib/quo.ts` and the operations line from `src/lib/quo-lines.ts`.
This is an existing implementation to evaluate, not a verified live Calderwood
connection or a pricing guarantee. No new SMS subscription was purchased.

Before reusing that path for cutover, address or explicitly constrain these gaps:
- Multiple recipients are sent individually, but only the first provider message
  ID is retained on the automation result.
- A partial recipient failure returns a partial note while the aggregate send is
  marked sent. A whole-message retry could duplicate delivery to successful
  recipients; no whole-message retry should be inferred from that note.
- A provider send response is not proof the recipient received the SMS.

Required design: one delivery record per resolved recipient with provider ID,
accepted/delivered/failed/unknown state and an auditable message identity. Unknown
outcomes require reconciliation before retry. This needs a scoped schema/worker
review before implementation; the shared production SMS sender was not modified.

Calderwood retains Guesty ownership until cleaner history/queue disposition and
replacement delivery are verified. Historical received-text confirmation alone
does not clear activation. Today's work was documentation/source inspection only;
no tests were rerun because executable code was unchanged. Diff check passed.

## Per-recipient delivery model

`src/lib/calderwood-rehearsal/cleaner-delivery.ts` adds an immutable synthetic
ledger with a frozen recipient list and separate attempt/provider identities.
Acceptance is distinct from delivery. Sending or unknown outcomes block another
attempt; delivered recipients are suppressed. Authoritatively rejected attempts
are eligible for retry review, never automatically retried. Positive acceptance
or delivery cannot be downgraded by a late error. Duplicate start events are
no-ops, not permission to call the transport again.

Six tests cover partial delivery, recipient-specific retries, accepted versus
delivered status, uncertain sends, duplicate claims, invalid identities and
provider receipt conflicts. All recipients must have delivery evidence before
the aggregate reports delivered. Every summary carries `canSend: false`.

This is a pure state model, not durable storage, a webhook validator or a live
worker. A future adapter must validate events, authenticate provider receipts,
normalize and deduplicate destinations before freezing recipients, and persist
attempt claims atomically before network calls. A generic HTTP error or timeout
must never be classified as authoritative rejection. Reconciliation events must
be tied to the exact attempt; do not infer retry safety from stale error records.
Production integration also needs current booking/hold/expiry checks and frozen
content revisions. No existing shared sender or database schema was modified.

## Durable single-host rehearsal storage

`src/lib/calderwood-rehearsal/cleaner-delivery-store.ts` persists the synthetic
per-recipient ledger as a validated event history. The recipient list and message
identity are frozen at initialization. Every read replays validated events rather
than trusting a separately stored status projection. Unknown fields, invalid
states, duplicate event identities and inconsistent versions are rejected.

Writers hold an exclusive filesystem lock and compare the expected version.
Updates use a private temporary file, file sync, atomic rename and directory
sync. Initialization uses atomic create-without-overwrite. Missing/corrupt state
never becomes a fresh retryable ledger. A process dying with the lock leaves it
for explicit recovery; the store does not steal locks or infer that a send failed.
A save error after an uncertain commit requires rereading and reconciling before
any further action. Stable event IDs make an identical record replay idempotent;
reusing one ID for different content is an error. Store results never authorize
network sends.

Seven added tests demonstrate fresh-process readback, death after committed claim,
competing processes, lock abandonment, missing/corrupt records, malformed/stale
writes, and partial delivery across reload. Temporary fixtures contain fictional
identities and are removed after tests. No SMS API is invoked.

Validation: full suite 1,897 passed; TypeScript, targeted ESLint and diff checks
passed. Continued from `8147799d`; remote main observed before this step was
`01fe43445c38bec31135e4313dc757e454b06b9c`.

This is durable only on a persistent local filesystem with the documented
single-host locking semantics. It is not a Render/Vercel shared database adapter,
and tests do not prove power-loss behavior on every filesystem. Do not deploy it
onto ephemeral disk or use it across hosts. Next integration requires a shared
transactional store, atomic claims, authenticated receipt reconciliation and the
booking/hold/expiry checks already identified above. No production migration,
worker change or live delivery was performed.

## Shared database rehearsal storage, October 15

`cleaner-delivery-db.ts` now uses the existing isolated staging Supabase project
`jgkblfozftcvymvwhhii`. It accepts explicit server credentials and that exact URL;
there is no production fallback. It reads and validates the full event history,
then submits an append with the expected version. A lost/invalid response never
causes an automatic retry. The shared validation/replay kernel was extracted to
`cleaner-delivery-history.ts`; local-file behavior remains unchanged.

`cleaner-delivery.sql` installs one fixed fictional fixture in the private
`helm_cleaner_rehearsal` schema. The service role can call only the two narrow
read/append functions, not access the table directly. Anonymous and ordinary
signed-in clients cannot call either function. Row locking serializes competing
appends; version mismatch rejects the stale writer. SQL validates immutable
identity, append-only history, event shapes and unique record IDs. Full delivery
lifecycle validation remains in the trusted TypeScript adapter; this SQL is not a
standalone production queue or a receipt-authentication boundary.

The SQL was applied through the existing isolated staging project's editor.
Hosted verification, under the service role, committed a fictional claim and a
fictional delivered receipt, rejected a stale claim, and independently read back
version 2 with two events. The two records are `HELMTEST-db-claim-a` and
`HELMTEST-db-receipt-a` for `HELMTEST-cleaner-a`; the second fictional recipient
has no attempt. Anonymous access, signed-in write access and direct service-role
schema access all returned false. `public.automation_sends` remained absent.
These are synthetic records, not observed cleaner SMS deliveries.

`scripts/verify-cleaner-delivery-db.mjs` exercised the same SQL in a temporary
loopback PostgreSQL database with two actual connections. It confirmed that the
second writer waited on the first writer's row lock and was rejected after the
first committed. It also verified rollback, immutable history, duplicate
rejection, safe setup reapplication, restricted privileges, and persistence
across a PostgreSQL restart. The restart test was local, not a hosted outage test.
Run it with the absolute entry path of an externally installed `embedded-postgres`
package; it uses no application environment or hosted credentials and removes its
own temporary database afterward. No dependency was added to the application.

Validation: full suite 1,901 passed; TypeScript, targeted ESLint and diff checks
passed. Continued from `9cbbb607`; remote main observed before this step was
`f95f175e8d0d20efe6583cf4b824ba520aeccbde`.

The database adapter still returns `canSend: false`. No real phone numbers,
message bodies, SMS transport, worker activation, Guesty changes, or paid signup
were introduced. Next work is the worker/receipt rehearsal using this shared
store, including authenticated receipt reconciliation and current booking,
hold, ownership and expiry checks before any future live integration.

## Worker and signed receipt rehearsal, October 15

Continued from `c6920be3` on `codex/channex-staging-pilot`. Current remote main was
verified as `82d6a376a0f76fda3dc86afc029433df6af96293`; this checkpoint remains on
the isolated pilot branch.

`cleaner-delivery-worker.ts` connects the database adapter to an explicitly
synthetic dispatch interface. Only a newly committed claim may invoke the
simulator. It checks the booking/content revisions, confirmed status, hold,
owner, previous-sender stop, evidence validity and send window before claiming
and again immediately before dispatch. A failed second read leaves an unresolved
claim; a verified block records that dispatch did not occur. Neither case causes
an automatic retry. Already accepted/delivered, uncertain and rejected attempts
all suppress automatic dispatch. Provider exceptions and malformed replies become
unknown, while database errors propagate for readback/reconciliation.

`cleaner-delivery-receipts.ts` checks Quo-shaped HMAC signatures with an explicit
test signing key and a five-minute signature window. The format was checked
against [Quo webhook documentation](https://support.quo.com/core-concepts/integrations/webhooks). Only fixed
fictional outgoing deliveries on `HELMTEST-ops-line` are accepted. A receipt must
match the provider ID already saved on exactly one attempt and the same frozen
recipient. An event ID cannot be reused for another recipient. Message bodies,
phone numbers and raw webhook payloads are never written to this ledger.
Acceptance remains distinct from delivery; each recipient keeps its own status.

Fourteen new synthetic tests cover separate recipients, competing workers,
pre/post-claim context checks, interrupted claims, provider timeouts, uncertain
commits, signature tampering/age, mismatched receipts, concurrent duplicate
receipts, malformed responses and early receipt replay. The PostgreSQL verifier
now also runs the actual worker and database adapter through local SQL, commits
acceptance and a signed fictional receipt, restarts PostgreSQL, and proves the
worker suppresses replay and the duplicate receipt adds no event. The test replaces
the HTTP boundary with local SQL calls; it does not invoke the hosted RPC gateway.

Limitations before live integration: this is not an activated Render worker or a
public webhook route. It uses supplied fictional dispatch context, not an atomic
production booking/hold transaction. A receipt arriving before the provider ID is
saved returns `unmatched-provider`; it must be retained in a durable receipt inbox
and replayed later, not acknowledged and discarded. If the provider ID was lost
entirely, explicit reconciliation is required; recipient-only matching is unsafe.
The existing production Quo webhook and sender are unchanged. No real SMS,
production migration, new subscription or Guesty switch occurred.

Validation for this worker checkpoint: 1,915 application tests passed;
`npx tsc --noEmit --incremental false`, targeted ESLint, `git diff --check`, and
the real PostgreSQL worker/restart verifier passed. Changed files:

- `src/lib/calderwood-rehearsal/cleaner-delivery-worker.ts`
- `src/lib/calderwood-rehearsal/cleaner-delivery-receipts.ts`
- `src/lib/__tests__/calderwood-cleaner-delivery-worker.test.ts`
- `scripts/verify-cleaner-delivery-db.mjs`
- `SCHEMA.md`
- this handoff document


## Batched durable receipt milestone, October 15

The user requested multiple steps per milestone rather than stopping after each
small change. This batch covers durable early-receipt ingestion, atomic replay,
duplicate handling, restart recovery, and isolated hosted verification.
Continued from `8a6c58fe3123dd8e842b5505e691bc1f923ac74f` on
`codex/channex-staging-pilot`; current remote main was verified as
`75dfcb09c9781af8ca6351e9fe017d912e37d3e7`. No main update or branch push occurred.

`cleaner-receipt-inbox.ts` verifies a synthetic signature and awaits durable
storage before returning `canAcknowledge: true`. Only receipt, provider and
recipient IDs persist. An uncertain write cannot be acknowledged or automatically
retried. Explicit provider redelivery may safely confirm an identical duplicate;
reusing an ID with different content is rejected.

A bounded drain reads each receipt against the validated delivery history. An
unknown provider ID stays pending; a unique provider/recipient match produces a
delivery event. The SQL apply function locks the receipt and ledger, verifies the
saved attempt, and commits the delivery event and receipt completion together.
Competing drains cannot append twice. Receipts previously reconciled by the old
direct helper can have their inbox completion repaired without adding an event.
Callers must resume the returned page cursor until zero, then start a new sweep;
this lets later pages progress even when earlier receipts are still unmatched.
Stale versions remain pending; contradictory evidence or uncertain responses stop
that sweep for readback/reconciliation. The table map and permissions are in
`SCHEMA.md`.

Hosted verification used only fixed fictional IDs in the existing isolated
`Helm Channex Staging` project (`jgkblfozftcvymvwhhii`). The tested
`cleaner-receipts.sql` was applied through its SQL editor. Receipt
`HELMTEST-hosted-inbox-b` was committed first; a separate read showed one pending
receipt and unchanged delivery version 2. A service-role transaction then saved
recipient B's fictional claim and acceptance, applied the receipt, and verified
that a second application returned `duplicate`. Independent readback showed
version 5, receipt state `delivered`, applied version 5, zero pending receipts,
no anonymous enqueue access, and no `public.automation_sends` table. Recipient A's
original two records were preserved. Evidence screenshot:
`/tmp/calderwood-receipt-batch-verified.png` (temporary local file).

The hosted smoke invoked SQL functions directly; it did not run the TypeScript
worker through the hosted HTTP RPC gateway. The local real-PostgreSQL verifier
runs the actual TypeScript adapters, signature verifier, worker and inbox drain
with the HTTP boundary mapped to local SQL. It proved early receipt persistence
across restart, transaction rollback of both delivery and completion, concurrent
drains, duplicate/conflict handling, old-event repair, mismatch rejection,
restricted privileges, safe setup reapplication and restart without replay.
The original delivery-worker PostgreSQL verifier also passed after the refactor.
Neither restart test simulates a hosted outage.

Validation: 1,925 application tests passed; TypeScript, targeted ESLint and
`git diff --check` passed. The two real PostgreSQL verifiers passed. Run the new
verifier with an absolute entry path to an externally installed
`embedded-postgres` package; it creates and removes its own loopback database
and uses no application environment or hosted credentials.

Changed files in this batch:

- `src/lib/calderwood-rehearsal/cleaner-delivery-receipts.ts`
- `src/lib/calderwood-rehearsal/cleaner-receipt-inbox.ts`
- `src/lib/__tests__/calderwood-cleaner-receipt-inbox.test.ts`
- `scripts/verify-cleaner-receipt-inbox.mjs`
- `docs/guesty-exit/staging-storage/cleaner-receipts.sql`
- `SCHEMA.md`
- this handoff document

Remaining integration work: an authenticated staging HTTP boundary and bounded
worker scheduling, followed by current booking/hold/ownership integration before
any live cutover. This remains a fixed synthetic fixture with `canSend: false`;
there is no public webhook route, Render activation, real recipient, paid signup,
production migration, or Guesty change. The old direct receipt helper remains
only for existing fixture compatibility; new ingestion should use the inbox.


## Receipt endpoint and scheduled processing batch, October 15

Continued from `3d1d7759` on `codex/channex-staging-pilot`. Current remote main was
verified as `b407531f7b0fedde82abec90bdcfae03100cbd4d`. This checkpoint implements
and locally verifies the next batch; it does not push, deploy, register a real
provider webhook, or activate a hosted process.

`POST /api/webhooks/cleaner-rehearsal` uses the existing self-authenticating
webhook namespace, so `src/proxy.ts` is unchanged. It is unavailable outside the
exact pilot preview branch and isolated database configuration. It verifies the
existing synthetic HMAC format in `x-helm-rehearsal-signature`, with an explicit
test key that cannot fall back to the live Quo key. Only the two fictional
recipients and rehearsal line are supported. This is a test endpoint, not a
registered Quo production webhook.

A request body is limited to 64 KiB of actual bytes and five seconds to read.
Oversized, invalid, slow, aborted, unauthenticated and non-fictional requests
cannot save a receipt. A 200 response means the normalized evidence was durably
saved or confirmed as an identical duplicate; it does not mean a message was
sent or delivered. An uncertain save returns 503 with Retry-After, allowing
explicit redelivery to confirm a possibly committed receipt. Responses and logs
exclude provider payloads, arbitrary exception text, credentials and contacts.

The existing `scripts/channex-shared-worker.mts` has an optional receipt loop;
no additional service or cron subscription is required by this design. Each cycle
processes at most 25 inbox rows, with a 20-second abort deadline and five-second
RPC deadlines. Pages run serially. A remaining cursor runs after five seconds;
the end of a sweep returns to zero after one minute so earlier unmatched receipts
are reconsidered. Failures reset the cursor and back off from one to fifteen
minutes. A shutdown aborts outstanding fetches/waits. A lost process starts from
zero and the durable deduplication prevents another delivery event. This loop
only reconciles evidence; it never calls a message sender. Cycle logs report
aggregate counts and success/failure. They are not a durable alerting system.

Activation configuration, to be applied only to the isolated preview/worker:

| Setting | Preview receipt endpoint | Existing staging worker |
| --- | --- | --- |
| `CHANNEX_CLEANER_RECEIPTS_ENABLED` | `true` | `true` |
| `CHANNEX_STAGING_DB_PROJECT_REF` | `jgkblfozftcvymvwhhii` | same |
| `CHANNEX_STAGING_DB_URL` | `https://jgkblfozftcvymvwhhii.supabase.co` | same |
| `CHANNEX_STAGING_DB_SERVICE_KEY` | explicit staging service key | same |
| `CHANNEX_STAGING_ENABLED` | `true` | existing worker configuration |
| `VERCEL_ENV` / `VERCEL_GIT_COMMIT_REF` | `preview` / `codex/channex-staging-pilot` | `VERCEL_ENV` must be absent |
| `CHANNEX_WORKER_MODE` | not used | `isolated-staging` |
| `CHANNEX_CLEANER_RECEIPT_TEST_SIGNING_KEY` | fresh canonical base64 key, at least 32 random bytes | not needed |

Keep the test signing key only in the preview environment and the trusted
synthetic sender. Do not reuse provider secrets or print it. The existing
`CHANNEX_WORKER_ONCE=yes` runs one receipt page for a controlled smoke check.
Disabling `CHANNEX_CLEANER_RECEIPTS_ENABLED` closes intake and omits the receipt
loop on the next deployment/process start; stored receipts and history remain.
The endpoint's deployment-protection requirements still need checking before any
external synthetic sender can reach the hosted preview. No bypass token is
embedded or protection setting changed here.

Validation: 1,936 application tests passed, TypeScript and targeted ESLint passed.
Eleven new tests cover environment/authentication failures, body bounds and
cancellation, acknowledgement timing, duplicate confirmation, uncertain writes,
RPC cancellation, sequential paging, restart cursor behavior, backoff, one-shot
execution and shutdown. The real PostgreSQL verifier now serves the handler over
loopback HTTP: a simulated lost storage reply returned 503 after the commit;
signed redelivery returned a duplicate acknowledgement and kept one pending
receipt. That receipt survived database restart and later replayed once. The
verifier also ran a scheduled page against the real local database, and all prior
rollback/concurrency/privilege/restart checks passed. The HTTP server bypasses
Next.js only for this injected local database harness; it exercises the actual
handler and adapter code without hosted credentials. A separate loopback Next.js
server compiled the actual route and proxy with synthetic auth and intake
disabled: POST returned 404, and unsupported GET returned 405. No session or
hosted database was used. `git diff --check` passed.

Changed files:

- `src/app/api/webhooks/cleaner-rehearsal/route.ts`
- `src/lib/calderwood-rehearsal/cleaner-receipt-runtime.ts`
- `src/lib/calderwood-rehearsal/cleaner-receipt-http.ts`
- `src/lib/calderwood-rehearsal/cleaner-receipt-scheduler.ts`
- `src/lib/__tests__/calderwood-cleaner-receipt-service.test.ts`
- `scripts/channex-shared-worker.mts`
- `scripts/verify-cleaner-receipt-inbox.mjs`
- `SCHEMA.md`
- this handoff document

Remaining: deploy/configure this code on the existing isolated preview/worker and
verify a hosted signed request plus scheduled replay. Current booking, hold,
ownership and existing Guesty-send reconciliation still precede any real cleaner
message or Calderwood cutover. No hosted settings, Guesty connections, paid
subscriptions, or production data were changed in this batch.


## Hosted receipt activation, October 15

User authorized deploying and verifying the existing isolated preview and Render
worker. Branch `codex/channex-staging-pilot`, base `a148b0e6`; remote main was
verified as `f2b1ce6f1687f389a6c0d55cf8d8cf7b6c18a8cd`. Code source deployed to both
services is `ce3106bcf2677795373c6240444e3a15e86d7bd9`, following `099f2f22`.
The packaging correction adds `src/lib/calderwood-rehearsal` to the worker image;
without it the new static imports could not resolve. Existing full-app manifests
and worker dependencies were unchanged.

Deployment evidence:

- Vercel preview `dpl_241hkEozkz1vHC1WVcF4EGb5y3VJ`, Ready:
  https://rising-tide-statements-e4na5m9mg-rising-tide-fc584d5d.vercel.app
  The existing pilot branch alias points to this deployment.
- Render service `srv-db05t2id0e5s73a7r8gg`, deployment
  `dep-db8no18n74is73c5jslg`, live October 15 at 9:21 PM America/New_York:
  https://dashboard.render.com/worker/srv-db05t2id0e5s73a7r8gg/deploys/dep-db8no18n74is73c5jslg
  This replaces prior worker source `a14214e128e1b2f7e62dd4c693ce2134a04fd4a0`.
- The worker's real Node 24 container installed ten packages and reported zero
  known dependency vulnerabilities at build time. Startup produced a successful
  receipt cycle and successful front/back message scans; booking sync reported
  `published: 0`.

Configured only two new preview variables, scoped to this Git branch:
`CHANNEX_CLEANER_RECEIPTS_ENABLED=true` and a fresh test-only
`CHANNEX_CLEANER_RECEIPT_TEST_SIGNING_KEY`. The trusted local test sender retains
its key in the ignored `.channex-staging/cleaner-receipt-signing-key` file with
mode 0600. No key or signature is in this document, source control, or logs.
The existing worker gained `CHANNEX_CLEANER_RECEIPTS_ENABLED=true` and
`CHANNEX_STAGING_DB_PROJECT_REF=jgkblfozftcvymvwhhii`; existing credentials and
DB URL were retained. Its compiled-in staging mode and exact database guards
passed at startup. The signing key is not installed on the worker.

Hosted acceptance:

1. Direct unauthenticated HTTP returned Vercel deployment protection's 401.
   Protection was retained. Requests through the authenticated `vercel curl`
   CLI reached the route, which independently rejected an unsigned receipt
   with 401 `Receipt authentication rejected`.
2. The read-only private-schema baseline was version 5, five events, no pending
   receipts, and no row/event for `HELMTEST-hosted-http-20261015`.
3. A fresh HMAC-signed fictional `message.delivered` receipt for existing provider
   `HELMTEST-hosted-provider-b` and recipient `HELMTEST-cleaner-b` returned
   200 `{"status":"stored","canSend":false}`. Identical redelivery returned
   200 `{"status":"duplicate","canSend":false}`.
4. At `2026-10-16T01:25:30.853Z` the running worker logged `scanned: 1`,
   `applied: 1`, zero failures/unmatched/stale and cursor zero. No manual drain
   was invoked.
5. A fresh read-only query confirmed ledger version 6, six events, exactly one
   test receipt row, applied version 6, exactly one corresponding history event,
   and zero pending receipts. Anonymous enqueue permission remained false.
   The next scheduled cycle at `01:26:31.057Z` applied zero additional events.

The existing provider attempt was already marked delivered by prior rehearsal
work. This test adds a distinct evidence event and proves signed HTTP ingestion,
durable deduplication and automatic matching/application. It does not represent
a new SMS, a real provider callback, or a new recipient delivery. No phone
numbers, message bodies, real channel connection or sender were used.

Validation for the packaging commit: all 1,936 application tests passed;
`npx tsc --noEmit --incremental false` and `git diff --check` passed. A clean
local directory assembled from the Dockerfile COPY instructions installed only
the worker lockfile dependencies and resolved every import, then correctly
stopped at the missing explicit staging-mode guard without credentials. Docker
is unavailable locally; the actual Render build subsequently passed. This final
handoff/SCHEMA update is documentation-only and does not require another test run.
Screenshot proof: `/tmp/calderwood-hosted-receipt-worker-verified.png`.

No new paid service or subscription was added. Guesty remains connected, and
no live guest/cleaner message, main merge, or production deployment occurred.
Automatic approval review declined revealing a masked Render value; that read
was abandoned. Startup guard validation established the target without exposing
or replacing existing credentials, so no deployment work remained blocked.

Next: complete the current-booking/hold/ownership and existing Guesty-send
reconciliation needed before any controlled cleaner dispatch. Production
Channex access/costs, dynamic PriceLabs propagation, real channel delivery,
access-code provisioning, outage operations and contract exit remain separate
live-cutover gates. Do not register a live provider against this protected,
fictional-only preview endpoint.


## Full-year booking and guest-message review, October 16

Continued the owned pilot branch from `0952c5f4`; base remains `a148b0e6`.
Remote main was verified as `f2b1ce6f1687f389a6c0d55cf8d8cf7b6c18a8cd`.
The unrelated local contract notes in `calderwood-cutover-readiness.md` were
preserved and excluded from this batch.

A fresh read through the existing staff-only preview reviewed October 16, 2026
through October 16, 2027, exclusive. Completed at `2026-10-16T13:39:56.893Z`:

- Nine reservation records: six confirmed, two canceled, one inquiry.
- All 365 Guesty calendar nights returned, zero missing, zero diagnostic issues.
  Twenty-three nights reported reservation blocks. One also had advance notice.
  No manual, owner or imported-calendar holds were reported in this response.
  That is a snapshot observation, not a guarantee about independent channels.
- Three non-confirmed records overlap confirmed stay dates. Cancellation must
  never release another booking's occupancy simply because its dates match.
- Posted minimum stays vary from one to four nights. PriceLabs remains the
  user's dynamic rule source; this read does not prove PriceLabs delivery or
  establish Channex arrival/through-stay semantics.
- All 365 Channex test nights returned with stop-sell verified. All differed from
  the live calendar, as expected for the existing closed placeholder setup.

The current stay's Guest auto messages panel was independently reviewed around
13:52 UTC. History showed completed confirmation, check-in instructions and key
code messages. The instructions and key code were sent a few minutes after the
existing 4 PM/day-before and 3 PM/arrival-day schedules. One enabled checkout
reminder remained scheduled at 11 AM on the day before departure, with an
explicit source expiry. This corroborates progression of the four guest
workflows since the October 13 review; it does not prove recipient delivery,
cleaner SMS history/queue completeness, or a stopped Guesty sender. No message
body, recipient, access code or booking identity is retained here or in tests.
No automation switch or setting was changed.

The existing read-only comparison page now defaults to the full 365-day window
and shows a compact booking/hold summary before the nightly tables. It counts
unique occupied nights, flags overlapping confirmed records and non-confirmed
records sharing dates, preserves raw provider source/status labels, and shows
missing calendar evidence as unverified. Manual/owner/imported holds count once
per night even when several reasons apply; all reported reasons remain visible.
Posted minimum ranges describe the current response only. The summary does not
persist data, update inventory, infer available nights, or authorize a sender.

Changed implementation: `src/lib/calderwood-readonly/review-summary.ts`,
`src/app/channels/staging/calderwood/page.tsx`, and the seven synthetic tests in
`src/lib/__tests__/calderwood-review-summary.test.ts`.
Validation: all 1,943 tests passed; nonincremental TypeScript, targeted ESLint
and diff checks passed. No database, worker, provider, paid-service or production
configuration change is part of this batch. Cleaner history/queue disposition,
manual message holds and sender ownership still require authoritative evidence
before controlled dispatch. Do not treat the calendar summary as that evidence.

Hosted preview acceptance: code `889df3fc` reached Ready in Vercel deployment
`dpl_J4XwkZKNzvzpfspDBmkjY9U7yWGV`:
https://rising-tide-statements-omzgpl3sp-rising-tide-fc584d5d.vercel.app
The existing pilot alias points to it. An initial refresh reported a source-read
failure and withheld the summary. One explicit retry succeeded around 13:57 UTC;
the deployed summary showed six confirmed stays, 23 occupied nights, three
non-confirmed records overlapping confirmed dates, full 365-night coverage,
zero diagnostic issues, and posted minimums ranging from one to four nights.
The failure cause was not established; it was not treated as an empty calendar.
Visual proof: `/tmp/calderwood-booking-hold-review-verified.png`.
This acceptance checkpoint changes documentation only; the application code and
its completed tests are unchanged.


## Reservation timing and a concrete sender-stop path, October 16

Continued from `e78bf535`; branch `codex/channex-staging-pilot`, original base
`a148b0e6`. Remote main observed this turn was
`29c7ab75ff0d194a887759d9166d78ebf3868568`. Existing contract notes remain excluded.

The comparison page now reviews the six known message offsets per confirmed
stay using planned arrival/departure timestamps already present in the existing
Guesty search response. No additional API requests, database writes or provider
subscriptions are needed. Both top-level and sole-stay timestamps must agree and
convert to the matching New York stay date. Missing, inconsistent, malformed or
sub-minute values stay unverified; listing defaults are never silently inserted.
Calendar-day offsets preserve local clocks through DST and withhold ambiguous or
nonexistent target clocks. Minute offsets retain the source instant.

The source is the current [Guesty Search Reservations reference](https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_searchreservations),
including its published response schema: `checkIn` and `checkOut` represent
planned arrival/departure, and the single stay repeats them. The search response
does not provide an authoritative workflow-confirmation time. `createdAt`,
`bookingDate` and channel timestamps are not substituted for it. No deprecated
reservation endpoint or broad detail read was added.

These are proposed times, not actual scheduled messages. The page makes that
distinction explicit and never infers sent state, empty queues, removed holds,
workflow applicability, expiry, valid access codes or transferred ownership.
All proposals carry `canSend: false`. The existing handoff function still
requires complete authoritative evidence; this work does not relax it.

### Operational path to prepare before any switch

Guesty's [automation management guidance](https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members)
says deactivating a workflow removes its unsent messages from matching
reservations, with a delay before the change registers. Its
[Activity Log guidance](https://help.guesty.com/hc/en-gb/articles/15223598912925-Searching-for-message-automations-and-viewing-changes)
describes configuration-change history. That log is not a delivery ledger.
These sources provide a future stop mechanism to verify; neither proves an
actual stop or that an in-flight message was drained.

1. Inventory every applicable Calderwood workflow, including global staff and
   booking-change workflows, source filters, recipients, holds and expiry. The
   six reviewed offsets are not a complete inventory of all account automations.
2. Prepare a per-reservation/message handoff worksheet. Preserve verified sent
   messages; leave unknown cleaner history explicitly unknown. Assign manual
   coverage for unknown obligations instead of automatically replaying them.
   A manual plan is an operational exception, not fabricated complete evidence.
3. For a separately authorized cutover, scope any Guesty stop to Calderwood and
   verify deactivation has finished. Use a window without imminent sends and
   reconcile in-flight/uncertain attempts. Elapsed time, a toggle, an empty guest
   Inbox or an Airbnb disconnect alone does not establish `senderStoppedAt`.
4. Refresh reservation timing/status, holds, recipients and source applicability,
   then separately review future replacement obligations. Previously unknown
   messages stay out of automated takeover. Any eventual manual or automated
   dispatch must be recorded under one owner so it cannot later be replayed.

No Guesty automation was disabled, no message was sent, and no cutover or
production settings were changed. Historical cleaner delivery and future queue
coverage remain unresolved. This path avoids treating the guest Inbox as a
cleaner-message log or asking the user to check the same unavailable screen.

Implementation: `src/lib/calderwood-readonly/message-timing.ts`, the existing
reader and calendar/summary input types, the new `MessageTimingReview.tsx` panel,
and its insertion on the protected Calderwood comparison page. Seven synthetic
tests cover timestamp validation, private-field exclusion, altered times,
DST transitions, missing evidence, non-confirmed stays and past/due messages.
The existing reader test now checks that missing timing is explicit.

Validation: 1,950 tests passed, nonincremental TypeScript passed, targeted ESLint
and diff checks passed. Hosted verification is recorded separately after build.


### Hosted finding: source clock discrepancy

Build `bf4f300c` reached Ready in preview deployment
`dpl_GzEE2SSSxTQrbsKLTvuXo1dYFRXj`. The fresh read at
`2026-10-16T14:54:40.683Z` returned timing for all six confirmed stays. However,
the sampled current stay's timestamps interpreted according to the API's UTC
schema produced noon arrival and 7 AM departure in New York. The Guesty UI
instructions independently showed 4 PM arrival and 11 AM departure, consistent
with the existing workflow evidence. Winter stays also exhibited a five-hour
difference from the listing defaults. The cause is not established.

The follow-up explicitly marks the API clock unverified and withholds all live
message-time proposals. The screen labels converted timestamps as API
interpretations and explains the mismatch. No offset correction, assumed local
clock, or default time is substituted. Merely agreeing with the stay segment
is insufficient evidence: both fields may carry the same upstream ambiguity.
An additional regression ensures an unverified clock produces six unverified
rows and no send permission. The pure arithmetic tests use explicitly verified
fictional clocks; no live record receives that status.

Next implementation work is an independent, minimal reservation-time read and
comparison with the visible Guesty schedule. Resolve the source semantics before
feeding any timing into the handoff or dispatch worker. The replacement workflow
remains closed to live sends. Production Channex access, source queue/history
and pricing delivery remain separate unresolved requirements.

Follow-up validation: all 1,951 tests passed; nonincremental TypeScript, targeted
ESLint and diff checks passed. The discrepancy is exposed in the protected
preview only; Guesty still controls all actual message delivery.


### Local clock reconciliation, October 16

Supersedes the blanket timing-withholding checkpoint above for records whose
explicit local fields pass the new scoped read. V3 retrieve `stay.eta`/`stay.etd`
were checked against V3 search for the current Calderwood stay. Both carry the
same clock discrepancy; the second V3 endpoint is not independent verification.
No V3 timestamp is offset or reinterpreted as a local clock.

Guesty's [legacy reservation reference](https://open-api-docs.guesty.com/reference/reservationsv2get)
explicitly documents `plannedArrival` and `plannedDeparture`, with listing
defaults used when overrides are absent. A field-projected GET of these local
clocks, the listing timezone and identity/date/status fields returned 16:00 and
11:00 in America/New_York for the sampled stay. Guesty's visible scheduled-message
panel independently showed the checkout reminder at 11 AM the prior day.

`local-clock-reader.ts` is a temporary preview-only dependency on that deprecated
endpoint. It accepts only the fixed Calderwood listing and at most 12 confirmed
reservations already returned by the scoped search. Exact ID, listing, dates and
status must still match. It requests only the listed fields, permits GET only,
rejects redirects, uses five-second timeouts and never returns raw responses.
Any failed request or binding mismatch discards the entire local enrichment; the
original unverified snapshot and calendar review remain available. Invalid
overrides never fall back to defaults. Missing defaults, wrong zones and DST
gaps/folds leave the affected timing unknown.

The explicit local date and clock are converted with New York timezone rules.
The six existing workflow offsets are then calculated for review; confirmation
time still remains unknown. Every row retains `canSend: false`. Nothing feeds
the dispatch worker, creates a queue entry, changes a hold or takes sender
ownership. The UI reports the source and shows the disagreement with V3.

A bounded live read completed at 2026-10-16T15:15:24.539Z: all six confirmed stays
had usable local clocks, all six disagreed with V3, and none had local timing
issues. The 30 calculable review rows preserved 3 PM key-code messages, 9 AM
arrival-day cleaner reminders and 11 AM checkout reminders. Six confirmation
rows remained unverified; zero rows were sendable. These are calculations, not
proof of actual queued/sent messages. Customer records were not saved.

Validation: 1,958 tests passed, including seven new synthetic cases for local
clock resolution, overrides/defaults, DST, exact scope, private-field exclusion,
bounded reads and failure fallback. Nonincremental TypeScript, targeted ESLint
and diff checks passed. Hosted acceptance is recorded in draft PR #1714 after
deployment.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, previous commit
`360d4a77`; current remote main verified as
`4143026cd288494a737e31d448d82cbb707648de`. Files changed: the local clock reader,
message timing normalization, guarded access loader, comparison page/panel,
focused tests and this document. Existing contract notes remain excluded.

Remaining: a supported production timing source must be validated before any
migration; this legacy API preview is not that dependency decision. Current
workflow applicability, holds, sent/queued disposition and sender drain still
need reconciliation. The confirmation event clock and cleaner history remain
unverified. Channex production access, PriceLabs delivery and contract exit
requirements are unchanged. No service, subscription, recipient or live sender
was added or modified.


### Confirmation event and guest-message evidence, October 16

Supersedes the confirmation-time unknown above. The supported
[V3 reservation detail endpoint](https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_getreservationsbyids)
returns the reservation's `confirmedAt` event. Guesty's
[reservation field guide](https://open-api-docs.guesty.com/docs/how-to-search-for-reservations)
defines this as the booking's confirmation time in Guesty. The preview now uses
that event plus the existing 30-minute offset. Creation dates, booking dates and
channel metadata are never substituted.

The server reader accepts only the fixed listing and up to 12 confirmed stays
already returned by scoped search, in GET batches of at most ten IDs. Each
response must bind to the exact requested ID, status, sole stay, listing and
dates. Missing, malformed or future timestamps remain unknown. Raw detail,
guest information, financial fields and credentials never leave the reader.
Request failures withhold confirmation calculations while preserving the
independently verified local clocks and calendar review. Confirmation evidence
does not depend on arrival/departure clock evidence.

A bounded live read at `2026-10-16T16:55:23.944Z` returned valid confirmation
timestamps and explicit local clocks for all six confirmed stays. All 36 review
rows were calculable, zero were unverified and zero were sendable. Existing
3 PM key codes, 9 AM arrival-day cleaner reminders and 11 AM checkout reminders
were retained. The older local-clock API dependency remains unresolved for
production; this V3 confirmation read does not replace that separate dependency.

For the sampled October 15-19 stay, Guesty's visible History panel showed:

- Reservation Confirmed: completed September 8 at 9:04 PM.
- Check-in Instructions: completed October 14 at 4:04 PM.
- Key Code: completed October 15 at 3:03 PM.

The confirmation event plus 30 minutes calculated September 8 at 9:03 PM,
adjacent to the minute displayed for the completed message. Minute-resolution
UI evidence cannot establish an exact delivery delay. The Scheduled panel
showed the checkout reminder for October 18 at 11 AM, expiring October 25 at
11 AM. Both the overall guest-automation switch and that reminder's switch
were enabled when read; no switch was changed. This establishes one sampled
future reminder's enabled state, not every workflow's holds or queue coverage.
Cleaner SMS history remains unknown because this guest-message panel does not
cover it. No historical message was replayed or marked sent by Helm.

Validation: all 1,965 tests passed, including seven new synthetic confirmation
cases for strict timestamps, bounded batches, privacy exclusion, no fallback,
exact record binding, authorization, failure recovery and no send permission.
Nonincremental TypeScript, targeted ESLint and diff checks passed. Hosted
acceptance is recorded in draft PR #1714 after deployment.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, previous commit
`04622745`; remote main verified as
`ba392ef0e0cd1a73aa0372e70a14b0715a421640`. Changed files: confirmation reader and
focused tests, timing normalization, guarded loader, comparison page/panel and
this document. Existing contract notes remain excluded. Guesty remains the live
sender. No recipient, service, subscription, automation or production setting
was changed.


### Full guest-queue review and DST discrepancy, October 16

Supersedes the preceding claim that all 36 calculated times were settled. A
read-only UI review covered all six current/future stays in the Calderwood
cleaner report. The four recurring guest messages per stay account for 24
observed entries: eight displayed Completed and sixteen scheduled. All six
master switches and all sixteen queued row switches were enabled. Schedule and
expiry times were read without changing switches, sending messages or saving
workflow settings. Completed is Guesty's displayed status, not a read receipt.

The private local handoff worksheet is
`/tmp/calderwood-message-handoff-worksheet.html`. It contains no guest names,
reservation IDs, contact details, message bodies or credentials. Completed rows
are marked do-not-replay; pending rows retain Guesty ownership. The twelve
cleaner-message obligations remain unknown. The worksheet is an observation,
not durable sender authority, and must be refreshed before cutover.

The stay departing on the autumn clock-change date has its checkout reminder
queued at noon the prior day; the earlier preview calculated 11 AM. The observed
queue agrees with subtracting 24 elapsed hours, while the preview preserved the
same local clock on the previous calendar date. One observation does not
establish a universal Guesty rule or prove how cleaner reminders behave.

The preview now compares both interpretations for day-based offsets. If they
differ, including a missing/ambiguous target local clock, it withholds `at`,
shows both candidate times and requires queue reconciliation. This affects both
one-day and ten-day offsets. Verified minute-based offsets and confirmation
calculations are unchanged. There is no saved override, queue import, live
sender change, or inference of delivered/unsent state. The separate synthetic
handoff/dispatch model still cannot consume this preview as sender authority.

#### Broader workflow inventory

Filtering Message automation to 65 Calderwood returned seven workflows. Adding
Status Active returned six; the sample guest workflow disappeared. These six
active workflows contain twenty configured message templates:

| Workflow | Trigger | Templates | Visible scope |
| --- | --- | ---: | --- |
| Calderwood Messaging | Booking confirmation | 4 | Calderwood; all sources except three exclusions |
| Cleaning updates - Luana | Booking confirmation | 2 | Calderwood; all sources |
| Copy of STAFF Booking Change CT | Booking alteration | 1 | Bridgeport; all sources |
| DIRECT BOOKING | Booking confirmation | 8 | All properties; restricted sources |
| Rental Agreement | Booking confirmation | 1 | All properties; source detail not established |
| STAFF messages ONLY | Booking confirmation | 4 | All properties; all sources |

The alteration workflow showed “TEST Change to Stay”, “At alteration”, and User
via SMS. Its name does not establish test-only behavior: it appears under the
Active filter. Global/source-conditioned workflows need their conditions,
recipients and outstanding obligations reconciled before migration. Twenty
templates does not mean twenty pending messages per reservation. The original
six recurring offsets are therefore not the complete migration inventory.
No workflow was activated, deactivated, edited or saved. A staff-workflow editor
was opened for inspection and left via list navigation without saving.

Validation: all 1,968 tests passed; nonincremental TypeScript, targeted ESLint
and diff checks passed. Synthetic coverage includes both DST directions,
missing/ambiguous local times, unchanged minute offsets and withholding all
candidates for canceled or unverified stays. Hosted acceptance is recorded in
PR #1714. No additional provider request or paid service was added by this fix.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, prior commit
`3b245d5b`; remote main observed as
`b0c9e8b4b353bf2f345cb5ecc2d0adfab3293d6c`. Changes are limited to
`message-timing.ts`, its focused tests, `MessageTimingReview.tsx` and this
document. Existing contract notes remain excluded. Production Channex access,
pricing delivery, the supported arrival/departure source, cleaner history and
contract exit remain separate requirements.


### Conditional workflow review, October 17

The same Calderwood/Active filter still returned six workflows and twenty
configured templates. Read-only list expansions established the remaining
thirteen confirmation-triggered templates; the alteration template was already
observed. The workflow editors supplied exact source conditions. All inspected
Save controls were disabled, and the editors were left through list navigation.
No workflow, recipient, switch, attachment or scheduled message was changed.

| Workflow | Exact source condition | Existing delivery and timing |
| --- | --- | --- |
| Calderwood Messaging | All except Website, Manual, Direct - stay cape ann | Existing four booking-channel guest messages |
| DIRECT BOOKING | Website, Manual, Direct - stay cape ann | Separate guest SMS and email at confirmation, one day before check-in, one hour before check-in, and one day before checkout: eight templates |
| Rental Agreement | Website only | Guest email one hour after confirmation; visible body references Rental Agreement 2025.pdf |
| STAFF messages ONLY | All | Four User-via-SMS notices, detailed below |
| Copy of STAFF Booking Change CT | All; Bridgeport property rule | User via SMS at alteration; TEST Change to Stay remains active |
| Cleaning updates - Luana | All; Calderwood | Existing two phone-book-contact SMS reminders |

The staff list showed Check In Notice and Check in notice - Allie, each one day
before check-in; Check Out Notice - Morgan one day before checkout; and Check Out
Message three hours before checkout. Selecting each showed User via SMS. Message
names are not proof of the configured user recipients. The editor did not expose
those four timeline entries in the available view; exact user bindings remain
unverified. The two cleaner reminders likewise have no new delivery/queue proof.

Important implementation distinctions:

- The direct-booking confirmation is at confirmation, unlike Calderwood's
  booking-channel confirmation at +30 minutes. Do not reuse that offset.
- SMS and email are separate obligations. The visible direct-booking confirmation
  uses a Guesty guest-portal variable; link migration needs its own verification.
- The agreement email is Website-only, narrower than the direct-booking workflow.
  Its referenced attachment must be retrieved and checked for the approved
  current version before replacement; the filename alone proves neither content
  nor legal suitability. No agreement was downloaded, accepted or sent here.
- The main guest and direct-booking workflows have complementary displayed source
  conditions. Reservation API source labels have not been proven equivalent to
  those UI selections, so no automatic eligibility mapping was added.
- The active alteration alert cannot be discarded merely because its name says
  TEST. Recipient and event relevance still need verification.
- Day-based staff/direct/cleaner offsets inherit the unresolved DST interpretation
  issue. No noon/11 AM rule was generalized from one observed guest queue.

The protected Calderwood page now shows this dated six-workflow inventory even
before a live comparison is requested. It distinguishes twenty configured
templates from six timing previews and fourteen additional templates. Details
show scope, delivery method, timing and missing migration coverage. The timing
panel also states its partial coverage. These are server-rendered review text,
not a configuration feed, source matcher, scheduler or sending capability.

Validation: all 1,968 tests passed on Node 25.9.0, with zero failures.
Nonincremental TypeScript, targeted ESLint and diff checks passed. No new unit
test was added for static inventory prose. Hosted acceptance is recorded in
draft PR #1714 after preview deployment.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, prior commit
`eb5212fa`; remote main verified as
`d8446ebc7717c5c77044b1fd2151a0445ea787e2`. Changed files are
`MessageWorkflowCoverage.tsx`, its insertion in `page.tsx`, the scope notice in
`MessageTimingReview.tsx`, and this document. Existing contract notes remain
excluded. This closes the missing template timing/source inventory, not the
pending queue, recipient, attachment or cutover requirements.


### Portal and attachment compatibility review, October 17

Read-only inspection completed the prior attachment retrieval and identified the
portal functions linked from DIRECT BOOKING. The protected review page now records
these dependencies alongside the workflow inventory. No recipient, configuration,
message, portal field or payment setting was changed. Editors were exited with
Cancel or navigation; no Save or Done control was used.

**Stay Collections guest app**

The existing `{{guest_app::stay_collections}}` variable refers to a portal with
reservation information, a check-in form and additional information enabled.
First name, last name, email and phone number are all enabled and required in the
check-in form. No signature or document-upload item appeared in the inspected
form. Payment-info collection and the guidebook are off.

Additional information is set to **After Check-in form submitted**. All five
General information categories are selected: WiFi, address, house manual, trash
pick-up instructions and parking instructions. All ten Check-in and check-out
categories are selected: door code, lock code, entry instructions, additional
entry instructions, entry photo, luggage storage, checkout instructions,
departure instructions, Guesty locks manager and key code. All nine House rules
categories are selected: child, pets, smoking, parties/events, quiet hours,
additional rules, safety instructions, safety devices and property info. The two
custom check-in/check-out fields are not selected.

These are category selections, not proof that Calderwood has populated values or
that a guest can see a particular code. The editor explicitly labels its preview
as example content. No guest form submissions or access credentials were read.
The portal gate is independent of the 3 PM code message: reconcile populated
access fields, guest-visible timing and manual holds before replacing the link.
Do not assume a message hold also hides an existing portal code. Preserve the
user's normal 3 PM message and 3:30-4 PM guest guidance.

GuestVerify and Upsells are checked under **Only for properties covered by
Add-ons**. This does not establish Calderwood enrollment, usage or billing. No
new provider or paid add-on was activated or selected for the replacement.

**Existing agreement attachment**

The Website-only Rental Agreement template has a directly attached
`Rental Agreement 2025.pdf`, scheduled one hour after booking confirmation. Its
message-level conditions panel has no extra conditions configured. The PDF was
downloaded unchanged from the UI-linked asset, rendered and visually inspected:
one page, 55,951 bytes, zero AcroForm fields. SHA-256:
`c677d2fbc304dffc85f7161a1bdaac87384c5a41ec1ec55f7a67c5cf5cf36c16`.
The private review copy is `/tmp/calderwood-guesty-rental-agreement-2025.pdf`;
the source asset URL and document are not committed.

The document describes acceptance through payment rather than a signing form.
It includes a security-deposit preauthorization and release window, among other
payment/cancellation terms. Document wording does not prove those payment
operations occur, and inspection is not approval of the terms or version. Keep
an unchanged attachment path distinct from a new e-signing process. No contract
was accepted, sent, rewritten or treated as a payment instruction.

Existing code provides reusable email infrastructure in
`src/lib/agreement-email.ts`, but `src/lib/agreement-base.ts` and
`src/app/agreement/[token]/page.tsx` generate terms and collect a signature.
`src/app/guests/agreements/actions.ts` also has its own defaults. Reusing that
workflow without review would change the current attachment-based process.
The reviewed branch has no replacement for this Guesty portal variable.

**Implementation sequence**

1. Model portal completion separately from code-release eligibility. Preserve
   required contact fields and reservation-scoped access; do not substitute a
   public guide page for gated property/access information.
2. Bind source conditions and exact staff/cleaner recipients to verified evidence.
   A fresh workflow editor still did not expose the staff/cleaner timeline cards,
   so message titles remain insufficient recipient proof.
3. Preserve Website agreement attachment delivery as its own obligation, with
   approved content/version and recorded outcome. Use existing email transport
   only after the destination and attachment are verified; do not silently opt
   guests into a new signing or deposit flow.
4. Reconcile pending obligations, revisions and sender ownership before enabling
   any new sender or replacing portal links. Template counts and configuration
   selections are not delivery evidence.

Guesty's official [automated-message guide](https://help.guesty.com/hc/en-gb/articles/9365081186205-Managing-automated-messages-for-guests-owners-and-team-members)
states that only the first booking alteration triggers an alteration message.
Keep that limitation in the migration comparison; do not assume the active
alteration template provides an alert for every later revision. Actual recipient
and prior-send evidence are still required.

Hosted acceptance of the preceding inventory completed at deployment
`dpl_EzRbyruhMDyfmFRm32bmPLvRwa34` (Ready). The authenticated branch preview showed
six workflows, twenty templates and the direct-booking source/timing details.
Screenshot: `/tmp/calderwood-workflow-coverage.png`. This supersedes the prior
queued-deployment note. Hosted acceptance for the new dependency text is recorded
in draft PR #1714, separately from this prior deployment.

Validation: all 1,968 tests passed in 240 suites on Node 25.9.0, with zero
failures. Nonincremental TypeScript, targeted ESLint and diff checks passed.
Referenced source paths were verified. No new tests mirror this static review
text; no data fetch or sending capability was added.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, prior commit
`ade3dfae`; remote main verified as
`9bb2cf41f256211575f8e4d8c204f8c56d765b37`. This batch changes
`MessageWorkflowCoverage.tsx` and this document. Existing contract notes remain
excluded. Staff/cleaner binding and history, populated portal access fields,
agreement approval/payment behavior, production channel access and pricing
propagation remain unresolved. No live cutover is implied.


### Access-field audit and shared release rehearsal, October 18

The scoped property review found **Lock code populated** in Calderwood's
Check-in and check-out policy. Door code, entry instructions, additional entry
instructions, luggage storage, checkout instructions and departure instructions
were not configured. Location & details showed Wifi name/password, house manual
and parking instructions as not configured. Only label/presence states were
returned from the DOM. No code value, WiFi credential or customer record was
printed, saved, added to fixtures or copied into the review page.

Combined with the October 17 portal configuration, this identifies an actual
populated access field selected for the portal's after-form-submission section.
It still does not prove when a particular guest sees it. No guest form was
submitted and no guest session was used. Guest-visible timing and existing
manual-hold effects remain unverified. Before migration, check text, photos,
manuals and attachments for embedded credentials as well as dedicated code
fields; a field-only filter cannot establish safe non-code content.

The staff editor was checked at full desktop width after its narrow layout
appeared clipped. It still rendered only Booking confirmation and Add message,
while the list had four existing notices. No message was created to probe that
state, and the disabled Save was not used. The viewport was reset. Exact staff
and cleaner bindings remain unresolved; prior list titles do not establish a
recipient. The published Open API documentation index did not expose a workflow
or automated-message read endpoint during this check, so no guessed private API
or broadened customer-data request was attempted.

**Implemented policy rehearsal**

`src/lib/calderwood-rehearsal/access-release.ts` separates three review decisions:

- Non-code portal information requires a completed form and fresh evidence bound
  to the current property, reservation and revision.
- Code-message timing preserves the existing one-hour-before-arrival offset.
  Form completion is not added as a new message prerequisite. A verified current
  credential and explicitly clear hold state are required for a review candidate.
- Portal code disclosure requires both the form and the same code timing/hold
  decision. Completing the form cannot bypass release time or a manual hold.

Nonconfirmed or ended stays, unverified/invalid clocks, mismatched revisions,
missing evidence, stale/future observations and unknown holds withhold the
applicable decisions. Changing dates with matching new evidence does not clear
an existing hold. The synthetic five-minute evidence limit is illustrative,
not an approved production freshness policy.

The new `AccessReleaseRehearsal.tsx` panel is included in the existing protected
message-hold rehearsal, and linked from the Calderwood workflow inventory. Ten
fictional scenarios show these decisions without loading a code or customer
record. `canSend` and `canReveal` remain false in every result. This is not a
public portal, token/session authorization, message-history reconciler, live
hold controller or production credential store. Its output must not be used as
an authorization grant. Existing sending/history and ownership checks remain
separate. A hold cannot retract a credential already disclosed elsewhere.

The initial focused test run caught an expected-string mismatch between ISO
representations with and without milliseconds; the assertion was corrected to
compare the normalized release instant. No policy failure was bypassed.
All 1,977 tests passed in 240 suites, including nine new behavioral tests.
Nonincremental TypeScript, targeted ESLint and diff checks passed. Hosted
acceptance for this batch is recorded in draft PR #1714.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, prior commit
`e601eeaf`; remote main verified as
`418b6045f0a44cfce4b6051e7ae99105963a086f`. Changes are the pure access-release
review, its focused tests, the new rehearsal component and insertion in
`HoldRehearsal.tsx`, the inventory update/link and this document. Existing
contract notes remain excluded. No live message, Guesty save, database mutation,
new subscription or production setting change occurred.


### Full workflow obligation review, October 18

The earlier handoff helper covers the six recurring guest/cleaner messages. It
cannot stand in for the full October 17 inventory. The new
`src/lib/calderwood-rehearsal/workflow-handoff.ts` reviews all twenty configured
templates, retaining separate direct-booking SMS/email obligations, both staff
arrival notices, the alteration notice and the Website agreement attachment.
The local template keys are audit identifiers, not Guesty provider template IDs.

Source scope uses explicitly reviewed UI labels only. Website has sixteen
potentially applicable templates, Manual and Direct - stay cape ann fifteen,
and another verified source eleven. These counts include event-dependent
obligations; they do not mean those messages are all pending on a stay. Unknown
source mapping leaves all twenty unresolved. No API-source mapping was invented.
Old history or queued evidence outside a newly selected source scope requires
review instead of silently disappearing.

A caller must provide trusted, validated evidence. Each obligation needs an
occurrence, binding revision and complete recipient set. The binding revision
must represent verified property/source applicability, transport, recipients,
content and any attachment approval; an arbitrary string is not independent
proof. The alteration occurrence must be verified, not generated for every date
change. Actual future times and source expiry must be supplied by a verified
adapter. This module does not calculate or replace Guesty's schedule. It is a
pure internal review contract, not a validator for untrusted HTTP input.

Snapshots bind to property, reservation, booking revision and source, with an
explicit freshness limit and complete history/queue coverage. Each recipient
has separate sent, queued, uncertain and source-sender-stop evidence. Missing,
duplicate, extra or mismatched occurrence/recipient records require review.
Unrecognized templates invalidate the claim of complete inventory coverage.
Sent SMS cannot suppress an unsent email; a partial recipient outcome never
permits a whole-message replay. Current snapshots preserve previously sent
history after a booking revision, while stale snapshots require reconciliation.
Holds survive moves. Queued copies conflicting with held, cancelled, sent or
stopped state require resolution with the existing sender. Due/overdue times and
missing or invalid expiry cannot create catch-up candidates.

The new `WorkflowHandoffRehearsal.tsx` panel is embedded in the protected
Calderwood inventory. Eleven selectable fictional evidence situations expose
all twenty rows, per-recipient differences and source exclusions. It defaults
to unverified source and missing evidence. Its sample timestamps and five-minute
freshness policy are illustrative. It does not read real reservations, call an
API, persist evidence, change a queue or send. Every result has `canSend: false`.
The six-message helper remains available as the earlier bounded rehearsal;
neither helper is connected to the production automation sender.

Validation: fourteen new behavioral tests cover inventory separation, verified
source scope, identity/revision/freshness, per-recipient outcomes, transport
separation, holds/cancellations, source changes, unknown templates, sender drain
and no catch-up. Initial TypeScript and lint checks found a readonly-map deletion
in the fictional fixture builder and an unescaped JSX apostrophe; both were
corrected. The final full suite passed all 1,991 tests in 240 suites;
nonincremental TypeScript, targeted ESLint and diff checks passed. Hosted
acceptance is recorded in draft PR #1714.

Handoff: branch `codex/channex-staging-pilot`, base `a148b0e6`, prior commit
`a645ed18`; remote main verified as
`25a5346a2ce43b0cd08dca9f210ea4a7b3ee7ed8`. This batch changes the full-workflow
review module, its tests, the new review panel, its inventory insertion and this
document. Existing contract notes remain excluded. Production evidence adapters,
recipient bindings, portal behavior, agreement approval, sender ownership and
live channel delivery remain outstanding. No new service, subscription, live
message or production setting is involved.
