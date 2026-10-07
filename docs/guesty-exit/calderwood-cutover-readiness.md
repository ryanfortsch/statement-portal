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

## October 6 Guesty read-only adapter, not activated

Added `src/lib/calderwood-readonly/guesty-reader.ts` and five contract tests in
`src/lib/__tests__/calderwood-guesty-reader.test.ts`. The adapter pins the verified
Calderwood Guesty listing and Airbnb listing IDs. Channex mapping remains null;
no property, room or host ID is invented.

The official legacy search reference points to
https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_searchreservations
at GET /v1/reservations-v3/search. Its documented response uses reservationId,
localized dates on each stay, and pagination.hasMore. The new adapter uses that
contract rather than silently reusing the legacy reservation shape. It requests a
bounded date window and fixed listing ID, includes all statuses, validates every
single-stay identity, rejects duplicate/incomplete pages and withholds raw errors.
Only reservation ID, listing ID, local dates, status and source are returned.
Multi-stay reservations require manual review; no date-slicing UTC fallback exists.

Results explicitly distinguish completed pagination from an incomplete migration
baseline. They have no revision authority, no block coverage, no Channex comparison
and no publishing capability. List pagination is not an atomic snapshot; missing
rows never imply cancellation. No live-to-synthetic event conversion is provided.
The current Guesty token helper can update Helm's production auth cache, so it is
not imported into this isolated adapter. The adapter requires an explicit server
access token and neither reads environment files nor provisions credentials.

Validation: 1,768 tests, TypeScript without incremental caching, targeted ESLint
and diff checks passed. Tests use synthetic response fixtures derived from the
published schema, not captured customer records. No actual Guesty API read, database
write, route activation or live comparison occurred. The isolated worktree has no
Guesty credential configured; only its existing Channex staging credential exists.
The user was asked how to arrange secure Guesty access, without pasting secrets.
Shared staging snapshot persistence remains unimplemented; no schema was applied.

Recoverable prior checkpoint: 723a94d2. Main reference checked before this increment:
b3c318cfabd853033a6004e6295461675aace6b1. Existing branch and draft PR #1714 retained.

## October 6 approved existing-connection wiring

The user approved reuse of Helm's existing Guesty connection. Added a staff-only
page at /channels/staging/calderwood and a dependency-injected access boundary.
It refuses production, other branches, disabled staging and non-staff sessions
before acquiring a token. Date-window validation also precedes credential access.
A manual GET form triggers a fixed-property snapshot; initial page load does not
call Guesty. The view shows minimal reservation identity/dates/status/source and
explicitly identifies the absent Channex mapping and incomplete baseline.

The page reuses getGuestyToken server-side. That existing helper may refresh its
normal credential cache in Helm's database; no new credential is copied into the
pilot or exposed to the browser. No booking, calendar, channel or messaging writer
is called. Raw provider/auth errors are withheld. The page is dynamically rendered
with no provider fetch cache, and remains behind the existing proxy and staff auth.

Validation: 1,771 tests passed, including denial-before-token and secret-redaction
checks. TypeScript and targeted lint results are recorded in the handoff. Hosted
credential availability and actual returned reservations still require verification;
code wiring alone does not prove a live import. Shared snapshot persistence remains
pending. No local preview was attempted. Previous recoverable commit: fef89bf6.

Follow-up validation: the initial page commit had environment-type and Next Link
lint errors. Fixed both immediately; TypeScript, targeted lint and all 1,771 tests
then passed. The unverified initial commit is not the accepted source checkpoint.

Hosted verification at source commit 54c44f2f: GitHub verify/layout checks and
Vercel deployment passed. The authenticated pilot page rendered, and its manual
Guesty read returned 11 reservation records for 2026-10-06 through 2027-01-04
(exclusive), completed at 2026-10-06T18:07:13.919Z. Only the count and window are
recorded here; customer records were not copied to documentation. This proves a
live fixed-property read through the existing server connection, not complete
availability, cross-provider comparison, shared persistence or cutover readiness.
No calendar/channel changes or guest messages were made.

## October 6 calendar and pricing review

Extended the approved manual Guesty read with the fixed Calderwood calendar GET.
The UI's exclusive end is converted to Guesty's inclusive last calendar date.
Every day must match the fixed listing and requested window; duplicate dates fail.
Missing dates remain visible gaps. Rates, currency, minimum nights, CTA/CTD,
request-to-book, allotment, block classifications and reservation references are
allowlisted. Nested guests, payout data, creator identities and free-text notes
are discarded. Multiple block reasons survive, including manual holds beside
reservations. Unknown classifications and missing restriction fields require review.

The comparison checks exact reservation references and checkout-exclusive dates,
flags overlapping confirmed records and unexplained unavailable nights, and never
publishes availability. A failed calendar read leaves the reservation snapshot
visible with an explicit calendar failure. Reads are sequential, not atomic;
these are Guesty posted rates, not proof of PriceLabs or OTA delivery. No persistence,
channel writes, messaging sends or production deployment is part of this increment.

Contract references:
- https://open-api-docs.guesty.com/reference/get_availability-pricing-api-calendar-listings-id
- https://open-api-docs.guesty.com/docs/calendar-block-types

Validation before commit: 1,777 tests passed; non-incremental TypeScript, targeted
ESLint and diff checks passed. Synthetic tests cover date coverage, fixed GET,
identity mismatch, private-field removal, overlapping blocks, reference mismatch,
checkout boundaries and partial failure. Hosted verification remains pending.
Recoverable prior version: 2023b13c. Current main reference checked:
e9cb232b2da53ad65c8e33712a5c2a5b516e6e46. Existing draft PR #1714 retained.

Hosted calendar verification at 5a68a8ce: Vercel deployment passed. The staff-only
page returned 90 calendar nights, zero missing dates and zero nights flagged by
the implemented diagnostic checks, alongside 11 reservation records, for the
2026-10-06 through 2027-01-04 exclusive window. No manual/owner/iCal hold label
was visible in this window, so preservation of those overlapping classifications
is covered by synthetic tests rather than demonstrated by a live hold here.
Posted prices and required restriction fields passed normalization. Customer
records and rates are not copied into this log. This is a Guesty-side snapshot,
not proof of PriceLabs delivery, independent channel agreement or safe cutover.

## October 6 isolated Channex property mapping

Created and read back in the existing Channex staging account through its UI:

| Identity | Value |
| --- | --- |
| Property | `30584a9a-8784-4eb1-a387-e26bd43aec1c` |
| Property title | 65 Calderwood - Isolated Staging |
| Room type | `f795ae2c-f47d-4751-86ff-e883b6d30800` |
| Room title | 65 Calderwood - Whole Home |
| Rate plan | `7f95b731-ff05-4c41-99c9-f39b3e772fec` |
| Rate title | TEST ONLY - Calderwood - CLOSED - $100 placeholder |

Single rentable unit, six adult-compatible guest spaces, no separate child/cot
spaces configured. Property currency USD, timezone America/New_York, Holiday Home,
Gloucester, Massachusetts. No precise address, guests or live booking data uploaded.
Automatic availability adjustment on modified/cancelled bookings was disabled at
creation. New-booking reduction is mandatory in Channex. The rate is per-room,
USD100 synthetic placeholder, arrival/through minimums 1; stop-sell checked on all
seven weekdays and verified by reopening the saved rate. These are test settings,
not migrated Calderwood production policy. No cancellation policy or tax set copied.
The Calderwood-filtered Channels page explicitly showed no channels.

The existing saved staging API key returned HTTP404 on a fixed GET for this new
property. That result alone is not proof of absence; the authenticated UI confirms
the property exists. The saved key was originally scoped to Beach only. API scope
expansion to only this staging property was requested and remains pending approval.
No key was printed, copied or changed. No API reader/configuration has been switched
to these IDs yet, and no two-provider comparison or live Airbnb mapping is claimed.

Only staging UI configuration and this documentation changed. Prior code checkpoint
73bfe96b remains recoverable. Documentation diff check passed; application tests
were not rerun for this documentation-only increment. Existing PR #1714 retained.

### Approved staging key scope, October 6

The user approved adding Calderwood staging to the existing key. Updated only
its explicitly selected property set: the original Front/Back test properties plus
`30584a9a-8784-4eb1-a387-e26bd43aec1c`. Reopened the saved editor and confirmed
Only Selected, 3 of 3. All-properties access remains off; existing IP settings,
key value, name and credential storage are unchanged.

Using the existing privately stored key, fixed-host GET requests for the exact
property, room and rate IDs each returned HTTP200. Response allowlists confirmed
USD, America/New_York, one room, adult capacity six, exact property/room
relationships and all seven stop-sell values true. Only configuration identifiers
were output; no raw response bodies, secrets or booking records were logged.
This completes API access verification, not calendar parity or live OTA mapping.
No rates, availability, bookings or messages were written through the API.
Documentation-only diff check; no application source changes or new test run.

## October 6 two-provider read-only comparison

Added a separate Calderwood Channex GET-only adapter. It verifies exact property,
room and rate identities/relationships, USD/New York, six spaces, per-room pricing,
all-week stopped defaults and an explicitly empty channel collection before ARI
reads. It rejects unexpected inventory keys/dates and warning/error envelopes.
Missing nightly values remain null; property defaults are not substituted for
missing daily evidence. The user-approved existing key stays server-side.

The manual staff preview now compares each Guesty night with Channex staging:
posted rate/currency, arrival minimum, CTA/CTD and coarse closed/open state. Counts
separate missing evidence, differences and unverified stop-sell. Through-stay and
maximum-stay semantics remain unverified. Placeholder differences are expected;
this never asserts complete parity or executable availability. A Channex failure
leaves Guesty results visible and reports staging verification failure. Neither
provider receives a write. No customer booking records are copied to Channex.

Reference: https://docs.channex.io/api-v.1-documentation/ari

Validation: 1,782 tests, TypeScript, targeted ESLint and diff check passed. An initial
synthetic fixture cast failed TypeScript; replaced it with an extra-key mutation
and reran all checks successfully before commit. The actual fixed staging GET
reader returned 90 nights, all stopped, no missing prices, for October 6 through
January 4 exclusive. Hosted combined comparison verification remains pending.
Prior recoverable checkpoint e83bae63; base a148b0e6; current main reference checked
at e9cb232b2da53ad65c8e33712a5c2a5b516e6e46. PR #1714 retained.

Hosted combined verification at 42f1155e: the authenticated preview rendered
90 compared nights, 90 with differences, zero with missing evidence and zero
without verified stop-sell, alongside 11 reservation records. Comparison window
2026-10-06 through 2027-01-04 exclusive. The staging read completed at
2026-10-07T00:36:28.059Z. Placeholder differences are expected and were not
automatically corrected. No customer records/rates are retained in this log.
Vercel preview build passed. No local browser preview, provider writes or
production deployment occurred.

### Stopped nightly proposal (2026-10-06)

- Added a pure, display-only proposal above the provider comparison. Candidates use positive USD posted rates with cent precision and explicit arrival/departure restrictions; every candidate fixes inventory at zero and stop-sell on.
- Guesty minimum is displayed as unmapped. Existing staging arrival/through minimums and maximum stay are preserved. Request-to-book translation remains unresolved. No writer, apply action, exported provider payload or persistence was added.
- Exact staging mapping and full date coverage are required; missing evidence, unknown blocks, calendar discrepancies and non-stopped baseline nights withhold candidates. Status never claims executable or migration-ready.
- Validation: 1,786 tests passed, nonincremental TypeScript passed, targeted ESLint passed, diff whitespace check passed. Synthetic tests cover preserved restrictions, stopped output, missing/duplicate/extra dates, bad rates, source discrepancies and mapping changes.
- Recoverable prior commit: `0691ada9`. Hosted verification pending at this entry. Live channel settings and production remain unchanged.

### Hosted proposal verification (2026-10-07 UTC)

- Source `be98ceae` verified in the authenticated hosted preview for 2026-10-06 through 2027-01-04 exclusive: 90 reviewed nights, 90 complete candidates, status awaiting restriction review. Expanded nightly details visibly show inventory zero, stop-sell on and unmapped Guesty minimums with staging stay restrictions retained.
- Underlying provider comparison remains 90 nights, zero missing evidence and zero nights without verified stop-sell. Staging read completed 2026-10-07T00:47:58.770Z. This is sequential snapshot evidence, not atomic parity or live migration approval.
- Vercel preview build passed; GitHub CI run 37553552848 completed successfully. Screenshot inspected locally at `/tmp/calderwood-stopped-proposal.jpg`; no live rate values committed to documentation.
- Next: establish minimum-stay mapping semantics and test them before any proposed provider write. Production, live channel connections, messages, database and worker were unchanged.
- This verification entry is documentation-only; complete diff and whitespace checked, application checks remain those run on source `be98ceae`.

### PriceLabs pricing ownership and direct connector (2026-10-07 UTC)

User clarified that PriceLabs owns dynamic minimum stays. The previous nightly
proposal is a diagnostic snapshot, not the intended ongoing pricing writer.
Target direction: PriceLabs sends rates and supported restrictions directly to
Channex; Helm monitors delivery and coordinates inventory without overwriting
PriceLabs-owned fields. Existing PriceLabs-to-Guesty sync remains enabled.

Evidence: [PriceLabs Channex integration guide](https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-channex)
confirms dynamic rates, minimum stays and check-in/out restrictions up to 540 days,
per-room pricing only, parent rate plans, and a Price and Restrictions update
option. It explicitly warns that PMS pricing pushes can override PriceLabs.
It also notes direct bookings are not received via this API, requiring separate
reservation input for that information. [Portfolio Analytics availability](https://help.pricelabs.co/portal/en/kb/articles/portfolio-analytics-integrations)
lists Channex as unsupported. Reservation feedback and occupancy-dependent
behavior therefore require an explicit test, not just outbound rate parity.

Read-only browser check: Calderwood's existing Guesty-linked PriceLabs listing
has price sync enabled and dynamic lead-time minimums. Inspected the actual
Add/Re-import Listings > Channex form: API Key field and Connect button, with no
visible environment selector. No key entered, connection created, sync triggered,
settings saved or existing listings remapped. Sandbox compatibility remains
unverified; do not infer it from the presence of the connector.

Next experiment: establish the connector environment, then use a dedicated key
scoped only to an isolated Calderwood property with no channels. Review imported
rate plan selection and inherited/custom settings before enabling any sync.
If production-only, prepare an isolated production Channex property separately;
this entry does not authorize production creation or credential sharing. Verify
rates, minimum-stay interpretation, date overrides, gap rules, subsequent updates,
and reservation feedback before any Airbnb cutover. Keep Guesty routing active
throughout. No support outreach requested or sent.

Documentation-only update: diff/whitespace review; no application source changes
or repeated application tests. Local setup screenshot: /tmp/pricelabs-channex-setup.jpg.
