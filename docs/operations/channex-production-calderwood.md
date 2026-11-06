# Calderwood production Channex setup

Verified in the authenticated production UI and GET-only production API on
6 November 2026. **Account access, the scoped server credential and an unmapped
property are ready. Live cutover is not ready.** Guesty continues
to operate the existing listing. These observations do not establish current
calendar parity, provider delivery, or future runtime health.

## Saved production configuration

| Record | ID / value |
| --- | --- |
| Environment | `https://app.channex.io` |
| Organization profile shown | Risingtidestr PMS |
| Helm property | `65_calderwood` |
| Channex property | `320c5cb5-91e0-46af-b9b3-a3fc20b4631e` |
| Property title | 65 Calderwood |
| Room type | `e8673d84-4bea-48b1-a160-214b016a8c05` |
| Room title | 65 Calderwood - Whole Home |
| Rate plan | `ce53790a-7b7d-4cec-91a6-a128589f9dd2` |
| Rate title | Standard - PriceLabs |
| Classification | Holiday Home; UI billing type Vacation Rental |
| Currency / time zone | USD / America/New_York |
| Inventory | One rentable whole-home unit; six adult-compatible spaces; zero dedicated child/cot spaces |
| Property inventory horizon | 500 days; maximum advance window enabled at 365 days |
| Automatic booking adjustments | New-booking reduction mandatory/on; modification and cancellation adjustment off |
| Rate configuration | Manual API-fed rate, per room, six persons, all seven stop-sell defaults on, maximum stay 91 |
| Channels | Production Channels page explicitly showed no channels |

Property identity, currency, location, time zone and settings were read back after
creation. The saved room appeared with count 1 and A:6 C:0 I:0. The saved rate was
reopened and all seven stop-sell flags and maximum stay were read back.

This is a setup target, **not a priced offer**. The new rate retains Channex's zero
default price and one-night default minimums. No nightly rates were imported or
published. PriceLabs must populate positive prices and effective minimum stays,
with dated readback across the intended booking horizon, before any stop-sell is
released. Rate defaults are not proof that every dated restriction is closed.
The independent empty-channel check is the current containment boundary.

No cancellation policy, tax set, fee/markup mapping, cot allowance or booking
cut-off was inferred from old snapshots. These still need the actual channel
configuration checked before launch. The address was entered from the previously
verified Calderwood listing; Channex populated location coordinates automatically.
Do not treat those coordinates as independently verified channel content.

## Production API inspection

`src/lib/channex-production-preflight.ts` is a new, separate **GET-only** adapter.
It fixes the production host and the three reviewed IDs above, rejects redirects,
checks property/room/rate relationships, USD/New York, room count/capacity, closed
weekly defaults and an explicitly complete empty channel collection. It emits
only a small configuration receipt. Provider bodies and credentials never appear
in errors. It has no booking, message, ARI, ACK, channel-attachment or database
writer. A successful inspection always reports `readyForCutover: false`.

Run only after the production-specific key has been securely provisioned in the
authorized server environment:

```sh
node --conditions=react-server scripts/check-channex-production.mts --property=65_calderwood --read-only
```

Required server secret: `CHANNEX_PRODUCTION_API_KEY`. The script deliberately does
not load `.env` files, accept a key as an argument, use a staging key as fallback,
or accept caller-supplied hosts, property IDs or URLs. Do not paste the key into
chat or shell history. The two command arguments are mandatory. No cron, route,
worker or environment flag starts this command automatically.

The user created `Helm - Calderwood production` and explicitly authorized storage
in Helm/Vercel. Reopening the saved key's settings confirmed **Only Selected**,
with only **65 Calderwood** checked. The UI offers no read-only permission toggle.
IP Access remains All; the key itself permits API writes and is not IP restricted.
The inspection command, independently, makes only GET requests.

`CHANNEX_PRODUCTION_API_KEY` was saved to Vercel project
`rising-tide-statements` as a **Sensitive**, **Production-only** environment
variable at 14:53 UTC. Vercel metadata confirmed its type and target without
printing its value. It was not added to source, chat, shell arguments, preview,
development or the staging worker. The restrictive temporary credential file and
directory were removed after verification; in-memory browser copies were cleared.

At **2026-11-06T14:53:58.521Z**, the production inspection succeeded using that
same credential. Its sanitized receipt established:

| Check | Result |
| --- | --- |
| Property, room and rate identities/relationships | Exact reviewed IDs matched |
| Currency, time zone and whole-home capacity | USD, America/New_York, one unit, six spaces |
| Saved weekly stop-sell defaults | All seven true |
| Property-filtered channel collection | Empty, provider total zero |
| Provider mutations / calendar authority changes | None |
| Ready for cutover | False |

This was a local CLI process using the production API, not a Vercel runtime or
background worker execution. Secret storage is not proof of a deployed consumer.
No nightly availability, reservations, guest records, prices or messages were
requested. The declared PriceLabs authority is configuration intent, not proof
that PriceLabs has connected or populated this production rate.

## Work remaining before the Airbnb switch

1. Integrate and deploy the certified durable booking/availability path against
   the production mapping and real Helm property. The November 6 main tree has
   an iCal cutover path, while the Channex worker is on the separate staging
   branch/project. Neither is proof of a deployed production Channex consumer.
   Keep staging credentials and worker isolated; changing a staging URL is not a
   production deployment procedure. Credential provisioning and the GET-only
   configuration inspection are complete.
2. Map PriceLabs to the actual production rate plan, preserving one price and
   minimum-stay writer. Verify daily rates, restrictions, fees, markups and the
   existing Airbnb listing identity. Do not copy the staging $100 test rate.
3. Refresh all current/future reservations, independent holds and message state.
   Prove automatic guest delivery plus cleaner SMS, duplicate prevention and the
   rare key-code hold/release. Preserve the existing Guesty schedule, including
   3 PM key-code delivery and guest-facing 3:30–4 PM guidance.
4. Confirm the authorized Booking.com sales pause and resolve other sales paths
   (Vrbo is deferred but existing reservations still require protection). Then
   review the exact Airbnb/Guesty transition and containment procedure before
   connecting the live channel or releasing any sales.

The recovery/Drive work is separate. The new Drive backup schedule remains off
while the user has deferred 1Password recovery-key custody. No recovery keys or
new backup schedules were created in this production configuration batch.

## Implementation validation

Branch `codex/channex-production-setup`, based on main
`7be7072e504218fe5775919e4c32bc0db48fb81b`. Seven focused tests exercise fixed
GET-only requests, cross-environment/property mismatches, incomplete collection
evidence, unclosed rates, redirect/error handling and credential redaction.
Full suite: 3,737 passed, seven optional tests skipped, zero failed. TypeScript
and targeted ESLint passed. An explicit credential-free CLI smoke exited with
`CREDENTIAL_REQUIRED` before making a request. These synthetic checks are separate
from the successful production API receipt above.

Implementation [PR #2138](https://github.com/ryanfortsch/statement-portal/pull/2138)
merged as `58aee09351f00d360641a3aaf02f94489e2e86e1` after all CI checks passed.
The Vercel production deployment created at 14:45 UTC reached Ready. That
deployment predates credential provisioning and does not establish that a running
process loaded the new secret. This follow-up is documentation only: complete
diff inspection, referenced-path checks and `git diff --check` apply; application
tests need not be repeated for this evidence update.

## References

- [Property classification and settings](https://docs.channex.io/application-documentation/properties-and-groups-management)
- [Room count and guest spaces](https://help.channex.io/en/articles/8463205-create-a-room)
- [Rate-plan defaults and daily values](https://docs.channex.io/api-v.1-documentation/rate-plans-collection)
- [Existing recovery implementation](channex-data-protection-and-recovery.md)
