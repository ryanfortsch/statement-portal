# Portfolio market imports

The existing PriceLabs subscription provides a separate neighborhood comparison
for each listing. Helm reads that listing's selected comparison set through the
official MCP connector. No shared city curve or inferred property-name matches.

The connector must have **Read** access only. Write and Customization write stay
disabled. The account's connector screen showed free beta through March 31, 2027
on November 12, 2026; this is not a promise of permanent free access. Customer API
access is a separate paid feature and is not required by this importer.

## Run

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
