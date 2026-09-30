# All-property guest inbox preview

September 30, 2026. This extends the inbox design after the bounded overnight pass, in response to the user's request for a separate view of guest message history across all properties.

## Access and scope

- New staff-only route: `/messaging/inbox`.
- Discoverable through **Messaging → Guests → Inbox preview**, and command search for **Guest Inbox Preview**.
- Existing `/messaging`, `/messaging/send`, their handlers and the Calderwood loader are preserved. The shared Messaging tabs gain one link; the existing Inbox stays the default.
- The preview offers property, channel and stay filters, guest/property/reference search, message search, an on-demand reservation inspector, and 30/60/120-day source windows.
- Property identity appears on each row, the conversation header and the inspector. URL links retain property/window selection. Conversation links and the new preview tab disable prefetch to avoid background conversation reads.
- Read-only: no send, approval, archive, snooze, mark-read, automation or calendar-authority action is wired into this route. The action back to the current inbox lets operators continue established workflows there.

## Data path

`src/app/messaging/inbox/page.tsx` checks the existing staff session before invoking the server-only `guest-inbox.server.ts` adapter. The default proxy gate remains in force; no public route or authentication setting changes.

The adapter calls the existing Stay Concierge `listConversations` and `getConversationThread` GET readers. Helm-native threads are read directly from the same `guest_threads` and `guest_messages` tables as the current inbox. A dedicated adapter makes failures visible instead of converting a failed read into an apparently empty source. It uses the existing pure native message converter to preserve sender attribution.

Property association uses explicit current/former registry IDs and the synced `guesty_listings` map. Unknown or ambiguous Guesty mappings remain visible in All properties and the Unmatched property filter, with no guessed booking details. Native thread property IDs are preserved; a missing one may be recovered only from its exact linked booking.

Reservation reads load only explicit IDs referenced by the returned conversations, in bounded batches. Duplicate aliases can resolve only within the same property. Missing targets, cycles, cross-property links and ambiguous matches remain unmatched. Distinct Guesty and Helm threads are not merged by guest name or stay dates.

The selected conversation must belong to the server-loaded, property-filtered list before either history reader is called. An arbitrary URL ID or a conversation from another selected property cannot trigger a history fetch. Source errors are isolated, and raw provider/database diagnostics are not sent to the browser.

## Coverage limits

The existing concierge list is confirmed stays with check-in within the chosen number of days before or after today, capped upstream at 400 reservations. It is not an archive of every inquiry, cancellation or past/future stay. Native threads are non-archived threads updated within the preceding selected number of days. The native reader fails explicitly at its 5,000-row guard rather than quietly returning a partial list.

History shows up to the latest 200 messages returned by the source. A full-limit notice is displayed when that limit is reached. Attachments and complete historical coverage remain unverified. Refresh rereads the sources, which can themselves return cached lists. These limits are visible under **What’s included** and **Source & history**.

No new webhook, polling loop, external channel connection or message backfill is introduced. This is an alternate reader of the existing message pipeline, not a Guesty cutover.

## Validation and remaining acceptance

- 1,581 tests passed, including 13 new tests for property mapping, duplicate aliases, source identity, property-filtered thread selection, independent source failures, bounded windows, URL encoding and the authenticated/read-only boundary.
- TypeScript and targeted ESLint passed. Stylesheet parsing/class-reference and whitespace checks passed.
- The isolated synthetic Next.js build passed, including `/messaging/inbox`. The sample page exercises the actual orchestration and shared UI using synthetic sources; it does not exercise deployed authentication or the live Guesty service.
- Authorized database checks used HEAD/count queries only. The requested property, listing, booking, native thread and message projections were accepted. At the check, there were 24 properties, 22 synced listing records, no native guest threads in the 60-day window and no native guest messages. No guest records or credentials were printed or copied into fixtures.
- This machine has no configured Stay Concierge URL/key in Helm's local environment. A live Guesty history read and end-to-end staff session validation remain outstanding. The production route uses the same hosted service configuration as the existing inbox.
- Browser policy still blocks the local preview. No browser, alternate address or screenshot workaround was attempted. Rendered visual acceptance, native dialog behavior and phone/reflow checks remain pending.

The local sample is at `http://127.0.0.1:3114/messaging/inbox?conversation=c2`, clearly marked as sample data. Production access requires deploying the separate route. This change does not itself authorize a merge or production deployment.

Handoff: existing `codex/calderwood-design` branch and PR #1695; base `5586f569`; main checked at `fd2dfb2e` without merging or rebasing. The prior inbox remains recoverable at `5b773446`, with its final audit at `9311a7ed`.
