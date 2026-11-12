# Portfolio market imports

The existing PriceLabs subscription provides a separate neighborhood comparison
for each listing. Helm reads that listing's selected comparison set through the
official MCP connector. No shared city curve or inferred property-name matches.

The connector must have **Read** access only. Write and Customization write stay
disabled. The account's connector screen showed free beta through March 31, 2027
on November 12, 2026; this is not a promise of permanent free access. Customer API
access is a separate paid feature and is not required by this importer.

The live connector returned `ERR-MCP-LISTING-NOT-SYNCING` (422) for an inactive
listing. An existing account subscription alone does not grant this data for
every listing. Such homes are reported as unavailable; the importer never
enables vendor sync to obtain data. Do not assume that reducing paid/syncing
listings preserves a portfolio-wide direct market feed.

## Automatic refresh

`/api/cron/pricing-market` checks every six hours (00:17, 06:17, 12:17 and
18:17 UTC). It refreshes snapshots at least 18 hours old. Only production and
the `CRON_SECRET` bearer can invoke it; preview/local deployments do no work.
The migration creates an empty, disabled-by-absence connection table. Deploying
the code does **not** enroll credentials or enable the connection.

Before activation, obtain approval to apply
`20261113020000_helm_pricing_market_connection.sql` and move the authorized
read-only connector from local-only storage into Helm's server database.
Credentials use AES-256-GCM with authenticated purpose binding and a
PriceLabs-specific HKDF key derived from the server-only Supabase service key.
Ciphertext is stored in an RLS-locked table; only the service role can read it or
call its restricted RPCs. No credentials enter client bundles, research rows,
logs, GitHub or plaintext database columns. Rotating the Supabase service key
requires re-enrollment with a new/current read-only token; do not rotate that key
without accounting for this connection. This protects database contents at rest;
it does not protect against compromise of the application server/service key.

After the approved migration, use the approved environment file directly:

```sh
node --import ./scripts/server-only-test-hook.mjs --env-file=/absolute/path/to/approved.env \
  scripts/pricing-market-connection.mjs --enroll --credentials /absolute/private/directory
```

Enrollment marks that private directory `server-managed.json` before sending the
request. From then on, **do not run the manual importer or reuse that local token
copy**: the server owns the rotating refresh token. A lost response requires
checking `--status`, not deleting the marker and blindly re-enrolling. If
re-enrollment is necessary, authorize a fresh read-only token into a new private
directory. The operator script accepts `--status`, `--disable` and `--enable`
without a credential directory; all output is sanitized connection status.

The job holds a database lease for up to ten minutes, aborts reads after four
minutes and has a five-minute function limit. At most two market reads run at
once, each with a 60-second timeout. The saved cursor rotates the starting home
after a partial run so a slow provider does not starve later homes. Concurrent
cron deliveries cannot consume the same refresh token. Refreshed credentials
must be saved before market reads begin. If the provider rotates a token but its
database save fails, reauthorization may be required; never fall back to a
stale local token. A killed run's lease expires automatically.

`last_report` records counts only: saved, fresh, unavailable, failed, conflicting
and deferred. Failed imports retain the old data and original observation time;
existing 36-hour UI freshness rules still apply. Transient failures retry on the
next six-hour tick. Vercel does not retry a failed cron invocation automatically.
For verification, call the production cron with the existing bearer from a
private environment, then inspect `--status` and reload the portfolio. A 503 or
`partial` report means some work was not confirmed, not a successful refresh.
An inactive PriceLabs listing is reported unavailable and its sync is untouched.

Rollback: use `--disable` and keep prior market evidence. If a run holds the
lease, wait for it to finish or for its ten-minute lease to expire; do not revoke
or overwrite its refresh token mid-run. The cron then returns `skipped`.
No separate service, new plan or live pricing permission is needed.

## Manual run (before server enrollment)

The operator must be authorized to read the PriceLabs account and import market
research into Helm. Use Node 24+, the approved environment source, and a private
credential directory outside the repository (0700; files 0600):

- `credential-fields.json`: the OAuth creation fields with IDs
  `credentials-client-id` and `credentials-client-secret`, each with its `value`.
- `token.json`: OAuth token response with `scope: "read"` and `obtained_at` (ISO).

```sh
node --import ./scripts/server-only-test-hook.mjs --env-file=/absolute/path/to/approved.env \
  scripts/pricing-market-refresh.mjs --credentials /absolute/private/directory
```

This validates the entire exact-matched portfolio without saving research.
Add `--write` to save each validated snapshot using the existing versioned
`helm_save_pricing_research` RPC. Review the aggregate report: unmatched listings,
validation failures and saves are counted separately. Private receipts contain
the exact request ID, expected revision and payload for recovery after a lost
response. Never paste receipts, provider payloads or credentials into logs/PRs.

The CLI refreshes expired OAuth tokens without expanding scopes. Reauthorization
may be necessary after revocation. Credential values never enter browser bundles,
the research table, source control or CLI output. Only catalog and market-data
tools are exposed; no vendor write tool or rate-publishing function is imported.

## Data rules

- Match Guesty listing IDs to current or former registry IDs, uniquely. Unmatched
  PriceLabs listings and Helm-only homes remain unpopulated.
- Require successful market initialization, matching listing/PMS IDs, USD,
  consistent date-series lengths, unique dates and valid numeric ranges.
- Join price and occupancy series by date. Keep future daily data, comparison-set
  size, selected bedroom counts, source, and retrieval time. Retrieval time is not
  the time PriceLabs last collected each competitor's calendar.
- Preserve existing historical evidence. Do not replace a newer import or retry
  over a concurrent edit. Failed reads retain the previous snapshot and timestamp.
- Use existing dashboard 30/60/90-day comparisons and coverage rules. Unknown or
  blocked own-calendar dates do not acquire fabricated occupancy. The existing
  36-hour freshness rule still applies.

This is an **operator-run refresh**, not a scheduled production feed. A permanent
server connection, secret storage and refresh schedule require separate setup.
No new database migration or publishing activation is needed for market imports.

References: [PriceLabs custom clients](https://developers.pricelabs.co/mcp/connectors/custom-clients),
[market data tools](https://developers.pricelabs.co/mcp/tools/market-insights).
