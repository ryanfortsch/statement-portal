import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { cleanTown, contractorPhone, payoutChanged, phoneDigits } from '../field-contractor-details.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a phone is ten digits in the house style; anything else is refused', () => {
  assert.equal(contractorPhone('9785550123'), '(978) 555-0123');
  assert.equal(contractorPhone('+1 978 555 0123'), '(978) 555-0123');
  assert.equal(contractorPhone('555-0123'), null);
  assert.equal(contractorPhone(''), null);
  assert.equal(phoneDigits('(978) 555-0123'), phoneDigits('+19785550123'));
  assert.equal(cleanTown('  Beverly,   MA '), 'Beverly, MA');
});

test('a payout is a change only when the method or the details differ; blank keeps it', () => {
  const onFile = { method: 'Venmo', details: '@sam' };
  assert.equal(payoutChanged(onFile, { method: '', details: '' }), false);
  assert.equal(payoutChanged(onFile, { method: 'Venmo', details: '@sam ' }), false);
  assert.equal(payoutChanged(onFile, { method: 'Venmo', details: '@sam-new' }), true);
  assert.equal(payoutChanged(onFile, { method: 'Check', details: '' }), true);
  assert.equal(payoutChanged({ method: null, details: null }, { method: 'Zelle', details: 'sam@example.test' }), true);
});

// Run the real server action against a synthetic contractor.
const actions = read('../../app/field/actions.ts');
const body = actions.slice(actions.indexOf('export type DetailsState'), actions.indexOf('/** Start (or resume) the inspection for one stop'));
const code = ts.transpileModule(body.replaceAll('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

class Redirect { url: string; constructor(url: string) { this.url = url; } }

function fixture() {
  const row = {
    id: 'c-1', full_name: 'Synthetic Person', email: 'synthetic@example.test', phone: '(978) 555-0123' as string | null,
    payment_method: 'Venmo' as string | null, payment_hint: '@sam' as string | null, home_lat: 42.6, home_lng: -70.66,
    updated_at: 'x',
  };
  const secret = { details: '@sam' as string | null };
  const calls = { savePayment: 0, emails: 0, events: [] as unknown[], tables: [] as string[], geocoded: [] as string[] };
  const fieldDb = () => ({
    from: (table: string) => {
      calls.tables.push(table);
      let patch: Record<string, unknown> | null = null;
      const q = {
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (patch) Object.assign(row, patch);
          return { data: patch ? { id: row.id } : { payment_method: row.payment_method, payment_hint: row.payment_hint }, error: null };
        },
      };
      return q;
    },
  });
  const deps = {
    resolveContractorFromCookie: async () => ({ ...row }),
    redirect: (url: string) => { throw new Redirect(url); },
    contractorPhone, cleanTown, payoutChanged, phoneDigits,
    homeBaseFor: async (town: string) => { calls.geocoded.push(town); return /nowhere/i.test(town) ? null : { lat: 42.55, lng: -70.88 }; },
    PAYMENT_METHODS: ['Venmo', 'Zelle', 'PayPal', 'Cash App', 'Direct deposit (ACH)', 'Check'],
    revealPayment: async () => secret.details,
    savePayment: async (_id: string, method: string, details: string) => {
      calls.savePayment++;
      row.payment_method = method; row.payment_hint = details || 'mailed check'; secret.details = details; row.updated_at = 'y';
      return null;
    },
    fieldDb,
    logEvent: async (e: unknown) => { calls.events.push(e); },
    sendPayoutChangedEmails: async () => { calls.emails++; return { office: true, contractor: true }; },
    revalidatePath: () => {},
  };
  const names = Object.keys(deps);
  const updateContractorDetails = new Function(...names, code + '; return updateContractorDetails;')(...Object.values(deps)) as
    (prev: { error: string }, fd: FormData) => Promise<{ error: string }>;
  const save = async (fields: Record<string, string>) => {
    const fd = new FormData();
    const all = { phone: '(978) 555-0123', home_town: 'Gloucester, MA', home_town_was: 'Gloucester, MA', payment_method: '', payment_details: '', ...fields };
    for (const [k, v] of Object.entries(all)) fd.set(k, v);
    try {
      return await updateContractorDetails({ error: '' }, fd);
    } catch (e) {
      if (e instanceof Redirect) return { redirected: e.url };
      throw e;
    }
  };
  return { row, calls, save };
}

test('a new payout handle saves through savePayment and tells the office once, even on a retry', async () => {
  const { row, calls, save } = fixture();
  const first = await save({ payment_method: 'Venmo', payment_details: '@sam-new' });
  assert.match(String((first as { redirected?: string }).redirected), /^\/field\/profile\?saved=/);
  assert.equal(calls.savePayment, 1);
  assert.equal(calls.emails, 1);
  assert.equal(row.payment_hint, '@sam-new');
  await save({ payment_method: 'Venmo', payment_details: '@sam-new' });
  assert.equal(calls.savePayment, 1, 'the same save again rewrites nothing');
  assert.equal(calls.emails, 1, 'and does not tell the office twice');
});

test('a blank method keeps the payout; a phone change saves without emailing the office', async () => {
  const { row, calls, save } = fixture();
  await save({ phone: '978-555-9999' });
  assert.equal(row.phone, '(978) 555-9999');
  assert.equal(calls.savePayment, 0);
  assert.equal(calls.emails, 0);
  assert.equal(calls.events.length, 1);
});

test('a moved contractor sets a new home town; one that cannot be placed is refused with nothing saved', async () => {
  const { row, calls, save } = fixture();
  const refused = await save({ home_town: 'Nowhere, ZZ', payment_method: 'Zelle', payment_details: 'sam@example.test' });
  assert.match((refused as { error: string }).error, /could not place that town/i);
  assert.equal(calls.savePayment, 0, 'a refused town saves no payout either');
  assert.equal(row.home_lat, 42.6);
  await save({ home_town: 'Beverly, MA' });
  assert.equal(row.home_lat, 42.55);
  assert.deepEqual((calls.events.at(-1) as { payload: { home_town: string } }).payload.home_town, 'Beverly, MA');
  await save({ home_town: 'Gloucester, MA' });
  assert.deepEqual(calls.geocoded, ['Nowhere, ZZ', 'Beverly, MA'], 'an unchanged town is not looked up again');
});

test('bad input is refused with the typed values kept; the W-9 is never touched', async () => {
  const { calls, save } = fixture();
  assert.match(((await save({ phone: '555' })) as { error: string }).error, /10-digit/);
  assert.match(((await save({ payment_method: 'Bitcoin', payment_details: 'x' })) as { error: string }).error, /from the list/);
  assert.equal(calls.savePayment, 0);
  await save({ phone: '9785550000', home_town: 'Beverly, MA', payment_method: 'Check' });
  assert.ok(!calls.tables.includes('contractor_w9'), 'the action never writes the W-9');
  assert.ok(!body.includes('saveW9'), 'and never calls saveW9');
});

test('the profile form uses the retained-submission pattern and says the W-9 stays as filed', () => {
  const form = read('../../app/field/profile/EditDetailsForm.tsx');
  assert.match(form, /useRetainedSubmission\(updateContractorDetails/);
  assert.match(form, /<PaymentFields/);
  assert.match(form, /Your W-9 stays as filed\. A new legal name, address or tax ID means a new W-9/);
  assert.match(form, /A change emails the office/);
  const profile = read('../../app/field/profile/page.tsx');
  assert.match(profile, /<EditDetailsForm/);
  for (const src of [form, profile, body]) assert.ok(!/[–—]/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/'—'/g, '')), 'no em dashes in rendered strings');
});
