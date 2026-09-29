# Calderwood read-only pilot

Access: Helm → Channels → 65 Calderwood · Read-only pilot (`/channels/pilot`).

Scope: authenticated calendar, reservation details, imported-record comparison, feed metadata and JSON baseline export. The loader performs property-scoped SELECTs only, uses stable pagination, allowlists fields and reports each unavailable source. It does not call Guesty or any OTA. Guesty copies are evidence, not authoritative cancellation signals.

This release excludes staging connector controls, migrations, credentials, production settings, booking writers, payment code, messaging senders and changes to calendar authority. Existing Channels routes stay intact. No customer records or environment files are part of this branch.

The baseline is incomplete: live rates/restrictions, policies, balances/refunds, message history, scheduled messages and local operational procedures still need verification. Empty calendar space is not verified availability. Review discrepancies manually; never infer cancellations from missing rows.

Validation: current-main integration, npm test, TypeScript, targeted ESLint, and synthetic UI checks performed during development. Authenticated live-data rendering must be verified after an authorized release. Prior local data counts are not release validation.
