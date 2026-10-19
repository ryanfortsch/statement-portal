import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { backgroundCheckLine, backgroundCheckNotice, FIELD_OFFICE_PHONE } from '../field-background-check.ts';
import { canClaim } from '../field-types.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('one line per background-check state, read off the real status', () => {
  assert.equal(backgroundCheckLine('not_started').line, 'Your background check starts once the office reviews your setup.');
  assert.equal(backgroundCheckLine('pending').line, 'Your background check is running. You can already claim work.');
  assert.equal(backgroundCheckLine('cleared').tone, 'cleared');
  assert.match(backgroundCheckLine('failed').line, /call the office/i);
  assert.ok(backgroundCheckLine('failed').line.includes(FIELD_OFFICE_PHONE));
  assert.equal(backgroundCheckLine(null).tone, 'waiting', 'a missing status reads as not started');
  for (const s of ['not_started', 'pending', 'cleared', 'failed'] as const) {
    assert.ok(!/[\u2013\u2014]/.test(backgroundCheckLine(s).line), `${s}: no em or en dashes`);
  }
});

test('running and cleared are told to the contractor; a reset or a failed check sends nothing', () => {
  const running = backgroundCheckNotice('pending');
  const cleared = backgroundCheckNotice('cleared');
  assert.ok(running && cleared);
  assert.match(running.sms, /^Rising Tide Field: /);
  assert.match(running.body, /claim/i, 'running says they can already claim');
  assert.match(cleared.heading, /all set/i);
  assert.equal(backgroundCheckNotice('not_started'), null);
  assert.equal(backgroundCheckNotice('failed'), null, 'a failed check is a phone call, never a text');
  for (const n of [running, cleared]) {
    for (const v of Object.values(n)) assert.ok(!/[\u2013\u2014]/.test(v), 'no em or en dashes in contractor messages');
  }
});

// Run the real roster action against a synthetic contractors table, so the
// test proves the action itself sends the notice, and only on a change.
const actions = read('../../app/fieldwork/packets/actions.ts');
const start = actions.indexOf('export async function setContractorBackgroundCheck');
const body = actions.slice(start, actions.indexOf('\n}\n', start) + 3);
const code = ts.transpileModule(body.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(initial: 'not_started' | 'pending' | 'cleared' | 'failed') {
  const row = {
    id: 'c-1', full_name: 'Synthetic Person', email: 'synthetic@example.test', phone: '9785550123', portal_token: 'tok',
    status: 'active', agreement_signed_at: '2026-10-01T00:00:00Z' as string | null, w9_on_file: true, employment_status: 'contractor',
    background_check_status: initial as string,
  };
  const sent: Array<{ to: string; status: string }> = [];
  const later: Array<Promise<unknown>> = [];
  const fieldDb = () => ({
    from: (table: string) => {
      assert.equal(table, 'contractors');
      let patch: Record<string, unknown> = {};
      const filters: Array<(r: typeof row) => boolean> = [];
      const q = {
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (k: keyof typeof row, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        neq: (k: keyof typeof row, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
        select: async () => {
          if (!filters.every((f) => f(row))) return { data: [], error: null };
          Object.assign(row, patch);
          return { data: [{ ...row }], error: null };
        },
      };
      return q;
    },
  });
  const setContractorBackgroundCheck = new Function(
    'ownerEmail', 'fieldDb', 'revalidatePath', 'after', 'sendBackgroundCheckNotice', 'canClaim',
    code + '; return setContractorBackgroundCheck;',
  )(
    async () => 'owner@example.test',
    fieldDb,
    () => {},
    (fn: () => Promise<unknown>) => { later.push(fn()); },
    async (c: { email: string }, status: string) => { sent.push({ to: c.email, status }); return { texted: true, emailed: true }; },
    canClaim,
  ) as (fd: FormData) => Promise<void>;
  const mark = async (status: string) => {
    const fd = new FormData();
    fd.set('contractor_id', 'c-1');
    fd.set('bg_status', status);
    await setContractorBackgroundCheck(fd);
    await Promise.all(later);
  };
  return { row, sent, mark };
}

test('the roster action sends the notice when the office changes the check', async () => {
  const { row, sent, mark } = fixture('not_started');
  await mark('pending');
  assert.equal(row.background_check_status, 'pending');
  assert.deepEqual(sent, [{ to: 'synthetic@example.test', status: 'pending' }]);
  await mark('cleared');
  assert.deepEqual(sent.map((s) => s.status), ['pending', 'cleared']);
});

test('once per change: marking the same status again sends nothing', async () => {
  const { sent, mark } = fixture('pending');
  await mark('pending');
  assert.equal(sent.length, 0, 'no change, no message');
  await Promise.all([mark('cleared'), mark('cleared')]);
  assert.equal(sent.length, 1, 'a double tap is one message');
});

test('nothing says "you can claim" to someone who cannot: setup unfinished, or on payroll', async () => {
  const unfinished = fixture('not_started');
  unfinished.row.agreement_signed_at = null;
  await unfinished.mark('pending');
  assert.equal(unfinished.row.background_check_status, 'pending', 'the status still changes');
  assert.equal(unfinished.sent.length, 0, 'but no message promises a claim they cannot make');
  const payroll = fixture('pending');
  payroll.row.employment_status = 'employee';
  await payroll.mark('cleared');
  assert.equal(payroll.sent.length, 0);
});

test('an unknown status is refused before any write', async () => {
  const { row, sent, mark } = fixture('not_started');
  await mark('approved');
  assert.equal(row.background_check_status, 'not_started');
  assert.equal(sent.length, 0);
});

test('the notifier stays silent for a state with no notice, and texts from the 24/7 line', () => {
  const notify = read('../field-notify.ts');
  const fn = notify.slice(notify.indexOf('export async function sendBackgroundCheckNotice'));
  const head = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(head, /const notice = backgroundCheckNotice\(next\);\s*\n\s*if \(!notice\) return/);
  assert.match(head, /resolveQuoFrom\(\)/, 'the text goes through the ops-line resolver');
});

test('every portal surface reads the one line; the retired wordings are gone', () => {
  const pages = {
    home: read('../../app/field/page.tsx'),
    packet: read('../../app/field/packet/[packetId]/page.tsx'),
    profile: read('../../app/field/profile/page.tsx'),
  };
  for (const [name, src] of Object.entries(pages)) {
    assert.match(src, /backgroundCheckLine\(/, `${name} reads backgroundCheckLine`);
    assert.ok(!src.includes('As soon as it&apos;s running we&apos;ll text and email you'), `${name}: the unconditional promise is gone`);
    assert.ok(!src.includes('background check hasn&apos;t started yet'), `${name}: the packet bar's own wording is gone`);
    assert.ok(!src.includes("'Background check pending'"), `${name}: not started is not called pending`);
  }
});
