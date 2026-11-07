/** Actual SQL projection through the TypeScript audit boundary, synthetic only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseCanonicalSnapshot, compareBookingCollections } from '../src/lib/channex-bookings/reconciliation.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const result = spawnSync(psql, ['-X','-Atq','-v','ON_ERROR_STOP=1'], {encoding:'utf8',input:`
begin;
update public.helm_inventory_capture_scopes set enabled=false where property_id='65_calderwood';
truncate public.bookings cascade;
update public.properties set calendar_authority='guesty' where id='65_calderwood';
insert into public.bookings(id,property_id,channel,source,status,check_in,check_out,external_confirmation_code,guest_name)
values('00000000-0000-4000-8000-000000000001','65_calderwood','airbnb','manual','confirmed','2026-11-10','2026-11-12','SYNTHETIC-AUDIT','PRIVATE_SENTINEL');
set local role service_role;
select public.helm_channex_booking_audit_snapshot();
rollback;`});
if (result.status) throw Error(result.stderr);
assert.equal(result.stdout.includes('PRIVATE_SENTINEL'),false);
const snapshot = parseCanonicalSnapshot(JSON.parse(result.stdout.trim()));
const report = compareBookingCollections(snapshot,[],{start:'2026-11-06',end:'2027-11-06'});
assert.equal(report.counts.missing_in_channex,1);
assert.equal(report.completeCoverage,false);
assert.equal(report.bookingsChanged,0);
console.log('PASS: actual service-role SQL projection, strict TypeScript shape, PII exclusion and missing-stay comparison');
