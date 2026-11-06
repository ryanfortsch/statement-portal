# Helm / Channex data protection and recovery

Scope and first implementation, 6 November 2026. User authorized the scope and
implementation start, including evaluating Google Drive. This is a deployment
plan, not a statement that live backups or recovery have been configured.

## Decision

Keep Supabase as Helm's operational database. Use provider recovery for fast
database recovery and independently encrypted, dated recovery copies in a
restricted company-owned Drive destination. Continue the existing document
archive for human-readable contracts and PDFs. These are three different jobs.

Google Drive is a viable independent copy destination for this pilot if access,
key custody, download verification, and retention are implemented. It is not a
transaction store, point-in-time database recovery service, or immutable vault.
Do not treat file revision history as a backup policy or overwrite one
`latest.zip`. Google can purge older blob revisions. Use a new backup ID and new
files for every run. Use an object store with enforced retention if protection
against a compromised Drive administrator is required; ordinary Drive storage
does not establish that protection.

## Verified facts and gaps

| Area | Evidence on 6 November | Implication |
|---|---|---|
| Company storage | Drive connector lists the company-owned `Rising Tide` shared drive and `Helm Records` folder. Backup-named folder search returned no matches. | Reuse the organization, but provision a restricted recovery destination only after checking its membership. Search is not proof no other backup exists. |
| Permissions | Connector metadata did not expose a permission roster (`access_not_verified`). | Neither existing folder access nor owner-only access is established. Do not upload guest/database exports there yet. |
| Existing archival code | `src/lib/drive-archive.ts` uploads PDFs using shared-drive support and the existing Google service account. Failures are best-effort; payloads are buffered in memory. | Preserve this workflow. Recovery needs a dedicated identity, streaming/resumable uploads, timeouts, retries and alerting. The document helper is not a database-backup worker. |
| Production database | Supabase `STATEMENTS`, project `qjueexujiuticjrtqdyj`, shows successful daily physical backup entries, latest `2026-11-06T04:49:32Z`; entries through October 30 were visible. | Daily provider backups already exist. Their restoration has not been tested in this task. |
| Point-in-time recovery | Production's Point in time tab says “Enable the add-on to add point-in-time recovery to your project.” | PITR is not enabled. Published seven-day PITR pricing is approximately $100/month; verify the account quote before purchasing. No paid change was made. |
| Separate staging | `Helm Channex Staging`, project `jgkblfozftcvymvwhhii`. | Its tests and backups are not production evidence. Supabase's `main PRODUCTION` branch badge is not enough to identify the live Helm database. |
| Object coverage | Supabase's dashboard explicitly says Storage objects are excluded. | Back up actual file bytes plus metadata and access policies; a SQL dump alone cannot recover deleted attachments. |
| Channex processing | Isolated `codex/channex-staging-pilot` implements durable revision receipts before ACK, bounded staging processing and message/inventory journals. | This work is separate from current main. Production integration and recovery must be reviewed and deployed deliberately. |
| Independent recovery | No export scheduler, independently verified encrypted copy, key recovery drill or full restored application was established. | Remains a launch requirement. A journal archive in the original DB is not an off-site backup. |

Main reference verified against origin: `f3c559783c2e718edfdd5bd16abbb6df0f7084ac`.
New branch: `codex/channex-recovery-foundation`. No existing worktree was changed.

## Storage and key design

1. **Fast recovery:** verify the production project's provider backups and
   point-in-time recovery settings. Proposed database recovery-point objective:
   no more than 15 minutes of data loss. Daily backups alone do not meet that
   objective. Evaluate the paid PITR option; no subscription change is authorized
   by this document or implemented by this branch.
2. **Independent copy:** daily encrypted database, files and configuration
   bundles. Proposed maximum independent-copy age: 26 hours (24-hour schedule plus
   two hours to finish/alert). This is a separate, weaker disaster-recovery point
   if the provider account is lost. Do not present it as meeting the 15-minute
   provider-recovery target.
3. **Drive access:** dedicated restricted shared drive or a folder whose effective
   inherited access is verified to meet the requirement. No public/domain links.
   Dedicated uploader identity with only the minimum supported role; no general
   marketing/analytics credentials. Readback and cleanup privileges must be
   considered separately. Never assume an uploader is append-only when its Drive
   role allows changes or sharing.
4. **Encryption:** use the established `age` tool and public-key recipients. The
   scheduled exporter receives only the public recipient. Private recovery keys
   belong in an independent owner-controlled password/secret manager with an
   emergency recovery copy and a second authorized custodian. Store a recipient
   fingerprint in the manifest. Exercise old-key recovery before rotation retires
   access to older copies. No custom encryption format is implemented here.
5. **Retention:** propose a rolling 30-day encrypted disaster-recovery window,
   subject to final privacy/legal review. Never auto-delete until there is a newer
   downloaded, verified copy and a successful recovery drill. Legal holds override
   normal cleanup. Long-term booking/financial retention is a separate policy;
   full snapshots must not become an indefinite guest-message archive.

## Recovery bundle contract

One backup ID, one scoped manifest, three encrypted artifacts:

| Artifact | Required contents and verification |
|---|---|
| `database.age` | A consistent DB snapshot, schema, migrations, functions, policies, grants and required roles. Preserve canonical stays, booking events, revision receipts, inventory queues, message receipts/holds and financial records together. Capture database version and export-tool versions. Reconcile Supabase-managed schemas and custom roles through its supported backup procedure. Do not blindly dump/restore a list of guessed tables. |
| `storage.age` | Exact object inventory and file bytes across the configured Supabase buckets and any Vercel Blob storage used by Helm. Include paths, sizes, content hashes and access classifications inside encryption. Store a verified empty inventory when a storage system genuinely has no objects. Preserve executed documents as bytes rather than assuming they can be rendered again. Account for referenced files in other systems and explicitly document exclusions. |
| `configuration.age` | Application commit, migration inventory, provider account/property/room/rate mappings, calendar authority, deployment configuration names, sender/worker settings and restoration instructions. Exclude secret values, service-account private keys and recovery keys; record the independently controlled source for retrieving/rotating those credentials. |

The producer must finish all artifacts before publishing the manifest. Record the
database snapshot time, not upload completion, for recovery age. Objects need a
consistency barrier: inventory before/after export, stable object identities and
hashes, or versioned reads. Changed/missing objects must be retried or explicitly
fail the run. Do not claim database/file cross-system atomicity without proof.

Stream into encryption; do not stage plaintext dumps in ordinary shared folders,
build artifacts, browser downloads, repositories or logs. Use private temporary
storage if a tool requires staging, with bounded cleanup. Network errors must
never log raw dump contents, guest names, tokens or API response bodies.

After upload: read metadata, download the uploaded bytes independently, check
length and SHA-256 against the manifest, and store a receipt containing backup ID,
destination file IDs, hashes and times. Upload success alone is not verified
recovery. An ambiguous upload must be reconciled by backup ID before retry; never
delete a previous good copy to make room for a failed one.

## First implemented slice

- `src/lib/recovery-bundle.ts`: strict manifest validation, fixed flat filenames,
  three-component coverage, source/project/environment and expiry checks,
  streaming byte/hash verification, and restore-evidence assessment.
- `scripts/verify-recovery-bundle.mts`: local read-only CLI. No credential loading,
  network access, uploads, SQL execution or automatic deletion.
- `src/lib/__tests__/recovery-bundle.test.ts`: synthetic fault cases and CLI tests.

Integrity mode:

```sh
node scripts/verify-recovery-bundle.mts \
  --manifest /private/recovery/manifest.json \
  --directory /private/recovery/downloaded \
  --project EXPECTED_PROJECT_REF --environment staging
```

To also assess a trusted operator's drill record, supply all four extra options:
`--drill /private/recovery/drill.json --commit EXPECTED_APP_COMMIT
--max-age-hours 26 --max-restore-minutes 120`.

Integrity success exits 0. Invalid files/input exit 1. Rejected drill evidence
exits 2. The report explicitly separates byte integrity, encryption
authentication, and database restoration. The age header check is only a format
screen: it does not prove encryption or completeness. The manifest/digest must
come from a trusted producer/receipt; matching a maliciously rewritten manifest
is not authenticity. Signed manifests/receipts are now implemented below; real
key custody and worker activation still need review. Never use this checker as
an automatic cutover switch.

Restore evidence is operator-supplied, bound to the exact manifest and application
commit, and does not execute or independently attest the listed checks. Before
launch, restore the exact candidate bundle. Routine daily integrity monitoring
and weekly restore-drill freshness will be separate scheduler checks; this CLI
does not require every daily copy to pass a full restore to be stored.

## Encrypted packaging and Drive transport (6 November implementation)

Implemented in `src/lib/recovery-export.ts`, `src/lib/recovery-drive.ts`,
`src/lib/recovery-google-auth.ts`, and `scripts/upload-recovery-bundle.mts`.
These are standalone worker building blocks, **not an enabled backup service**.
They do not yet acquire a consistent PostgreSQL snapshot or enumerate object
storage. No web route, cron job, database writer, or production integration was
added. The existing document archive is unchanged.

### Export contract and completion

`createEncryptedRecoveryBundle` requires three streaming source adapters, the
actual snapshot timestamp, a unique backup ID, an absolute `age` executable,
one native age X25519 public recipient, and a byte limit/deadline. Each source
must implement `open(signal)` and `assertComplete(signal)`. A future DB adapter
must wait for successful dump-process exit, not just stdout EOF; object adapters
must verify their inventories and detect changes. Sources must honor abort and
stop their underlying work. The wrapper rejects a stalled completion check on
deadline, but cannot itself cancel arbitrary external adapter activity.

Plaintext goes directly into `age`; only ciphertext is written to the private
run directory (0700; files 0600). The child inherits no application credentials.
Encryption errors, source failures, changed inventories, timeouts, and byte-limit
failures prevent manifest publication. Partial ciphertext is retained for
investigation; it is never promoted or automatically deleted. A successful
encryption run does not establish source completeness without working adapters.

An Ed25519 signature binds the normalized manifest digest with a versioned domain
and purpose. The signing private key and decryption private key are separate.
The worker needs a signing key, but only the **public age recipient**. Keep the
decryption identity outside this worker. Pin the trusted signing public key in
the recovery environment from an independent source; never trust a key merely
because it arrived alongside a backup. The signing identity authenticates the
producer, not the correctness of its exports or an uncompromised host.

### Upload, resume, and receipts

The uploader verifies the signature, scope, expiry, and ciphertext locally, then
checks the destination is the configured shared-drive folder with add permission.
That capability check **does not audit effective membership**. It generates five
Drive file IDs and persists/fsyncs `upload.journal.json` before uploading anything.
It uses those same IDs across retries; it never overwrites an existing object or
creates a replacement ID after an ambiguous response. It validates existing file
identity, parent, drive, size and digest before accepting a prior upload.

Uploads use bounded 1 MiB chunks. Lost responses trigger a resumable-session
status query; the next byte comes from the server acknowledgement. Expired
sessions restart with the same pre-generated file ID. Retries and stalled
acknowledgements are bounded. Response-supplied session URLs must stay on the
Google upload endpoint; redirects are not followed. API bodies, credentials,
session URLs, and source diagnostics are not logged.

After each file, the worker downloads the complete uploaded bytes and hashes
them, rather than trusting local checksums or response metadata alone. The
signed manifest is uploaded only after all three ciphertext artifacts verify.
`receipt.signed.json` is created after those four files verify, signed separately,
uploaded last, and itself read back. A receipt explicitly says database restore
has **not** been verified. Remote receipt existence alone is insufficient: its
signature and contents, and the referenced files, must be checked by recovery
and future monitoring code. Drive is not immutable storage.

Keep the private ciphertext spool and journal on persistent worker storage until
upload succeeds. A normal failed run releases its local exclusive lock and can
be retried with the same directory. A process/host crash can leave `.upload.lock`
or an unpublished `*.pending` file. The next run fails closed: an operator must
confirm the original process is gone before removing only that run's stale lock
or unpublished temporary file. Do not delete a published journal or regenerate
IDs for a partially uploaded bundle. Automatic stale-lock recovery is not yet
implemented. Concurrent hosts must not share a spool or independently run the
same backup ID. A fresh snapshot always gets a fresh UUID/directory.

### Dedicated Drive access and activation

Prefer a separate **Helm Recovery** shared drive. Before using an existing folder,
review its effective shared-drive members, inherited grants, groups and external
access; the existing `Helm Records` folder has not passed that review. Grant a
new recovery service account only the minimum role needed on the selected
destination. Do not reuse `GOOGLE_SERVICE_ACCOUNT_KEY` from the document archive,
marketing, or other workers. Keep named recovery custodians separate from daily
staff access. Do not enable domain-wide delegation.

The worker uses Google's official authentication library with an explicitly
configured service account and pinned email, fixed Google endpoints, and bounded
token requests. It does not discover ambient credentials or honor credential-JSON
token URLs/delegation fields. The OAuth `drive` scope is broad; actual isolation
depends on the dedicated identity's grants. A Drive writer is not an append-only
role, even though this code has no delete/update/permission operations. Review
that residual risk before activation.

Configure only on the dedicated worker, through its secret manager:

| Setting | Purpose |
|---|---|
| `RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY` | Dedicated service-account credential JSON; never copied from the app archive identity. |
| `RECOVERY_GOOGLE_SERVICE_ACCOUNT_EMAIL` | Independently approved identity to match against the credential. |
| `RECOVERY_DRIVE_ID` / `RECOVERY_DRIVE_FOLDER_ID` | Reviewed shared drive and exact destination folder. |
| `RECOVERY_SIGNING_PRIVATE_KEY` | Ed25519 signing key, separate from the recovery decryption identity. |
| `RECOVERY_SIGNING_PUBLIC_KEY` | Pinned public verification key; also held independently by recovery custodians. |

The export adapter additionally needs the public age recipient, trusted absolute
age binary, snapshot metadata, and private persistent spool. Do not put secret
values in a manifest or configuration archive. The CLI deliberately does not
load an application `.env` file or accept credentials as command-line arguments.

Once the destination and identity are configured for an authorized synthetic
test, upload a previously produced signed bundle with:

```sh
node scripts/upload-recovery-bundle.mts \
  --directory /private/recovery/BACKUP_UUID \
  --project EXPECTED_PROJECT_REF --environment staging
```

Verify a downloaded signed bundle offline using the independently pinned public
key (this performs no upload or restore):

```sh
node scripts/verify-recovery-bundle.mts \
  --signed-manifest /private/recovery/downloaded/manifest.signed.json \
  --trusted-signing-key /private/recovery-custody/signing-public.pem \
  --directory /private/recovery/downloaded \
  --project EXPECTED_PROJECT_REF --environment staging
```

### Validation and remaining work

`src/lib/__tests__/recovery-worker.test.ts` uses a synthetic Drive transport to
exercise partial writes, lost final acknowledgements, expired sessions, rate
limits, restart identity, corrupt readback, destination mismatch, foreign
session URLs, bounded stalls, and signature/source/journal failures. Real age
roundtrip tests generate temporary test-only keys, decrypt every artifact and
compare exact source bytes; they also test source/inventory failure, quotas,
deadlines and a missing executable. The test keys and fixtures are removed.

Enable the real encryption tests explicitly, pointing to trusted installed
binaries (tested locally with age 1.3.2):

```sh
RECOVERY_TEST_AGE=/absolute/path/to/age \
RECOVERY_TEST_AGE_KEYGEN=/absolute/path/to/age-keygen npm test
```

Without these variables, the real-age tests are reported as skipped; the
synthetic transport and signature tests still run. No live Drive or customer DB
is used by the test suite. A dedicated GitHub encryption workflow was prepared on
`codex/channex-recovery-foundation` at `538b012a`, but GitHub rejected its upload
because the current OAuth credential lacks workflow permission. That commit is
preserved locally. The release uses the existing repository CI; real-age cases
remain locally verified and are skipped in CI until the extra workflow can be
installed with an appropriately authorized credential.

The user authorized integration/deployment on 6 November. This rollout delivers
the code through the existing PR and Vercel checks; it does not activate a
scheduled backup worker. Vercel hosts the web application, while the exporter
needs a separate worker with persistent private spool storage. Before activation
we still need consistent database and
object-storage adapters, destination membership review, real key custody,
an authorized live Drive smoke test, scheduler/watchdog integration, retention
controls, and a complete isolated application restore. This batch is transport
evidence, not proof of database recoverability or a production RPO/RTO.

## Recovery drill and operating procedure

Proposed recovery-time objective: two hours, measured from incident declaration to
verified service recovery. The CLI measures only the submitted restore interval;
incident detection, provisioning and reconciliation must be measured separately.
Targets are proposals, not a measured SLA.

1. Provision an isolated recovery project. Block outbound channel/SMS/email/payment
   traffic at the infrastructure boundary before restoration; disable schedulers
   and database jobs too. A restored DB may contain active flags or cron jobs.
   Do not use a networked staging web app with production provider secrets.
2. Download a copy from the independent destination. Obtain the private recovery
   key separately. Verify bytes and authenticate decryption of every artifact.
3. Restore supported database artifacts, storage objects and required
   configuration. Confirm role credentials separately; Supabase backups omit
   custom-role passwords. Do not copy live secret-bearing environment files.
4. Verify row counts and authoritative records, FK/sequence integrity, RLS and
   anonymous/staff/owner isolation, current and cancelled bookings, inventory
   closures, message sent/uncertain receipts, the 3 PM key-code hold, unchanged
   money records and document/object hashes. Include a deliberately missing file.
5. Reapply deletion/anonymization requests recorded after the backup, and preserve
   legal holds. This needs a minimal independently retained deletion ledger,
   not resurrection of erased guest data after restore.
6. Reconcile provider revisions and ambiguous tasks since the snapshot. A restored
   send ledger can predate a real delivery; do not resend merely because its row
   says pending. Resolve channel/provider receipt IDs before releasing work.
   Preserve PriceLabs' exclusive rate/minimum-stay ownership.
7. Record evidence and timing, test break-glass key access, and destroy the
   isolated restored data through an authorized cleanup workflow. Only a reviewed
   recovery/cutover may re-enable live senders or calendar publication.

## Agreement-driven work beyond backups

| Workstream | Implementation scope | Acceptance evidence |
|---|---|---|
| Guest privacy | Map required guest fields; filter incoming provider payloads; redact logs; implement authenticated export/correction/anonymization with legal holds across DB, storage and queues. | Synthetic subject request reaches every relevant record; logs contain no PII; deletion replay prevents restored data from reappearing. |
| Retention | Classify operational booking history, messages, access codes, attachments, financial/legal records and backups separately. | Approved retention matrix; dry-run deletion report; held records survive; only authorized cleanup can purge. Channex's six-month deletion is not Helm's legal retention period. |
| Credentials/access | Separate backup, recovery and live integration identities; owner-only key custody; named staff accounts; record and review grants. | Effective access review and key-recovery drill. Existing Google service-account access does not establish least privilege for DB backups. |
| Integration resilience | Promote reviewed staging durable-ACK/idempotency/reconciliation behavior to the real provider scope; bounded retries; distinguish heartbeat, source coverage and oldest pending work. | Duplicate, delayed, reordered, lost-response, outage, expired-token and rate-limit rehearsals. Freeze unsafe inventory openings and alert on stale source evidence. |
| Automated messages | Preserve Guesty timing, cancellation and hold behavior; separate service purpose from marketing consent; persist intent/receipt identity. | Actual allowed-channel delivery and duplicate suppression; recovery replay does not resend. No manual-message fallback as a launch substitute. |
| Monitoring | Track last completed snapshot, last verified off-site copy, missing objects, key validity, last restore drill and unresolved tasks. Extend the existing sync-status surface with a separate watchdog. | A stopped backup worker triggers an independent alert; repeated unchanged failures do not spam; each alert names the operator action. |
| Contract administration | Save accepted agreement/version and order; review privacy notice, client AUP, subprocessors and termination/export process. | Named owner and documented procedure. These are not solved by a code deployment. |

## Delivery batches

1. **Scope + verifier (this branch):** storage decision, evidence contract, local
   checks and fault tests. No production configuration changed.
2. **Producer + storage:** verify PITR/cost, approve effective restricted Drive
   membership and key custody, implement consistent exports, age encryption,
   resumable upload/readback, signed receipts, scheduler and independent alerting.
   First exercise uses synthetic staging data and an explicitly chosen test folder.
3. **Restore + privacy:** isolated restoration, storage coverage, post-snapshot
   deletion replay, provider reconciliation and message recovery. Set final
   retention/RPO/RTO based on measured behavior and legal requirements.
4. **Production pilot:** review and integrate Channex branch, install scoped
   production migrations/configuration, repeat the drill against an authorized
   production-derived copy, prove automated messaging, then perform the controlled
   Calderwood cutover. Guesty continues running the live home until this is proven.

## Primary sources

- [Channex agreement and policies](https://channex.io/policy): data responsibilities,
  API/AUP and guest-message restrictions; booking deletion six months after
  departure; historical availability/rate deletion. Engineering mitigations above
  are our design choices, not a claim that Channex prescribes this architecture.
- [Supabase backups](https://supabase.com/docs/guides/platform/backups): daily/PITR
  behavior, missing Storage objects, custom-role password caveat and restoration.
- [Supabase backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): supported export/restore procedure.
- [Google shared drives](https://developers.google.com/workspace/drive/api/guides/about-shareddrives): organization ownership and inherited permissions.
- [Drive revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions): older revisions may be purged.
- [Drive upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads): resumable chunks, acknowledgement ranges and safe retries with pre-generated IDs.
- [Drive download protocol](https://developers.google.com/workspace/drive/api/guides/manage-downloads): full blob download via `alt=media` for independent readback.
- [Google auth library](https://github.com/googleapis/google-auth-library-nodejs): official dedicated service-account client.
- [age](https://github.com/FiloSottile/age): established public-key file encryption.

## Handoff / verification

No database migrations, exports of customer data, live Drive uploads, permission
changes, production keys, paid features, production settings or deployments were
performed. The local age binary was installed for the synthetic roundtrip drill;
all generated keys were temporary test keys. Full application restoration and
live disaster recovery remain unproven.

Release branch: `codex/channex-recovery-release`, based on the owned
`codex/channex-recovery-foundation` work at main
`f3c559783c2e718edfdd5bd16abbb6df0f7084ac`, integrated with main
`e661ea1fdefbf57805ef18b5a721cf716dcb8f65` for deployment. The initial verifier commit is
`62d7f988`. This batch adds the three worker modules, upload CLI, worker tests,
signed-manifest support in the existing verification CLI, and the pinned official
Google auth dependency/lockfile. Validation results are recorded in the handoff.
Validation after main integration: **3,682 tests passed, zero skipped**, including the real age roundtrip
and synthetic Drive failure cases; `npx tsc --noEmit`, focused ESLint, and
`git diff --check` passed. The real-age tests were explicitly enabled for this run.
All work is in the owned isolated worktree; the shared checkout and its environment
files were not changed. The approved release proceeds through PR checks and a
verified Vercel deployment. This remains code delivery, not backup activation.
