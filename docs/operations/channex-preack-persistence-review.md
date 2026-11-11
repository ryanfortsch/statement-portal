# Channex November compatibility release (2026-11-10)

The user authorized completing and releasing this compatibility update on November
10. Install the migration and application with ingestion disabled; the migration
refuses an enabled import scope. The inspection-only runtime is unchanged. This
release does not activate booking ingestion, ACK, channel mapping or messaging.

## Contract

The revision now requires a complete explicit nullable projection of customer
name, surname, mail, phone, address, city, state, country and zip, plus booking
notes at the Airbnb provider boundary. Channex confirmed on November 11 UTC that
these fields are always present before ACK, with null for no value. The stored
schema still reads older state-absent projections without rewriting them; such a
receipt cannot satisfy comparison with a new complete provider revision.
Missing, masked (`***`), oversized, structurally invalid or suspicious text fails
closed before persistence/ACK. Never substitute null for an omitted provider field.
Telephone values use a separate format/15-digit bound so legitimate international
numbers survive without changing their formatting. Free-text checks remain a
conservative rejection rule, not a claim to identify all payment information.

Only this allowlist enters the existing private service-only receipt transaction.
Raw message, guarantee, payment objects and arbitrary provider keys are excluded.
No public booking notes/contact copy, UI access, new grants or logging is added.
Independent receipt readback and the pre-ACK refetch compare the complete projection.
Duplicate unmasked delivery returns the original receipt. A masked retry is refused
without changing the receipt; an uncertain ACK must be reconciled, not guessed.
Existing legacy receipts lacking the projection cannot satisfy the new ACK gate.

## Remaining gates before live ingestion

- The November 11 provider reply resolves the field-presence and ACK observation
  contract questions below. Representative live Airbnb delivery remains unverified.
- Security/privacy review must establish retention/deletion and operational access
  for the new PII in receipts. This patch deliberately adds no broader access.
- Text rejection is defense in depth, NOT a PCI/DLP guarantee. Free-text notes can
  contain arbitrary sensitive information and need an approved retention/redaction
  policy before ingestion is enabled. Never retain raw_message/payment data to
  bypass the guard. Suspicious values require review, not automatic sanitization
  and acknowledgement of a changed record.
- Review how legacy receipts, post-ACK masked deliveries and lost ACK responses are
  reconciled operationally. This patch prioritizes preserving the original over
  automatic recovery in an ambiguous state.
- Apply migration and code in a coordinated authorized rollout while ingestion is
  disabled; verify function contract, private permissions and unchanged gates.
  Validate provider staging scenarios before any production activation.
- Capture preserves data but does not yet expose guest details to messaging/UI.
  No completeness/initial-booking-coverage or send authority is granted.

## Feed and rate limits

The bounded revision reader now requests page one without `filter[property_id]`.
This is a single-property pilot with one scoped credential; every response row
still has to match the reviewed property, room and rate before any commit or ACK.
A foreign row stops the whole batch. Do not create one unfiltered feed poller per
property when expanding to multiple properties: dispatch from one account feed.
The reader makes no automatic retry on HTTP 429 or authentication failure. The
production cron remains configuration inspection only; it does not poll bookings
or messages. A future worker must use webhook hints and a centrally bounded
recovery feed, not periodic full booking/revision scans.

## Provider deadlines

Source: Channex's November 10 security notice and
[booking API documentation](https://docs.channex.io/api-v.1-documentation/bookings-collection#masked-booking-message).

| Date | Change | Helm work/status |
| --- | --- | --- |
| 2026-11-16 | Guest contact/address, notes and raw message masked after ACK; property booking emails omit guest contacts; rate limits enter detection mode | Persist the operational projection before ACK, independently read it back, reject masked replacements. No dependence on booking email contact details. |
| 2026-11-30 | Embedded Channex views hide guest contacts | Helm must use its authorized retained records; no iframe contact-data fallback. |
| 2026-12-14 | Rate limits and entity limits enforced; `chx` keys and TOTP available | Unfiltered pilot feed is implemented. Review final webhook/worker request budgets and entity counts before activation. Rotate credentials through server secrets when new keys are available. |
| 2027-01-11 | Channex UI guest/contact-card access requires TOTP | Account owners must enroll and verify recovery access. |
| 2027-02-15 | TOTP mandatory for users; replace legacy API keys by this date | Verify replacement on every active server/worker, then retire old keys. Never store key values in source or this document. |

New key prefix handling requires no client-code prefix change: the existing server
reader accepts explicit credentials without assuming a legacy prefix. This does
not mean rotation or TOTP enrollment has been completed. No recurring reminder or
automatic rotation job is created by this release.

## Tests

Synthetic TS tests cover complete projection, unknown payment/raw-field exclusion,
missing/masked/unsafe details, independent readback mismatch, commit failure,
duplicate/lost-response replay and pre-ACK contact changes. The guarded database
suite uses a fresh temporary loopback PostgreSQL instance with synthetic data only;
it exercises canonical writes, original-receipt replay, masked/payment refusal,
overlap rollback, inventory events and the existing service-only permissions.

## Original notice/example verified November 10

Source email: https://mail.google.com/mail/u/?authuser=ryan%40risingtidestr.com#all/1a1c5ac057e98dd0
Provider example: https://docs.channex.io/api-v.1-documentation/bookings-collection#masked-booking-message

The notice explicitly says existing nulls stay null after ACK. The example mixes
null address/zip with masked populated contact fields and notes, and retains name
and surname. It omits state, although the notice includes state among masked fields.
The original draft missed state; the follow-up fixes that gap without treating
omission as null. Null alone does not prove ACK status, and unchanged names do not
prove a record is unmasked. We refuse any masked retained field and never erase a
prior receipt. Raw_message remains intentionally excluded: this is operational
projection retention, not a claim to archive the full upstream payload.

## GET-only acknowledgment observation (November 10 follow-up)

`src/lib/channex-bookings/acknowledgment.ts` adds an internal, server-only observer
for a lost ACK response. It requires an already committed, unmasked receipt; checks
the reviewed environment/property/room/rate/generation; reads the exact provider
revision; and independently rereads the durable receipt. Only an explicit
`acknowledge_status: acknowledged` plus matching identity, stay, timestamp and
retained projection yields a point-in-time `confirmed` observation. Missing,
unknown or inconsistent evidence remains unconfirmed or requires review.

Documented exact `***` masks can be compared to retained values in a temporary
copy only after explicit provider acknowledgment. Names cannot be masked, null
cannot become a mask, and optional-state absence cannot become null. No provider
value or durable record is modified. The observer makes only bounded GET requests
with fresh deadlines, no caching and no redirects; it does not scan the feed,
retry ACK, commit, send messages, repair a ledger or grant complete coverage.
It is not wired into a production route, worker or activation gate.

On November 10 at 23:54 UTC, the staging read-only check verified the known
fictional certification booking's new, modified and cancelled revisions. Each
reported explicit acknowledgment, masked notes, retained name/surname and explicit
null contact fields (including state). The pre-ACK parser correctly refused each
masked projection, and the Airbnb origin guard continued to reject Offline CRS.
Masking is therefore already observable in staging ahead of the announced date.

Run `scripts/check-channex-staging-contract.mts --read-only` with Node's
`--conditions=react-server` and the existing approved staging credential supplied
outside source control. The script accepts only the fixed synthetic staging
identities and emits field types/mask flags, never values. It performs no writes,
ACKs, feed scans or receipt imports. It refuses production configuration.

This observation is not proof of pre-ACK field completeness, a recovered real
Airbnb ACK, or live channel delivery: these historical Offline fixtures have no
retained pre-ACK receipt in this check. Synthetic tests cover the lost-response
comparison and notes-only masking with null contacts. A November 10 follow-up to
Evan requests confirmation of exact-revision acknowledgment status as the supported
recovery contract, Airbnb omitted/null fields, and possible pre-ACK masking.
Production ingestion remains disabled pending the remaining activation and retention gates.

## Confirmed contract and duplicate-ACK guard (November 11, 2026)

Evan's [reply](https://mail.google.com/mail/u/?authuser=ryan%40risingtidestr.com#all/1a1c91b255b9d276)
confirms that exact-revision `acknowledge_status: acknowledged` is sufficient
provider evidence after a lost successful ACK response. The guest mail, phone,
address, city, state, zip, country and notes fields are present before ACK as null
or a value. After ACK, populated values become `***` and nulls remain null.
Airbnb mail is null; phone is commonly null and may instead be a temporary phone
number for qualifying reservations. Missing mail/phone values are therefore valid
explicit nulls, not permission to invent a guest email or use an SMS fallback.

The existing GET-only observer and the ACK client's preflight now share the same
exact comparison. The client returns without another POST when that preflight
proves the retained revision is already acknowledged, whether populated fields
are masked or all contact/notes fields are null. A differing identity, booking,
mapping generation, stay, timestamp or retained value still fails. The original
receipt and provider input remain unchanged. Missing `state` fails at the Airbnb
provider boundary, including feed, pre-ACK fetch and acknowledgment observation.
The shared non-Airbnb projection and old receipt parser remain compatible.

There is no automatic retry or new recovery scheduler: a lost POST response still
raises an incomplete outcome. Reconciliation must start from the durable receipt
and use the GET-only observer; a deliberate client replay with that same retained
revision also cannot POST again when acknowledged. The ingestion engine's existing
commit plus independent readback gate remains required. This is not a claim of
end-to-end live booking ingestion, complete history, or permission to enable ACK.

Synthetic checks exercise a lost successful POST followed by masked GET recovery,
all-null acknowledged records, pending masks, stale/mismatched identities, missing
state, unchanged originals and the disabled ACK boundary. No production guest
records are imported, no provider ACK is sent, and no database migration is needed.
