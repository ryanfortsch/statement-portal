# Calderwood Channex cutover readiness

Prepared October 5, updated October 6, 2026. Status: preparation approved; NOT READY to disconnect.

## Scope and evidence

The user selects Ryan's Airbnb account and 65 Calderwood as the replacement pilot.
October 4 Guesty screenshots show Ryan's account connected with 1/1 listing,
65 Calderwood; Allie's account is separate with 21/23 listings. The user confirms
Ryan owns Calderwood. The October 5 live Guesty audit below confirms the full
listing ID and account listing count. Airbnb host ID and direct owner-account
verification remain pending. Do not treat Guesty aliases as Airbnb logins.

This replaces the proposed 17 Beach live pilot. Keep the Beach staging fixtures and
linked-inventory tests intact. No support outreach is required to continue preparation.
No disconnect, OAuth grant, mapping, production activation, message send or migration
has been performed as part of this audit. Allie's connection stays outside scope.

## Source audit at 7e609334

| Area | Evidence | Required before cutover |
| --- | --- | --- |
| Account isolation | User confirmation and supplied Guesty screenshots | Fresh owner/host/listing identity check, plus complete Ryan account listing inventory |
| Connector | `src/lib/channex-staging/pilot-reader.ts` fixes staging host and allows front/back only | Separate Calderwood production configuration with explicit host/property/room/channel/listing allowlist; preserve test guards |
| Reservations | Reader returns snapshots with inventoryAuthority false | Durable revision ingestion, acknowledgement after persistence, deduplication, cancellation/change handling, reconciliation and outage recovery |
| Messages | Separate archive and inactive GET-only worker exist | Calderwood source identity, history coverage, incoming delivery and controlled outgoing delivery; no duplicate automation |
| Pricing | Beach synthetic stopped rate is not production pricing | Capture Calderwood rates/restrictions and designate one writer for each; verify PriceLabs mapping if used |
| Runtime | Dedicated Airbnb reader requires Beach-specific activation flag | Separate deployment/configuration and observable successful polling; historical tests are not live readiness |
| Provider access | No production certification/access evidence in this audit | Verify production account/API availability and required certification from account/docs |
| Other channels | Not audited for Calderwood | Inventory Vrbo, direct and other sales paths; maintain one availability authority and preserve their reservations |
| Helm dependencies | CLAUDE.md describes Guesty reservation/review sync and message workflows | Trace turnovers, locks, guest automation, statements and existing booking IDs to avoid silently starving downstream modules |

Do not turn the current staging reader into a production writer by changing its URL.
Do not reuse the $100 Beach test rate or front/back archive rows for Calderwood.

## Ordered preparation backlog

1. Read-only baseline: owner/listing IDs, all upcoming and in-progress reservations,
   alterations/cancellations, pending requests, independent blocks, booking horizon,
   rates, fees, restrictions, policies and scheduled messages. Store guest records
   only in approved private storage, never in this document or a PR.
2. Build a Calderwood configuration boundary and migration comparison report.
   Missing identity or incomplete baseline must keep activation unavailable.
3. Implement and test the durable booking path and downstream identity mapping.
   Rehearse duplicate/out-of-order revisions, missed events, restart and failure.
4. Prove messaging and pricing ownership, then production connection readiness.
5. Review a dated cutover packet with explicit affected account/listing IDs,
   baseline freshness, discrepancy counts, operator and containment procedure.
6. Only then execute the approved Ryan-account disconnection and Channex connection,
   preserving the existing Airbnb listing. Reconcile before reopening sales.

## Acceptance and containment

Every current/future stay and independent block must match; unexplained differences
block opening. Rates and restrictions must match the chosen policy throughout the
published horizon. Incoming messages must arrive once and remain associated with
correct reservations; existing schedules must have exactly one sending owner.

Before disconnect, establish a verified way to close sales temporarily without
cancelling reservations. Do not assume disconnecting Guesty closes Airbnb sales.
On missing bookings, wrong mappings, unexpected availability or stale ingestion,
contain sales, stop competing publishers and reconcile provider state. Guesty
reconnection is a recovery procedure to prove, not an instantaneous undo guarantee.
Never restore an old calendar over reservations received during the transition.

Calderwood success proves the core account migration. It does not prove Vrbo,
17 Beach parent/child inventory or replacement of all Guesty accounting functions.
Expand by owner account only after those additional requirements are demonstrated.

## Audit record

Owned branch: codex/channex-staging-pilot, source checkpoint 7e609334.
Remote main read October 5: 0963f3ce6d6c1a3058b3a5f3ffa5a44ac25e7501.
Existing branch intentionally retained; no rebase or other checkout edits.
Documentation-only preparation. No application tests rerun and no claim that the
historical 1,750 passing tests establishes production readiness.
Related historical evidence: [Airbnb readiness](airbnb-connection-readiness.md),
[staging implementation](channex-staging-pilot.md).

## October 5 live read-only baseline, partial

Observed in Guesty distribution and property screens in the authorized browser:
- Ryan account: Connected, 1/1 listing. Allie remains separately connected, 21/23.
- Calderwood Airbnb ID: 895455360892927934; Connected and Bookable.
- Guesty property ID: 66797ba7f51d72001388bc29.
- Single-unit house, occupancy 6, 1,300 sq. ft.
- Channel panel explicitly says 3 channels connected: Airbnb, Booking.com and Vrbo.
  Vrbo listing 3434670; Booking.com slug charming-beachside-home. These connections
  do not by themselves establish current availability on the remote channels.
- Base weekday/weekend rate USD350. This is not a nightly calendar export.
- Default cleaning USD300/stay; Airbnb cleaning override USD350/stay.
- Extra-person label: from the 4th person, USD35/night. Confirm exact included-guest
  semantics on Airbnb before mapping; do not infer from this label.
- Security deposit USD200/stay; weekly and monthly discounts both 0%.
- Accommodation markups: Airbnb18.34%, Booking.com22%, Vrbo8%, direct0%.
  Preserve resulting channel prices; do not blindly layer markups over already
  marked-up rates.
- Child policy displays a EUR0 amount despite property USD. Scope/applicability
  unverified; do not propagate this UI value as a universal rule.

New cutover dependency: moving Airbnb alone leaves the same physical inventory
sold through Guesty on other channels. Before opening Channex inventory, either
prove cross-provider availability coordination or temporarily stop new sales on
the other channels with user approval while honoring their existing bookings.
A displayed channel link or an iCal copy does not prove immediate coordination.

No settings were saved, connections removed, exports emailed or guest messages
sent. Full nightly rates/restrictions, future reservations/holds, scheduled
messages, host ID, production Channex access and downstream dependencies remain
unverified. This is a partial settings baseline, not a complete migration backup.

## October 6 live read-only policy and automation baseline

Observed in Guesty property policies, availability and message workflows. No
settings changed and no messages sent.

- Check-in 4 PM, check-out 11 AM; check-in end flexible.
- Children and infants allowed; pets, smoking and parties not allowed.
- Airbnb and Booking.com show instant booking.
- Airbnb cancellation: Firm, 7 days before check-in. Vrbo: Strict, 60 days before.
  Booking.com/manual/online booking rate-plan policies remain unverified.
- Default availability: available always; booking window 365 days.
- Advance notice: 1 day for direct, Airbnb, Booking.com and Expedia.
- Default minimum 3 nights, maximum 91 nights. These are Calderwood defaults,
  not the Beach pilot's 20-night rule. Date overrides remain unverified.
- Preparation time, check-in restrictions and annual night limit show undefined.
- Airbnb auto-response enabled: first non-confirmed inquiry, 45-minute delay.
  Subsequent inquiry and confirmed-stay response categories show disabled.
- Enabled Calderwood Messaging workflow: reservation confirmation 30 minutes
  after confirmation; check-in instructions 1 day before check-in; key-code
  message 60 minutes before check-in; check-out message 1 day before check-out.
  Workflow reports all channels with three exclusions; exact exclusions not yet
  inspected. Confirmation message sends through the booking channel.
- Enabled Calderwood cleaning workflow: reminder 10 days before check-in and
  check-in-day message 7 hours before check-in. The reminder sends by SMS to a
  phone-book contact. Do not treat channel messaging as a replacement for SMS.
- Other enabled workflows apply to all properties, including staff messages,
  rental agreement and direct booking. Their channel conditions and Calderwood
  applicability still require inspection before declaring the schedule complete.

Message template bodies, access codes and contact details are intentionally not
copied here. Workflow timings do not establish which individual reservation
messages are currently queued. Existing bookings need a separate queue handoff,
with exactly one sending system per event and no replay of already-sent messages.

Next baseline work: date-specific rates/restrictions, future stays and independent
holds, actual queued messages, global workflow conditions and pricing publisher.
Then implement Calderwood identity/configuration and comparison in the isolated
pilot. Current staging code is still scoped to Beach and must not be activated
against Calderwood by changing a URL or reusing the test rate.


## October 6 calendar and pricing follow-up

Read-only Guesty monthly calendar observations establish that property defaults
are not an adequate migration payload:

| Date | Displayed nightly rate (USD) | Displayed minimum nights |
| --- | --- | --- |
| 2026-10-07 | 274 | 2 |
| 2026-10-08 | 318 | 2 |
| 2026-10-25 | 396 | 2 |
| 2026-11-01 | 368 | 1 |
| 2026-11-13 | 439 | 3 |
| 2026-11-28 | 564 | 3 |

These are dated UI spot checks, not quoted guest totals or a complete export.
Do not infer availability from a price label or an empty calendar cell. A calendar
bar does not establish booking status, channel, checkout semantics or block origin.
Customer names and booking details are not retained in this document.

Guesty Marketplace shows PriceLabs Connected at the account level. Its property
selection, current Calderwood sync status and last successful publish have not
been verified. The integration page says daily rates and minimum nights are
updated from PriceLabs. It also says optional arrival/departure restrictions may
be sent to channels without appearing in Guesty's check-in/out settings. Therefore
an undefined Guesty restriction is not evidence of unrestricted remote inventory.

Sources observed in the authorized UI:
- Guesty property monthly-calendar page for 66797ba7f51d72001388bc29, October and November 2026.
- Guesty integrations/partners list and integrations/partners/pricelabs detail.

### Selected pilot scope: keep all channels open

On October 6 the user explicitly selected keeping all channels open and building
coordination before switching Airbnb. No stop-new-sales plan is selected.
Guesty continues serving its existing channels until a tested replacement is ready.

The required coordination path is:
1. Normalize authoritative Guesty and Channex bookings, alterations, cancellations
   and independent blocks into a durable source-identified ledger. A fetched
   booking creation timestamp is not a revision ordering authority.
2. Preserve links between imported copies of the same reservation using stable
   provider IDs and explicit mapping. Never deduplicate by guest name or dates.
3. Compute occupied nights as the union of active reservations and independent
   holds, with checkout excluded. A cancellation removes only its own claim.
4. Track every coordinator-created remote block separately from independent
   blocks. Echoed blocks must not create a feedback loop; unknown provenance must
   not authorize reopening inventory.
5. Reconcile complete snapshots and recover missing/out-of-order events. Retain
   restrictions after ambiguous provider writes until read-back proves state.
6. Prove delivery, read-back, retry and outage handling before allowing writes.
   An asynchronous bridge cannot promise atomic booking across providers. Define
   conflict detection, escalation and a user-approved emergency containment
   procedure before cutover; do not silently pause channels as normal operation.

The existing Beach ownership planner is synthetic, scoped to whole/front/back and
fixed test dates. Its useful invariants can inform Calderwood tests, but it is not
an existing production coordinator. Build Calderwood rehearsal separately; do not
weaken the current worker's source guards or activate its synthetic ACK path.

### Next implementation acceptance criteria

The Calderwood comparison must be independent of Beach's synthetic configuration:
- Pin Guesty property and Airbnb listing identity; unresolved host, Channex
  property/room/rate/channel identity must remain visibly incomplete.
- Compare each night in the intended published window, distinguishing missing
  data from open inventory and default rules from effective per-date rules.
- Match reservations by stable source IDs and retain independent block provenance.
  Never match solely by guest name, dates or calendar-bar appearance.
- Report missing nights, changed prices/minimums, unexplained holds, unknown
  restrictions, duplicate identity and stale snapshots as separate discrepancies.
- A clean comparison is evidence for review, never an automatic permission to
  disconnect, publish, send messages or reopen inventory.

Documentation checkpoint: main reference read October 6 was
ddaed715bfef16cbf0ec5f1cf1516ef9ab4ebf53. Existing isolated branch retained.
No application code or external settings changed. Full documentation review,
referenced local path checks and git diff --check are the relevant validation;
application tests are not required for this documentation-only change.

## October 6 isolated coordination rehearsal

Implemented `src/lib/calderwood-rehearsal/coordination.ts`, with seven synthetic
scenario tests in `src/lib/__tests__/calderwood-coordination.test.ts`. No route,
worker, database, provider credential or live publishing path imports this module.
Recoverable prior checkpoint: 76046854. Main reference checked before this work:
e4bb9782fc352cc03a1319f7359a8a0b497d544f. Branch remains codex/channex-staging-pilot.

The rehearsal retains append-only source-identified events, rejects conflicting
revision identities, ignores late older revisions for current state, and computes
occupied nights from reservations, independent holds and unknown blocks. Checkout
is exclusive. Missing/incomplete/stale/future coverage withholds clear results.
Multiple reservation claims are flagged for identity/conflict review, never merged
by matching dates. Every result is non-executable; an empty night is only clear for
review, not an instruction to publish availability.

Validation: 1,757 tests passed, including seven new scenarios; targeted ESLint
passed. The initial TypeScript run could not write its incremental cache because
of workspace permissions; npx tsc --noEmit --incremental false then passed. No provider calls or live settings changed.

Limitations: synthetic numeric revision ordering is not a provider revision policy.
The replay test serializes/reloads memory, not a hosted crash/restart. There is no
persistent ledger, verified duplicate-import mapping, coordinator-block receipt or
echo suppression, price comparison, transport retry or inventory writer yet. The
next implementation is source mapping and durable reconciliation, with ambiguous
block origins retained rather than reopened. This does not establish production
coordination or eliminate simultaneous-booking races.

## October 6 local durable rehearsal history

Added `src/lib/calderwood-rehearsal/store.ts` and six tests in
`src/lib/__tests__/calderwood-store.test.ts`. Explicit initialization refuses an
existing file; missing/corrupt history cannot silently become an empty calendar.
Writes use the existing exclusive local lock, expected-version checks, a private
0600 temporary file, file sync, atomic rename and directory sync. Duplicate retries
do not advance the version; a stale expected version requires a reload. Freshness
is deliberately not persisted as an enduring permission to clear inventory.

Validation: 1,763 tests passed; TypeScript without incremental caching, targeted
ESLint and diff checks passed. Separate child processes exercise exit after a
completed durable append and death while holding the lock. The former replays
idempotently; the latter retains the lock for explicit recovery. Tests use only
private temporary directories and synthetic events. No production files or
credentials are loaded.

This is local-filesystem rehearsal storage, not hosted/shared storage. It does not
prove power-loss durability, a crash at every write boundary, provider delivery or
cross-host concurrency. Mid-write failure can require operator review; no automatic
lock stealing or live ACK occurs. Authoritative provider-event mapping, durable
shared deployment and block receipt/echo handling remain next. No existing worker,
API route, database schema or channel setting changed.

Prior recoverable checkpoint: 3b262d71. Main reference checked before this increment:
5a012a09680d41bf074acf029c17cb6f6077d974. Same isolated pilot branch and PR #1714.
