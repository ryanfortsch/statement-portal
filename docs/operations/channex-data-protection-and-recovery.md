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
is not authenticity. Signed manifests/receipts and key management are in the next
implementation slice. Never use this checker as an automatic cutover switch.

Restore evidence is operator-supplied, bound to the exact manifest and application
commit, and does not execute or independently attest the listed checks. Before
launch, restore the exact candidate bundle. Routine daily integrity monitoring
and weekly restore-drill freshness will be separate scheduler checks; this CLI
does not require every daily copy to pass a full restore to be stored.

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
- [age](https://github.com/FiloSottile/age): established public-key file encryption.

## Handoff / verification

No database migrations, exports of customer data, Drive uploads, permission
changes, keys, paid features, production settings or deployments were performed.
The verifier is intentionally standalone until producer and monitoring work lands.
Local unit tests exercise synthetic bytes, not an actual encrypted DB export or
restored application. Full restore and live disaster recovery remain unproven.

Changed files are the three implementation/test paths listed above and this
scope document. Validation on the branch: full `npm test` (3,642 passing),
`npx tsc --noEmit`, focused ESLint, and whitespace/diff review. Dependencies were
installed from the branch lockfile in its isolated worktree; no shared checkout
dependency tree or environment file was changed.
