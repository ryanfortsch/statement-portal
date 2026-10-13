/**
 * An employee is never paid as a contractor.
 *
 * The first W-2 hire was an inspection contractor first, and her record
 * stays on the roster for the history behind it. From her start date three
 * things must never happen again, because each is a second payment on top
 * of a salary: a paid packet awarded to or claimed by her, a "new work near
 * you" text to her, a streak bonus landing on one of her packets.
 *
 * canClaim() is the one gate most of the Field module reads, so the pure
 * test covers it; the notify query and the streak award read the column
 * themselves, so those are source guards, the same shape as
 * shoot-offer-optin.test.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canClaim, isEmployee, onboardingComplete } from '../field-types.ts';
import { TEAM_MEMBERS, getTeamMember } from '../team.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const onboarded = {
  status: 'active' as const,
  agreement_signed_at: '2026-06-20T00:00:00Z',
  w9_on_file: true,
  background_check_status: 'cleared' as const,
};

describe('canClaim and the employee flag', () => {
  test('a fully onboarded, cleared contractor can claim', () => {
    assert.equal(onboardingComplete(onboarded), true);
    assert.equal(canClaim({ ...onboarded, employment_status: 'contractor' }), true);
    // A row read before the column existed still behaves as a contractor.
    assert.equal(canClaim(onboarded), true);
    assert.equal(isEmployee({}), false);
    assert.equal(isEmployee({ employment_status: 'contractor' }), false);
  });

  test('the same person on payroll can never claim, however onboarded they are', () => {
    const employee = { ...onboarded, employment_status: 'employee' as const };
    assert.equal(isEmployee(employee), true);
    assert.equal(canClaim(employee), false);
    assert.equal(canClaim({ ...employee, background_check_status: 'pending' }), false);
    // Flipping back restores the contractor path.
    assert.equal(canClaim({ ...employee, employment_status: 'contractor' }), true);
  });
});

describe('the other two payment paths read the flag themselves', () => {
  test('new-work texts skip employees', () => {
    const src = read('src/lib/field-notify.ts');
    const fn = src.slice(src.indexOf('export async function notifyContractorsOfPacket'));
    assert.ok(fn.includes(".eq('employment_status', 'contractor')"), 'notifyContractorsOfPacket must filter employees out of the text list');
  });

  test('streak bonuses never land on an employee packet', () => {
    const src = read('src/lib/field-streaks.ts');
    const fn = src.slice(src.indexOf('export async function maybeAwardStreakBonus'));
    assert.ok(fn.includes("employment_status === 'employee') return null"), 'maybeAwardStreakBonus must return null for an employee');
    // The check sits before the award, not after.
    assert.ok(fn.indexOf("employment_status === 'employee'") < fn.indexOf("from('streak_awards')"));
  });

  test('the flag is flipped by an owner on the roster and the column is in the schema', () => {
    const actions = read('src/app/fieldwork/packets/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function setContractorEmployment'));
    assert.ok(fn.includes('await ownerEmail()'), 'only an owner may mark someone an employee');
    assert.ok(fn.includes("next !== 'contractor' && next !== 'employee'"), 'the value is allowlisted');
    const roster = read('src/app/fieldwork/roster/page.tsx');
    assert.ok(roster.includes('action={setContractorEmployment}'));
    const migration = read('supabase/migrations/20261012100000_contractors_employment_status.sql');
    assert.ok(migration.includes("add column if not exists employment_status text not null default 'contractor'"));
    assert.ok(migration.includes("check (employment_status in ('contractor', 'employee'))"));
  });
});

describe('the operations manager is on the team list as staff', () => {
  test('delaney@risingtidestr.com resolves, as staff, not an owner', () => {
    const m = getTeamMember('delaney@risingtidestr.com');
    assert.ok(m, 'Delaney must be on TEAM_MEMBERS');
    assert.equal(m!.access, 'staff');
    assert.equal(m!.active, true);
    assert.equal(m!.short, 'Delaney');
    assert.equal(TEAM_MEMBERS.filter((t) => t.access === 'owner').length, 3, 'exactly three owners');
  });
});
