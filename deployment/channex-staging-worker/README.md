# Isolated Channex staging worker

Run one persistent container, with automatic restart on failure, built from the repository root using this Dockerfile. No public port is required. Do not deploy this as Helm's application or change its production configuration.

Supply only CHANNEX_STAGING_DB_URL (https://jgkblfozftcvymvwhhii.supabase.co), CHANNEX_STAGING_DB_SERVICE_KEY and CHANNEX_STAGING_API_KEY through the host's secret store. Never copy env files into the image. CHANNEX_WORKER_MODE must be isolated-staging. The database must already be initialized. CHANNEX_WORKER_ONCE=yes performs one cycle and exits nonzero on failure for deployment checks.

Successful cycles poll every minute. Failures back off to 15 minutes. No overlapping cycles within a process. CAS prevents lost storage writes across replicas, but deploy only one replica to avoid redundant ACK requests. SIGTERM stops scheduling new cycles and lets the active cycle finish. Allow at least 120 seconds shutdown grace; a forced stop is recoverable through durable deduplication.

Structured logs expose the last success, received/saved/duplicate/ACK counts and consecutive failures without credentials or booking payloads. Configure the host to alert on sync-failed or missing sync-success for 20 minutes. Helm's cross-process sync-status UI is not implemented yet.

No schema initialization, feed webhook, inventory publishing, automatic reconciliation or production endpoint is called. Provider ACKs are sent only after exact revisions are reread from shared storage. Lost ACK responses are retried through provider redelivery.

Hosting destination and secret provisioning are required before activation. No hosted service has been created by adding these files.
