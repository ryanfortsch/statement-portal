# Optional contact matching in the inbox

The inbox promoted an 80-record contact-filing backlog above Conversations.
That backlog combines unknown phone records and Quo address-book suggestions;
its total does not measure messages awaiting a reply.

The change puts Conversations first and replaces the amber New numbers panel
with a neutral **Contact matching · Optional** disclosure below it. Normal
visits start with it closed, without a count. Expanding it preserves the
existing matching, new-contact, Not ours, search, Show all, and Older controls.
An actual unidentified-owner alert remains actionable as **Match this sender**.
Existing `/messaging#new-numbers` links open the disclosure, including initial
hydration and repeated navigation to the same fragment after closing it.

## Review state

- Branch: `codex/quiet-number-triage`
- Base: `5216a91389e607afc623b825284d7fb7ca2813b0`, verified against GitHub main on November 4, 2026.
- Checkout: `/Users/maguire/Documents/ChatGPT/Rising Tide/helm-new-numbers`
- Local implementation only; no push, merge, or deployment.

Changed files:

- `src/app/messaging/page.tsx`: moves matching below Conversations.
- `src/components/messaging/NumberTriage.tsx`: native disclosure, optional copy, deep-link support.
- `src/lib/concierge-alerts.ts`: gives the existing sender alert a concrete action label.
- `src/lib/__tests__/crm-triage-on-messaging.test.ts` and `triage-age.test.ts`: updates existing placement and copy expectations.
- `CLAUDE.md`: updates the module map.
- This review note.

## Verification

- Node 25.9.0; `npm test`: **3,592 passed, zero failed** on the final source.
  Existing tests mishandle URL-encoded spaces in the checkout path. The full
  suite was therefore rerun in `/private/tmp/helm-number-triage-verify`, a local
  clone of the same base with all changed tracked files copied verbatim.
- `npx tsc --noEmit`: passed in the working checkout.
- Focused ESLint on `NumberTriage.tsx` and `concierge-alerts.ts`: passed.
- Broader touched-source ESLint reports the existing `Date.now()` render-purity
  finding in `src/app/messaging/page.tsx:130`. The same finding was reproduced
  from the unmodified base using ESLint stdin. It was not suppressed or changed.
- `git diff --check`: passed.
- Browser smoke check used the actual changed component with 80 synthetic
  phone records, synthetic surrounding conversations, and stubbed write actions.
  Verified normal collapsed state, pointer and keyboard disclosure, initial and
  repeated fragment links, contact selection retained through collapse/reopen,
  enabled Attach after selection, Show all rendering 80 rows, and no document
  overflow at 390px width. No browser console errors were recorded.
- Screenshot: `/Users/maguire/.codex/visualizations/2026/11/04/01a1a718-76dd-7733-afee-c404a8ef4d26/contact-matching-preview.png`.

## Limits

This is a presentation fix. It does not classify or dismiss the existing 80
records, change automatic identity matching, or modify message delivery.
Live customer records were not inspected or changed. The component was tested
in an isolated synthetic preview; no authenticated production acceptance or
configured production build was performed.

Main automatically deploys to Vercel. `AGENTS.md` requires explicit approval
before merging or deploying. Recheck current main and the final diff before
integration, because other Helm work is active.
