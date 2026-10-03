# Isolated Channex staging worker

Run one persistent container, with automatic restart on failure, built from the repository root using this Dockerfile. No public port is required. Do not deploy this as Helm's application or change its production configuration.

Supply only CHANNEX_STAGING_DB_URL (https://jgkblfozftcvymvwhhii.supabase.co), CHANNEX_STAGING_DB_SERVICE_KEY and CHANNEX_STAGING_API_KEY through the host's secret store. Never copy env files into the image. CHANNEX_WORKER_MODE must be isolated-staging. The database must already be initialized. CHANNEX_WORKER_ONCE=yes performs one cycle and exits nonzero on failure for deployment checks.

Successful cycles poll every minute. Failures back off to 15 minutes. No overlapping cycles within a process. CAS prevents lost storage writes across replicas, but deploy only one replica to avoid redundant ACK requests. SIGTERM stops scheduling new cycles and lets the active cycle finish. Allow at least 120 seconds shutdown grace; a forced stop is recoverable through durable deduplication.

Structured logs expose the last success, received/saved/duplicate/ACK counts and consecutive failures without credentials or booking payloads. Configure the host to alert on sync-failed or missing sync-success for 20 minutes. Helm's cross-process sync-status UI is not implemented yet.

No schema initialization, feed webhook, inventory publishing, automatic reconciliation or production endpoint is called. Provider ACKs are sent only after exact revisions are reread from shared storage. Lost ACK responses are retried through provider redelivery.

Activated October 2, 2026 on Render as helm-channex-staging-worker (srv-db05t2id0e5s73a7r8gg), using the staging branch and $7/month compute. Automatic synthetic create/modify/cancel ingestion was verified. See docs/guesty-exit/channex-staging-pilot.md for evidence and outstanding dependency hardening, restart tests and monitoring.

The image installs its own locked dependency set (Supabase JS 2.117.2), not Helm's root dependencies. Audit this directory independently. This does not remediate the main application dependency audit.

## Message polling

Source 477944fe adds an independent message loop alongside booking polling. Apply `docs/guesty-exit/staging-storage/messages.sql` only on the fixed staging project before deploying it; verify with the rollback-only `verify-messages.sql`. No new credential is needed. Each unit's saved message state has its own success/failure timestamps. `message-sync-success`, `message-sync-failed` and `message-health-save-failed` logs contain counts/unit only, never message text. The preview message reader accesses saved state, not Channex.

One replica only. Messaging has no webhook or outbound operation. Empty successful scans establish polling/storage connectivity, not actual OTA delivery. Archives preserve omitted messages and are bounded (20 fetched threads/cycle, 100 retained threads and about 1 MB/unit). Limits fail visibly and preserve prior data. Previous worker 08159552 can be redeployed to return to booking-only polling; retain the message tables for recovery.
