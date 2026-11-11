/** Real Postgres tests, synthetic loopback database only. No .env loading. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.env.PGDATABASE !== 'helm_synthetic_channex' || process.env.PGHOST !== '127.0.0.1') {
  throw Error('Set PGHOST=127.0.0.1 and PGDATABASE=helm_synthetic_channex; never run against a hosted database');
}
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const canonical = read('supabase/migrations/20260926200000_helm_pms_plumbing.sql');
const functions = ['helm_row_conflicts', 'helm_create_booking', 'helm_move_booking'].map(name => {
  const start = canonical.indexOf(`create or replace function public.${name}(`);
  const end = canonical.indexOf('$$;', start);
  if (start < 0 || end < 0) throw Error('Canonical booking function not found');
  return canonical.slice(start, end + 3);
}).join('\n');
const sql = [read('scripts/tests/channex-fixture.sql'), functions,
  read('supabase/migrations/20261106103000_channex_inventory_capture.sql'),
  read('supabase/migrations/20261106103100_channex_booking_receipts.sql'),
  read('supabase/migrations/20261106103200_channex_runtime_status.sql'),
  read('supabase/migrations/20261106110000_channex_inventory_plans.sql'),
  read('supabase/migrations/20261106120000_channex_inventory_delivery.sql'),
  read('supabase/migrations/20261106130000_channex_booking_audit.sql'),
  read('supabase/migrations/20261106140000_channex_existing_stay_guard.sql'),
  read('supabase/migrations/20261110150000_channex_preack_guest_details.sql'),
  read('supabase/migrations/20261111010000_channex_availability_acceptance.sql'),
  read('scripts/tests/channex-booking-audit.sql'),
  read('scripts/tests/channex-bookings.sql'),
  read('scripts/tests/channex-existing-stays.sql'),
  read('scripts/tests/channex-inventory.sql'),
  read('scripts/tests/channex-delivery.sql')].join('\n');
const result = spawnSync(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
if (result.status) { process.stderr.write(result.stderr); process.exit(result.status); }
// A release must refuse to replace the contract on an active importer. This
// fixture has enabled the synthetic import scope; the failed transaction must
// leave the existing function untouched.
const guard = spawnSync(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: read('supabase/migrations/20261110150000_channex_preack_guest_details.sql'), encoding: 'utf8',
});
if (guard.status === 0 || !guard.stderr.includes('disable_channex_ingestion_before_migration')) {
  throw Error('Pre-ACK migration did not refuse the active synthetic importer');
}
const deliveryGuard = spawnSync(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: read('supabase/migrations/20261111010000_channex_availability_acceptance.sql'), encoding: 'utf8',
});
if (deliveryGuard.status === 0 || !deliveryGuard.stderr.includes('disable_empty_channex_delivery_before_migration')) {
  throw Error('Acceptance migration did not refuse the active synthetic scope');
}
console.log('PASS: real Postgres booking receipts, canonical writers, inventory invalidation, and permissions');
