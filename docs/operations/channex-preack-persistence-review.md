# Channex November compatibility release (2026-11-10)

The user authorized completing and releasing this compatibility update on November
10. Install the migration and application with ingestion disabled; the migration
refuses an enabled import scope. The inspection-only runtime is unchanged. This
release does not activate booking ingestion, ACK, channel mapping or messaging.

## Contract

The revision now requires a complete explicit nullable projection of customer
name, surname, mail, phone, address, city, country and zip, plus booking notes. State is preserved when present (including
explicit null); absence remains absence because the published example omits it.
Missing, masked (`***`), oversized, structurally invalid or suspicious text fails
closed before persistence/ACK. Optional-field omission semantics must be verified
against current provider documentation and representative synthetic fixtures before
activation; do not substitute null for absence without that verification.
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

- Confirm provider field names and explicit-null vs omitted-field semantics.
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
