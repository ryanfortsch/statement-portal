/** Explicit upload of an already signed/encrypted bundle; no DB access, export, or scheduling. */
import { parseArgs } from 'node:util';
import { uploadRecoveryBundle } from '../src/lib/recovery-drive.ts';
import { createRecoveryTokenProvider } from '../src/lib/recovery-google-auth.ts';

try {
  const { values: v } = parseArgs({ options: {
    directory: { type: 'string' }, project: { type: 'string' }, environment: { type: 'string' }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (v.help) {
    console.log('Upload a signed encrypted bundle: --directory PATH --project REF --environment staging|production');
    console.log('Requires dedicated RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY, RECOVERY_GOOGLE_SERVICE_ACCOUNT_EMAIL,');
    console.log('RECOVERY_DRIVE_ID, RECOVERY_DRIVE_FOLDER_ID, RECOVERY_SIGNING_PRIVATE_KEY, RECOVERY_SIGNING_PUBLIC_KEY.');
    console.log('Review destination membership and key custody first. No existing archive identity or .env is loaded.');
  } else {
    if (!v.directory || !v.project || !/^[a-z]{20}$/.test(v.project) || !['staging', 'production'].includes(v.environment ?? '')) throw new Error();
    const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(); return value; };
    const report = await uploadRecoveryBundle({ directory: v.directory,
      expectedScope: { projectRef: v.project, environment: v.environment as 'staging' | 'production' },
      driveId: required('RECOVERY_DRIVE_ID'), folderId: required('RECOVERY_DRIVE_FOLDER_ID'),
      signingPrivateKey: required('RECOVERY_SIGNING_PRIVATE_KEY'), trustedSigningPublicKey: required('RECOVERY_SIGNING_PUBLIC_KEY'),
      getAccessToken: createRecoveryTokenProvider(required('RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY'), required('RECOVERY_GOOGLE_SERVICE_ACCOUNT_EMAIL')),
      signal: AbortSignal.timeout(4 * 60 * 60 * 1000),
    });
    console.log(JSON.stringify(report));
  }
} catch {
  console.error('Recovery upload failed. Check dedicated configuration, local bundle, and destination access; no success is recorded.');
  process.exitCode = 1;
}
