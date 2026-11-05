import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  STAFF_CODES,
  planLockStaffCodes,
  staffCodeIntents,
  staffCodeName,
  type LockCodeLite,
  type StaffCodeIntent,
} from '../staff-code-rules.ts';
import { TEAM_MEMBERS } from '../team.ts';

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const FLEET = ['2222', '3333', '5555'];
const ann = { email: 'ann@risingtidestr.com', short: 'Ann', active: true };

test('every listed staff code survives the rules against the real roster and default fleet PINs', () => {
  const intents = staffCodeIntents(STAFF_CODES, TEAM_MEMBERS, FLEET, '2026-11-05');
  assert.equal(intents.length, STAFF_CODES.length, 'a listed code was silently dropped (collision, shape or roster)');
  assert.ok(intents.every((i) => i.wanted));
});

test('Delaney carries 7699, named so it reads as staff', () => {
  const [d] = staffCodeIntents(STAFF_CODES, TEAM_MEMBERS, FLEET, '2026-11-05');
  assert.deepEqual(d, { email: 'delaney@risingtidestr.com', code: '7699', name: 'Rising Tide Delaney', wanted: true });
  // classifyCodeRole maps /rising tide/ to staff; the name must keep that prefix.
  assert.match(src('lib/seam.ts'), /rising\\s\*tide/);
  assert.match(staffCodeName('X'), /^Rising Tide /);
});

test('a code that collides, repeats or is malformed is dropped entirely', () => {
  const members = [ann, { email: 'bo@x', short: 'Bo', active: true }];
  assert.equal(staffCodeIntents([{ email: ann.email, code: '3333' }], members, FLEET, '2026-11-05').length, 0);
  assert.equal(staffCodeIntents([{ email: ann.email, code: '0123' }], members, FLEET, '2026-11-05').length, 0);
  assert.equal(staffCodeIntents([{ email: ann.email, code: '12345' }], members, FLEET, '2026-11-05').length, 0);
  const shared = [{ email: ann.email, code: '4444' }, { email: 'bo@x', code: '4444' }];
  assert.equal(staffCodeIntents(shared, members, FLEET, '2026-11-05').length, 0);
  assert.equal(staffCodeIntents([{ email: 'nobody@x', code: '4444' }], members, FLEET, '2026-11-05').length, 0);
});

test('not wanted before the start date or after leaving', () => {
  const code = [{ email: ann.email, code: '4444' }];
  assert.equal(staffCodeIntents(code, [{ ...ann, starts: '2026-12-01' }], FLEET, '2026-11-05')[0].wanted, false);
  assert.equal(staffCodeIntents(code, [{ ...ann, starts: '2026-11-05' }], FLEET, '2026-11-05')[0].wanted, true);
  assert.equal(staffCodeIntents(code, [{ ...ann, active: false }], FLEET, '2026-11-05')[0].wanted, false);
});

const want: StaffCodeIntent = { email: ann.email, code: '4444', name: 'Rising Tide Ann', wanted: true };
const gone: StaffCodeIntent = { ...want, wanted: false };
const lock = (...codes: LockCodeLite[]) => codes;

test('creates where missing, at active and unmapped homes alike', () => {
  assert.deepEqual(planLockStaffCodes([want], lock(), true).map((a) => a.kind), ['create']);
  assert.deepEqual(planLockStaffCodes([want], lock(), null).map((a) => a.kind), ['create']);
});

test('a hand-programmed code with the same digits counts as present', () => {
  const codes = lock({ access_code_id: 'u1', code: '4444', name: 'Ann', managed: false });
  assert.deepEqual(planLockStaffCodes([want], codes, true).map((a) => a.kind), ['present']);
});

test('a home we no longer run gets nothing new and loses only Helm-made staff codes', () => {
  assert.deepEqual(planLockStaffCodes([want], lock(), false), []);
  const codes = lock(
    { access_code_id: 'm1', code: '4444', name: 'Rising Tide Ann', managed: true },
    { access_code_id: 'u1', code: '4444', name: 'Rising Tide Ann', managed: false },
  );
  const acts = planLockStaffCodes([want], codes, false);
  assert.deepEqual(acts.map((a) => (a.kind === 'revoke' ? a.accessCodeId : a.kind)), ['m1']);
});

test('leaving revokes the managed, named code and never a same-digit code under another name', () => {
  const codes = lock(
    { access_code_id: 'm1', code: '4444', name: 'Rising Tide Ann', managed: true },
    { access_code_id: 'm2', code: '4444', name: 'Owner', managed: true },
  );
  const acts = planLockStaffCodes([gone], codes, true);
  assert.deepEqual(acts.map((a) => (a.kind === 'revoke' ? a.accessCodeId : a.kind)), ['m1']);
});

test('the nightly sync and the Sync Seam devices button both converge staff codes', () => {
  assert.match(src('app/api/sync-seam/route.ts'), /ensureStaffCodes\(supabase, res\.deviceId, res\.propertyId\)/);
  assert.match(src('lib/guest-locks.ts'), /ensureStaffCodes\(sb, res\.deviceId, res\.propertyId\)/);
});

test('random guest and Field PINs skip every fleet and staff code', () => {
  for (const f of ['lib/guest-locks.ts', 'lib/field-locks.ts']) {
    assert.match(src(f), /if \(!isReservedPin\(pin\)\) return pin;/, f);
  }
  const s = src('lib/staff-codes.ts');
  assert.match(s, /\[CLEANER_CODE, INSPECTION_CODE, MAINTENANCE_CODE, CREATIVE_CODE\]/);
  assert.match(s, /STAFF_CODES\.some\(\(c\) => c\.code === pin\)/);
});

test('the staff code list never reaches a browser bundle', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      if (/from '[^']*staff-code-rules(\.ts)?'/.test(readFileSync(p, 'utf8'))) importers.push(p.slice(root.length));
    }
  };
  walk(root);
  assert.deepEqual(importers.sort(), ['lib/staff-codes.ts']);
  assert.match(src('lib/staff-codes.ts'), /^import 'server-only';/m);
});
