/**
 * Notices reach people by role and duty, dated to their start.
 *
 * Every office-bound Field email used to name an inbox: contractor threads
 * CC'd one address, the digest and packet alerts went to one address, the
 * creative reminders to another. The operations manager would have joined
 * none of them on 2026-11-01 without someone editing code that morning.
 * Now the team list says who runs operations, who approves field pay and
 * who runs the creative program, and a `starts` date puts a member on each
 * list that day. These tests pin the day-before / day-of behaviour and keep
 * the notifier free of named inboxes.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  creativeLeadEmail,
  dutyEmails,
  fieldPayNotice,
  fieldReplyTo,
  officeNotice,
  onTeam,
  operationsEmails,
  todayET,
} from '../team-recipients.ts';
import { TEAM_MEMBERS, getTeamMember, isOwnWork } from '../team.ts';
import { EMPLOYEE_PAYEES } from '../overhead-categories.ts';
import { SALARY_START_MONTH, SALARY_START_YEAR } from '../forecast-model.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const RYAN = 'ryan@risingtidestr.com';
const ALLIE = 'allie@risingtidestr.com';
const DOTTI = 'dotti@risingtidestr.com';
const DELANEY = 'delaney@risingtidestr.com';
const EVE = '2026-10-31';
const DAY = '2026-11-01';

describe('the operations manager joins the lists on her start date', () => {
  test('operations seats: the owners seat alone the day before, both from the day', () => {
    assert.deepEqual(operationsEmails(EVE), [ALLIE]);
    assert.deepEqual(operationsEmails(DAY), [ALLIE, DELANEY]);
    assert.deepEqual(operationsEmails('2027-06-15'), [ALLIE, DELANEY]);
  });

  test('contractor replies land with the staff operations manager once she has started', () => {
    assert.equal(fieldReplyTo(EVE), ALLIE);
    assert.equal(fieldReplyTo(DAY), DELANEY);
  });

  test('an office notice goes to the first operations seat with the rest and field pay on copy', () => {
    assert.deepEqual(officeNotice(EVE), { to: ALLIE, cc: [RYAN] });
    assert.deepEqual(officeNotice(DAY), { to: ALLIE, cc: [DELANEY, RYAN] });
  });

  test('a contractor question goes to whoever approves field pay, operations on copy', () => {
    assert.deepEqual(fieldPayNotice(EVE), { to: RYAN, cc: [ALLIE] });
    assert.deepEqual(fieldPayNotice(DAY), { to: RYAN, cc: [ALLIE, DELANEY] });
  });

  test('the creative program stays with its lead on both days', () => {
    assert.equal(creativeLeadEmail(EVE), DOTTI);
    assert.equal(creativeLeadEmail(DAY), DOTTI);
    assert.deepEqual(dutyEmails('creative', DAY), [DOTTI]);
    assert.deepEqual(dutyEmails('field_pay', DAY), [RYAN]);
  });

  test('onTeam honours active and the start date; todayET is a Gloucester date', () => {
    const d = getTeamMember(DELANEY)!;
    assert.equal(onTeam(d, EVE), false);
    assert.equal(onTeam(d, DAY), true);
    assert.equal(onTeam({ ...d, active: false }, DAY), false);
    assert.equal(onTeam(getTeamMember(RYAN)!, '2020-01-01'), true, 'no start date means always on');
    assert.match(todayET(new Date('2026-11-01T03:30:00Z')), /^2026-10-31$/, 'UTC 03:30 is still the previous evening in Gloucester');
  });
});

describe('the start date is written once and agrees everywhere', () => {
  test('team list, payroll matcher and forecast all say 2026-11-01', () => {
    assert.equal(getTeamMember(DELANEY)!.starts, DAY);
    assert.equal(EMPLOYEE_PAYEES.find((p) => p.needle === 'DELANEY')!.from, DAY);
    assert.equal(`${SALARY_START_YEAR}-${String(SALARY_START_MONTH).padStart(2, '0')}-01`, DAY);
  });

  test('exactly one person approves field pay and one runs the creative program; Ryan and Dotti dispatch', () => {
    assert.deepEqual(TEAM_MEMBERS.filter((m) => m.duties?.includes('field_pay')).map((m) => m.email), [RYAN]);
    assert.deepEqual(TEAM_MEMBERS.filter((m) => m.duties?.includes('creative')).map((m) => m.email), [DOTTI]);
    assert.deepEqual(TEAM_MEMBERS.filter((m) => m.duties?.includes('dispatch')).map((m) => m.email), [RYAN, DOTTI]);
  });
});

describe('the notifier names no inbox', () => {
  test('field-notify.ts carries no team address and resolves every office send by role', () => {
    const src = read('src/lib/field-notify.ts');
    assert.ok(!/@risingtidestr\.com/.test(src), 'a teammate inbox is named in field-notify.ts');
    assert.ok(!src.includes('OFFICE_CC'), 'OFFICE_CC is back');
    assert.ok(src.includes('replyTo: fieldReplyTo()'), 'the wrapper must route replies through fieldReplyTo()');
    assert.equal((src.match(/\.\.\.officeNotice\(\)/g) ?? []).length, 5, 'onboarded, streak, digest, applicant and packet-submitted go to the office');
    assert.equal((src.match(/cc: operationsEmails\(\)/g) ?? []).length, 5, 'the five contractor-facing sends keep operations on copy');
    assert.ok(src.includes('...fieldPayNotice()'), 'the contractor question goes to field pay');
    assert.equal((src.match(/to: creativeLeadEmail\(\)/g) ?? []).length, 3, 'the three creative notices go to the creative lead');
  });
});

describe('nobody approves their own Field work (2026-10-20)', () => {
  test('her contractor record is her own work', () => {
    assert.equal(isOwnWork('delaney@risingtidestr.com', 'delaneyjordan@outlook.com'), true);
    assert.equal(isOwnWork('Delaney@RisingTideSTR.com', ' DelaneyJordan@Outlook.com '), true);
  });
  test('the same address is own work', () => {
    assert.equal(isOwnWork('ryan@risingtidestr.com', 'ryan@risingtidestr.com'), true);
  });
  test('someone else is not', () => {
    assert.equal(isOwnWork('delaney@risingtidestr.com', 'james@example.com'), false);
    assert.equal(isOwnWork('ryan@risingtidestr.com', 'delaneyjordan@outlook.com'), false);
  });
  test('a missing address is never a match', () => {
    assert.equal(isOwnWork('delaney@risingtidestr.com', null), false);
    assert.equal(isOwnWork(null, 'delaneyjordan@outlook.com'), false);
  });
});
