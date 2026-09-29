# Calderwood read-only pilot

Access: Helm → Channels → 65 Calderwood · Read-only pilot (`/channels/pilot`).

Scope: authenticated calendar, reservation details, imported-record comparison, feed metadata and JSON baseline export. The loader performs property-scoped SELECTs only, uses stable pagination, allowlists fields and reports each unavailable source. It does not call Guesty or any OTA. Guesty copies are evidence, not authoritative cancellation signals.

This release excludes staging connector controls, migrations, credentials, production settings, booking writers, payment code, messaging senders and changes to calendar authority. Existing Channels routes stay intact. No customer records or environment files are part of this branch.

The baseline is incomplete: live rates/restrictions, policies, balances/refunds, message history, scheduled messages and local operational procedures still need verification. Empty calendar space is not verified availability. Review discrepancies manually; never infer cancellations from missing rows.

Validation: current-main integration, npm test, TypeScript, targeted ESLint, and synthetic UI checks performed during development. Authenticated live-data rendering must be verified after an authorized release. Prior local data counts are not release validation.

## Read-only inbox

`/channels/pilot/inbox` adds a three-pane conversation view with search and exact reservation links. Staff session checks run before reads. Guesty conversations use existing Stay Concierge GET endpoints and exact current/former property listing IDs; native threads are queried with the Calderwood property filter. A requested conversation must be in that server-scoped list before history is fetched. Names and dates never establish identity. Native/Guesty histories remain separate.

The first version covers the recent 60-day source window and up to 200 messages. Archived native threads, attachments, complete historical coverage and unmatched reservation links remain limitations. Errors are explicit and neither source failure is treated as proof of an empty inbox. There is no composer, mark-read operation, send action or schedule change. Existing messaging is untouched.

Validation uses synthetic fixtures only: exact property scoping, foreign URL IDs, ambiguous/broken alias chains, missing reservation context, search, thread selection, source failures and mobile layout. Live signed-in conversation content has not been verified by this change.
