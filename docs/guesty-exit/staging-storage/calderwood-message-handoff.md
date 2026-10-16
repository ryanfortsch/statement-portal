# Calderwood message handoff rehearsal

Implemented October 13, 2026 in `src/lib/calderwood-rehearsal/message-handoff.ts`.
This pure function reviews synthetic evidence. It does not fetch Guesty records,
change either queue, stop Guesty, persist results, or authorize sending.

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
