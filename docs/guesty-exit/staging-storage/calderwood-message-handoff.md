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
