import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BODY_MAX,
  BODY_MIN,
  NAME_MAX,
  displayName,
  isTestimonialToken,
  parseInvite,
  parseSubmission,
  reviewMonth,
  toPublicTestimonial,
} from '../guest-testimonials.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('a token is 32 hex characters and nothing else', () => {
  assert.ok(isTestimonialToken('0123456789abcdef0123456789abcdef'));
  assert.ok(!isTestimonialToken('0123456789ABCDEF0123456789abcdef'));
  assert.ok(!isTestimonialToken('0123456789abcdef0123456789abcde'));
  assert.ok(!isTestimonialToken(''));
  assert.ok(!isTestimonialToken(null));
});

test("the sweep's invite names the stay and the home, and nothing else is trusted", () => {
  const ok = parseInvite({ reservation_id: 'res_1', property_id: '21_horton', guest_first: ' Ann ', check_in: '2026-10-20T15:00:00Z', check_out: '2026-10-24', channel: '' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, { reservation_id: 'res_1', property_id: '21_horton', guest_first: 'Ann', check_in: '2026-10-20', check_out: '2026-10-24', channel: 'Direct' });
  }
  assert.deepEqual(parseInvite({ property_id: '21_horton' }), { ok: false, error: 'reservation_id' });
  assert.deepEqual(parseInvite({ reservation_id: 'res_1', property_id: '21 horton' }), { ok: false, error: 'property_id' });
  const odd = parseInvite({ reservation_id: 'res_1', property_id: '21_horton', check_in: 'tomorrow', guest_first: 42 });
  assert.ok(odd.ok && odd.value.check_in === null && odd.value.guest_first === '');
});

test('a submission is a whole-star rating and at least a sentence', () => {
  const body = 'We had the loveliest week by the water, thank you all.';
  const ok = parseSubmission({ rating: '5', body, guest_name: 'Ann E.', show_name: 'on' });
  assert.deepEqual(ok, { ok: true, value: { rating: 5, body, guest_name: 'Ann E.', show_name: true } });
  for (const rating of [0, 6, 4.5, 'five', undefined]) {
    assert.deepEqual(parseSubmission({ rating, body }), { ok: false, error: 'rating' }, String(rating));
  }
  assert.deepEqual(parseSubmission({ rating: 5, body: 'Great.' }), { ok: false, error: 'body_short' });
  assert.deepEqual(parseSubmission({ rating: 5, body: 'x'.repeat(BODY_MAX + 1) }), { ok: false, error: 'body_long' });
  assert.deepEqual(parseSubmission({ rating: 5, body, guest_name: 'a'.repeat(NAME_MAX + 1) }), { ok: false, error: 'name_long' });
  assert.ok(BODY_MIN < BODY_MAX);
});

test('what the guest typed is kept, their keyboard is not', () => {
  const r = parseSubmission({ rating: 4, body: '  Lovely\u0007 stay.\r\n\r\n\r\n\r\nWould   come back.  ', guest_name: '\tAnn\u0000  Example ', show_name: false });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.body, 'Lovely stay.\n\nWould come back.');
    assert.equal(r.value.guest_name, 'Ann Example');
    assert.equal(r.value.show_name, false);
  }
  const dflt = parseSubmission({ rating: 4, body: 'Lovely stay, we would come back any time.' });
  assert.ok(dflt.ok && dflt.value.show_name === true, 'a form that says nothing about the name shows it');
});

test('how a guest is named on the site', () => {
  assert.equal(displayName({ guest_name: 'Ann E.', guest_first: 'Ann', show_name: true }), 'Ann E.');
  assert.equal(displayName({ guest_name: '', guest_first: 'Ann', show_name: true }), 'Ann');
  assert.equal(displayName({ guest_name: '', guest_first: '', show_name: true }), 'A Stay Cape Ann guest');
  assert.equal(displayName({ guest_name: 'Ann E.', guest_first: 'Ann', show_name: false }), 'A Stay Cape Ann guest');
});

test("the site's review card gets the month of the stay", () => {
  assert.equal(reviewMonth({ check_out: '2026-10-24', submitted_at: '2026-11-02T10:00:00Z' }), '2026-10');
  assert.equal(reviewMonth({ check_out: null, submitted_at: '2026-11-02T10:00:00Z' }), '2026-11');
  assert.equal(reviewMonth({ check_out: null, submitted_at: null }), '');
  assert.deepEqual(
    toPublicTestimonial({ guest_name: 'Ann E.', guest_first: 'Ann', show_name: true, check_out: '2026-10-24', submitted_at: null, rating: 5, body: 'Lovely.' }),
    { name: 'Ann E.', date: '2026-10', rating: 5, text: 'Lovely.' },
  );
});

test('every testimonials route is public by prefix and checks the concierge header before touching the table', () => {
  const proxy = read('src/proxy.ts');
  const list = proxy.slice(proxy.indexOf('const PUBLIC_API_PREFIXES'), proxy.indexOf('];', proxy.indexOf('const PUBLIC_API_PREFIXES')));
  assert.ok(list.includes('"/api/testimonials"'), 'proxy.ts lists /api/testimonials');
  const routes = ['src/app/api/testimonials/route.ts', 'src/app/api/testimonials/invite/route.ts', 'src/app/api/testimonials/[token]/route.ts'];
  for (const r of routes) {
    const src = read(r);
    for (const handler of src.split(/export async function /).slice(1)) {
      const auth = handler.indexOf('authorizeStayConcierge(req)');
      assert.ok(auth > -1, `${r}: ${handler.slice(0, 20)} checks the header`);
      const firstStore = handler.search(/await (inviteTestimonial|propertyExists|testimonialByToken|submitTestimonial|approvedTestimonials|propertyForGuestyListing|propertyTitle)\(/);
      assert.ok(firstStore === -1 || auth < firstStore, `${r}: ${handler.slice(0, 20)} checks the header before any read`);
    }
    assert.ok(!/searchParams\.get\(['"]key['"]\)/.test(src), `${r}: never a key in the query string`);
  }
  // The table grants itself in the same migration (migration-grants.test.ts
  // holds the general rule; this names the one the routes depend on).
  const mig = readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).find((f) => f.endsWith('_guest_testimonials.sql'));
  assert.ok(mig, 'the guest_testimonials migration exists');
  const sql = read(`supabase/migrations/${mig}`);
  assert.ok(/enable row level security/i.test(sql));
  assert.ok(/grant all on public\.guest_testimonials to service_role/i.test(sql));
  assert.ok(/reservation_id text not null unique/.test(sql), 'one testimonial per stay');
});

test('a database error is logged with its code and message, never "[object Object]"', async () => {
  // The store imports the Supabase client, so read the helper's source rather
  // than importing it: the rule is that no route stringifies the error itself.
  const store = read('src/lib/guest-testimonials-store.ts');
  assert.ok(/export function dbErrorText\(err: unknown\): string/.test(store));
  for (const r of ['src/app/api/testimonials/route.ts', 'src/app/api/testimonials/invite/route.ts', 'src/app/api/testimonials/[token]/route.ts']) {
    const src = read(r);
    assert.ok(!/String\(err\)/.test(src), `${r}: never String(err)`);
    assert.ok((src.match(/dbErrorText\(err\)/g) ?? []).length >= 1, `${r}: logs dbErrorText`);
  }
});
