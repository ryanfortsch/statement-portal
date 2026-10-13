# Persistent hold rehearsal

Scope: the isolated staging project `jgkblfozftcvymvwhhii`, never the ordinary
Helm database. Applied October 13, 2026 through that project's SQL editor;
Supabase returned `Success. No rows returned`.

Generate with `node scripts/hold-rehearsal-sql.mjs`. This uses the reviewed hold
function in a private fixture schema, plus narrow public read/change wrappers.
The fixture has no delivery worker, contact information, or rendered message.
No ordinary public bookings or automation tables are created. Do not add this
setup to production migrations. The server route requires the exact pilot branch,
preview environment, signed-in Rising Tide operator, and exact staging project.
POST also requires the configured preview origin. Actor comes from the session.

Local validation: 1,867 tests passed; TypeScript and targeted ESLint passed.
The PGlite fixture check passed release/hold, stale version rejection, retained
fire time, audit history, cancelled/moved booking rejection, reapplication without
reset, and restricted privileges. This is not full production schema validation.

Hosted browser acceptance passed on source `d8231e8a`, Vercel deployment
`4qDZWePvPvPQsbZCdaQWZqoA1pbk`: initial held state loaded, release saved with
one audit event, reload returned the same scheduled version, stale release from
a second tab was rejected and removed the controls until refresh, and hold saved
with a second audit event. Final fixture state is held. The ordinary public
`automation_sends` table was separately confirmed absent. No delivery occurred.

Branch: `codex/channex-staging-pilot`; work resumed from `41acb96b`.
Remote main observed before edits: `aa861513a9c9e4daba28f96edc8e00819542d493`.
No main merge, production configuration, Render change, or subscription added.
