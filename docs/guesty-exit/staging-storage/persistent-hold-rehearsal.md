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

Hosted browser acceptance remains pending deployment: load saved state, release,
reload and load again, hold, then verify the saved history. A stale browser must
receive a conflict and require a refresh. No messages should be dispatched.
