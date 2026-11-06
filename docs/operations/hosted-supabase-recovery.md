# Hosted Supabase recovery and worker activation

6 November 2026. Engineering runbook for the recovery worker; **not evidence that
scheduled backups or hosted restoration are active**. The source adapters,
encryption, signed Drive transport and one-shot coordinator are implemented.
Two isolated local PostgreSQL clusters pass the synthetic restore drill. No live
customer export or hosted restore has been performed in this batch.

## What the worker produces

`node scripts/run-recovery-worker.mts --plan /private/recovery-plan.json --check`
is an offline check. It validates the plan and prints required/missing environment
**names**. It does not authenticate credentials, inspect Drive membership, connect
to a database, install a schedule, or establish recovery readiness. Omitting both
`--check` and `--once` also performs this check.

Only an explicitly enabled plan plus `--once` starts an export. Use a dedicated
worker with Node 24+, age and PostgreSQL 18 client tools, a checkout of the pinned
application commit, and private persistent disk. The application web deployment
does not run this command. The CLI checks its commit and tracked/untracked changes
in recovery code and migrations before execution; it loads no `.env` files.

The first release supports the project's **direct** Supabase endpoint on port
5432 with `verify-full` TLS and a reviewed root certificate. It does not silently
fall back to a pooler or disable TLS when connectivity fails. Establish IPv6
reachability from the chosen worker before activation.

The encrypted artifacts contain:

- `database.age`: standard tar with ordered 1 MiB parts of a PostgreSQL custom
  dump, `roles.sql`, and `database.json` with each part's size/hash and the whole
  dump hash. Roles come from `pg_dumpall --roles-only --no-role-passwords` before
  and after the database dump. A changed role export fails the run. Random psql
  guard tokens are ignored only for comparison; the original SQL is preserved.
  These separate reads are **not** one atomic cluster snapshot.
- `storage.age`: file bytes and a version-checked inventory across every reviewed
  Supabase bucket and Vercel Blob store. Database/files are not cross-system atomic.
- `configuration.age`: reviewed plan, application commit, migration file hashes,
  native tool versions, credential names and custody reference. No secret values.
  Provider settings and historical encryption-key versions still require separate
  recovery records in the business password manager.

Snapshot age starts at durable run intent creation, before source reads. This is
a conservative recovery-age bound, not an exact PostgreSQL MVCC timestamp. The
signed manifest appears only after every producer completes successfully.

## Activate in this order

1. **Custody.** The user selected a business password manager. Its product,
   company vault, primary custodian and emergency custodian still need naming.
   Generate the age decryption identity there through an approved local workflow;
   recover a synthetic bundle with it before saving the public recipient in the
   worker plan. Keep this private identity out of Helm, Drive and the exporter.
   Store a separate Ed25519 signing key; pin its public key independently with the
   recovery custodians. Never paste private keys into chat or a PR.
2. **Destination.** Verify effective membership of a restricted company recovery
   shared drive/folder, including inherited groups and external/link grants. Use
   a dedicated service account, no domain-wide delegation, and the minimum Drive
   role that permits create/readback. The existing `Helm Records` permission
   roster is unverified. Folder write capability alone does not satisfy this step.
3. **Sources.** With scoped authorization, provision a database export identity
   capable of reading the complete application/managed data required for recovery.
   Do not weaken RLS or substitute an incomplete low-privilege dump. Review the
   full bucket/access map, Blob store IDs and separate S3/Blob credentials. The
   implementations only read; the provider credentials may have broader rights.
   Document that residual privilege and restrict worker/network access.
4. **Private worker.** Review resource limits and persistent disk. The canonical
   spool path and its children must be owned by the worker user, mode 0700, with
   no symlinks. Reserve at least three maximum-sized encrypted artifacts plus
   64 MiB free before a new export. There is no automatic deletion. Review disk
   capacity/retention before enabling a recurring job; do not silently discard a
   last good copy or a legal hold to make space.
5. **Synthetic destination exercise.** Use a separate reviewed test destination
   and credentials. Export, upload, download and decrypt all artifacts. Re-run the
   same ID after an induced upload interruption. Verify receipt signatures, byte
   hashes, stable remote IDs and source completeness. Never use a genuine guest
   record merely to test connectivity.
6. **Authorized hosted drill.** Complete the restore procedure below against an
   isolated target. An actual production-derived export requires authorization
   for that data access. Record elapsed time and all required recovery checks.
7. **Schedule and watchdog.** Only then enable the reviewed daily one-shot job
   on persistent storage. Configure a separate watchdog on the last verified
   signed snapshot and alert after 26 hours, including when the worker itself
   stops. Neither a schedule nor independent alert delivery is installed by this
   source deployment. Exercise a missed run and alert before calling this active.

Required worker secrets are `RECOVERY_DATABASE_PASSWORD`,
`RECOVERY_S3_ACCESS_KEY_ID`, `RECOVERY_S3_SECRET_ACCESS_KEY`,
`RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY`, `RECOVERY_SIGNING_PRIVATE_KEY`, and each
reviewed Blob token's `RECOVERY_*` name. The plan contains only public identities,
public keys, source/destination IDs, paths, limits and a custody record reference.
All plan fields are defined in `src/lib/recovery-runner.ts`; unknown fields fail
validation, so credentials cannot be added as arbitrary configuration properties.

`enabled` must remain `false` until the activation steps have evidence. A change
to `enabled:true` is a configuration action, not something the CLI does itself.

## Retry and failure handling

The default backup UUID derives from the entire plan and current UTC day. An
upload retry that day verifies and reuses the completed signed export, without
reading customer sources again. A plan change or new UTC day creates a new ID.
To retry a previous day's completed upload, pass its existing `--backup-id UUID`;
keep the same plan and signing identity. An expired bundle cannot be uploaded.

An export that fails before manifest publication remains partial ciphertext and
cannot be overwritten or promoted. Investigate it, then use a new explicit UUID
for a fresh reviewed run. Never manufacture a completion manifest. A concurrent
worker cannot acquire `.worker.lock`. After a crash, confirm the previous process
and host are stopped before removing only its stale lock/pending file. Preserve
published intent, manifest and upload journal. Run only one scheduler/host for a
spool; this is a local lock, not a distributed lease.

The result keeps `databaseRestoreVerified:false` and
`productionCutoverAuthorized:false`, even after successful upload/readback. A
receipt or a running process is not a recovery drill. The worker never restores
data, changes channel connections, enables messages or deletes old copies.

## Hosted restore procedure

Supabase's manual restore guidance differs from a raw PostgreSQL restore: its
CLI uses role/schema/data exports, with separate handling for migration history
and customizations in managed schemas. Custom login passwords must be recovered
or recreated separately. Vault/column encryption requires attention to the
encryption root key; Supabase's “Restore to a new project” and branching flows
copy that key automatically, while a manual logical restore has a separate key
step. Follow the current vendor procedure for the exact source/target versions.
These details are why the native archive is not yet proof of hosted recovery.
[Supabase manual backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

1. Record the approved source project, target project, application commit and
   manifest digest. Require a target project different from both live Helm and
   the existing Channex staging workspace. Establish a private disposable recovery
   environment and an authorized cleanup owner. Do not run a test restore over
   the source or an existing workspace.
2. Block outgoing channel, email, SMS, payment and webhook traffic **before**
   importing anything. Keep application workers and database scheduled jobs off.
   Restored database jobs, extension settings and vaulted URLs can have effects
   without the web app running. Inventory those effects and review the restore
   list first; do not rely only on a `staging` environment name.
3. Download the signed manifest/receipt and exact artifacts using independently
   granted recovery access. Verify the signatures with the independently pinned
   key, expected source scope, IDs, sizes and hashes using the existing verifier.
   Retrieve the private age identity from the password manager. Decrypt only in
   the private recovery environment. Never use ordinary Drive downloads/shared
   folders as plaintext staging space.
4. Inspect the inner tar entry list before extracting. It must contain only the
   ordered `database/NNNNNN.part` entries, `roles.sql` and `database.json` emitted
   by this producer. Reject unexpected paths, duplicates, missing parts and
   links. Verify each part and whole-dump hash from `database.json`, then assemble
   the native custom dump in that exact order. Inspect `pg_restore --list` and
   generated schema/role SQL before execution. Do not blindly execute a raw
   cluster-role file against a managed Supabase target.
5. Prepare a source/target-specific restore list, including managed-schema
   ownership/grants, extensions, custom roles, migration history, auth/storage
   policies/functions/triggers and required encryption keys. Compare against the
   vendor-supported procedure. Where a supported additional export is needed,
   obtain it under the authorized data-access scope and encrypt it immediately.
   Do not silently exclude an inaccessible schema or continue past SQL errors.
   Restore with stop-on-error behavior and record every deliberate transformation.
6. Recover application encryption keys and their historical versions separately.
   Source inspection found `FIELD_W9_KEY` and a legacy service-role-key fallback
   in field-tax encryption: changing the secret without re-encryption can make
   stored tax data unreadable. Review actual usage before copying or rotating
   keys. Keep live API credentials disabled in this test environment.
7. Restore object bytes to isolated storage, reconstruct access policy, and
   verify the full object inventory/hash set and DB references. Reapply approved
   deletions/corrections received after the snapshot so recovery cannot resurrect
   removed guest data. Do not regenerate executed documents as substitutes.
8. Test the restored application: canonical bookings and cancellations, inventory
   protection, RLS/negative access, sequence/FK behavior, unchanged money totals,
   messages/receipt deduplication and holds, and key recovery. Preserve Guesty's
   existing message schedule, including the 3 PM key code and rare delay hold.
   Reconcile provider changes after the snapshot before any recovery cutover.
9. Bind measured results to the exact signed manifest and app commit with the
   restore-evidence verifier. Failed or missing checks leave recovery unproven.
   Record RPO/RTO, key custodian access and cleanup completion. Any future live
   cutover remains a separate reviewed action.

The local two-cluster test proves native PostgreSQL role/schema/data restoration,
including permissions and RLS. It does not prove Supabase-managed compatibility,
live credential access, full restored application behavior or the proposed
15-minute provider recovery point. Those remain explicit activation gates.

## Implementation handoff

Branch `codex/channex-recovery-worker`, base
`d21d61447ac2b1d881acd04ca0ebff46ac7b2801` (PR #2134).
Changes are limited to the recovery runner/CLI, database role archive, synthetic
tests and these runbooks. No customer data, paid services, credentials, scheduled
jobs, production DB settings or channel authority were changed.

Validation commands (native tests are opt-in and must not be described as CI
coverage when their environment variables are absent):

```sh
RECOVERY_TEST_PG_BIN=/absolute/postgresql18/bin \
RECOVERY_TEST_AGE=/absolute/age \
RECOVERY_TEST_AGE_KEYGEN=/absolute/age-keygen npm test
npx tsc --noEmit
```

The optional recovery-specific GitHub workflow remains unavailable because the
current GitHub credential lacks workflow-write scope. The repository's existing
CI remains required for this release; native age/PostgreSQL evidence is local.

Final local validation: **3,728 tests passed, zero skipped**, with both native
test opt-ins enabled. TypeScript, focused ESLint and whitespace checks passed.
The offline CLI test confirmed no source contacts or secret values in its output.
