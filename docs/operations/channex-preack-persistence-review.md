# Pre-ACK guest persistence proposal (2026-11-10)

Offline review branch only. Do not activate ingestion, apply migrations, push a
preview, or deploy as part of this patch. The inspection-only runtime is unchanged.

## Contract

The revision now requires a complete explicit nullable projection of customer
name, surname, mail, phone, address, city, country and zip, plus booking notes.
Missing, masked (`***`), oversized, structurally invalid or suspicious text fails
closed before persistence/ACK. Optional-field omission semantics must be verified
against current provider documentation and representative synthetic fixtures before
activation; do not substitute null for absence without that verification.

Only this allowlist enters the existing private service-only receipt transaction.
Raw message, guarantee, payment objects and arbitrary provider keys are excluded.
No public booking notes/contact copy, UI access, new grants or logging is added.
Independent receipt readback and the pre-ACK refetch compare the complete projection.
Duplicate unmasked delivery returns the original receipt. A masked retry is refused
without changing the receipt; an uncertain ACK must be reconciled, not guessed.
Existing legacy receipts lacking the projection cannot satisfy the new ACK gate.

## Review gates before rollout

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
  disabled; then validate staging before any production activation.
- Capture preserves data but does not yet expose guest details to messaging/UI.
  No completeness/initial-booking-coverage or send authority is granted.

## Tests

Synthetic TS tests cover complete projection, unknown payment/raw-field exclusion,
missing/masked/unsafe details, independent readback mismatch, commit failure,
duplicate/lost-response replay and pre-ACK contact changes. The guarded database
suite uses a fresh temporary loopback PostgreSQL instance with synthetic data only;
it exercises canonical writes, original-receipt replay, masked/payment refusal,
overlap rollback, inventory events and the existing service-only permissions.
