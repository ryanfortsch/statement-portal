# Calderwood message handoff rehearsal

Implemented October 13, 2026 in `src/lib/calderwood-rehearsal/message-handoff.ts`.
This pure function reviews synthetic evidence. It does not fetch Guesty records,
change either queue, stop Guesty, persist results, or authorize sending.

## Decisions

- Verified sent history: suppress replay.
- Guesty still has a queued message: retain Guesty ownership; no Helm copy.
- Sent plus queued, uncertain delivery, or a queue remaining after sender stop:
  review the conflict.
- Unsent operator hold: retain hold. A cancelled stay cannot create a message.
- Missing, partial, wrong-reservation, changed-revision, stale or future evidence:
  require review.
- No queued copy is not proof that Guesty cannot still schedule or send one.
- Only a future, unsent message with complete matching evidence collected after
  verified source-sender stop/drain becomes an activation-review candidate.
- Due or overdue messages never become automatic catch-up candidates.
- Every result carries `canSend: false`, including candidates.

## Evidence contract and remaining integration

The caller must supply a validated, trusted snapshot containing explicit states
for each known message, complete sent history and queue coverage, reservation
identity, and a revision covering dates, times, status and source mapping.
Missing per-message entries remain unknown, even when snapshot completeness is
asserted. The adapter must validate raw input; these TypeScript types are not an
API request validator. No live adapter exists yet.

`senderStoppedAt` means verified cessation/drain of applicable sending, not just
an Airbnb disconnection or an operator's intended stop. The source snapshot must
be collected afterward. Evidence maximum age is an explicit caller policy; the
synthetic tests use five minutes, which is not a promised safe cutover interval.

Production activation still needs verified workflow/source applicability,
recipient/channel mapping, access-code readiness, persistent sent identity,
atomic ownership transfer and worker-side rechecking. A snapshot cannot prevent
a race on its own. In particular, a review candidate is not permission to send.
Guesty guest workflow exclusions remain Website, Manual and Direct - stay cape ann;
cleaner reminders cover all sources. This module does not implement those source
mappings or inventory other applicable workflows.

Next integration step: read the actual sent/queued evidence for a single explicitly
authorized Calderwood reservation, map it without storing bodies/contact details
in source, and compare a review report against Guesty's visible state. Refresh
that evidence at eventual cutover. No Guesty settings were changed for this work.

## Validation

Eight synthetic handoff tests cover the decisions above. Full suite: 1,882 passed.
TypeScript and targeted ESLint must also pass before commit. No UI change or
live delivery test is included in this step.

Continues owned branch `codex/channex-staging-pilot` from `2c715dba`.
Remote main observed before work: `c5f220028cc11deeb8f109fd44e418a6e0ab5ad5`.
This change does not merge the pilot into main.
