import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const modules = {
  apply: '../../app/field/apply/actions.ts', field: '../../app/field/actions.ts',
  today: '../../app/today/actions.ts', packet: '../../app/fieldwork/packets/actions.ts',
};
const compiled = Object.fromEntries(Object.entries(modules).map(([name, path]) => [name,
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
]));
type Request = { table: string; method: string; params: URLSearchParams; body: Record<string, unknown> | null };
function fixture(kind: keyof typeof modules, options: {
  signedIn?: boolean; fail?: (r: Request) => boolean; missing?: (r: Request) => boolean; status?: string;
} = {}) {
  const requests: Request[] = [], refreshed: string[] = [], effects: string[] = [];
  const client = createClient('https://synthetic.supabase.co', 'synthetic-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const r: Request = { table: url.pathname.split('/').at(-1)!, method: init?.method || 'GET', params: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
      requests.push(r);
      if (options.fail?.(r)) return new Response(JSON.stringify({ message: 'Synthetic database failure', code: 'TEST' }), { status: 400, headers: { 'content-type': 'application/json' } });
      let data: unknown = r.table === 'email_triage' ? { gmail_message_id: 'email-a', draft_id: 'draft-a' }
        : r.table === 'inspection_packets' ? { id: 'packet-a', status: options.status || 'draft' }
        : r.table === 'packet_stops' && r.method === 'GET' ? [{ id: 'a', walk_order: 0 }, { id: 'b', walk_order: 1 }]
        : { id: r.params.get('id')?.replace('eq.', '') || 'synthetic-id' };
      if (options.missing?.(r)) data = null;
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } },
  });
  const contractor = { id: 'contractor-a', email: 'person@example.test', full_name: 'Synthetic Person', phone: '9785550100', home_lat: null, home_lng: null };
  const deps: Record<string, unknown> = {
    '@supabase/supabase-js': { createClient: () => client }, '@/lib/field-db': { fieldDb: () => client },
    '@/auth': { auth: async () => options.signedIn === false ? null : { user: { email: 'staff@example.test' } } },
    '@/lib/field-auth': { resolveContractorFromCookie: async () => options.signedIn === false ? null : contractor },
    'next/cache': { revalidatePath: (p: string) => refreshed.push(p) },
    'next/navigation': { redirect: (p: string) => { effects.push('redirect:' + p); throw new Error('NEXT_REDIRECT'); } },
    'next/headers': { headers: async () => new Headers() },
    '@/lib/field-types': { parseTrade: (v: string) => v || 'inspection' },
    '@/lib/ai/screen-applicant': { screenApplication: async () => null },
    '@/lib/field-notify': { sendNewApplicantEmail: async () => { effects.push('applicant-notification'); }, sendContractorOnboardedEmail: async () => { effects.push('onboarded-notification'); } },
    '@/lib/field-w9': { saveW9: async () => null }, '@/lib/field-pay': { savePayment: async () => null },
    '@/lib/geocode': { geocodeAddress: async () => null },
    '@/lib/daily-brief': { deleteDraft: async (id: string) => { effects.push('delete:' + id); } },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exports: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(compiled[kind], { exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } }, require: (name: string) => deps[name] || {} });
  return { actions: exports, requests, refreshed, effects };
}
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ full_name: 'Synthetic Person', email: 'person@example.test', phone: '9785550100', area: 'Gloucester', has_transport: 'yes', agree: 'on', signed_name: 'Synthetic Person', sms_opt_in: 'on', w9_city: 'Gloucester', w9_state: 'MA', w9_zip: '01930', payment_method: 'Check' })) data.set(key, value);
  return data;
};

describe('contractor intake confirms writes before reporting success', () => {
  for (const mode of ['fail', 'missing'] as const) {
    test(`application ${mode} keeps the error ahead of notification and thanks redirect`, async () => {
      const f = fixture('apply', { [mode]: (r: Request) => r.table === 'contractor_applications' });
      assert.match((await f.actions.submitApplication({ error: '' }, form())).error, /Could not save/);
      assert.deepEqual(f.effects, []);
    });
    test(`account activation ${mode} prevents welcome notification and redirect`, async () => {
      const f = fixture('field', { [mode]: (r: Request) => r.table === 'contractors' });
      assert.match((await f.actions.completeOnboarding({ error: '' }, form())).error, /Could not finish/);
      assert.deepEqual(f.effects, []); assert.deepEqual(f.refreshed, []);
      assert.equal(f.requests.some((r) => r.table === 'packet_events'), false);
    });
  }
  test('invalid applications still return field validation without writes', async () => {
    const f = fixture('apply'); const data = form(); data.set('full_name', '');
    assert.match((await f.actions.submitApplication({ error: '' }, data)).error, /full name/);
    assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
  });
  test('confirmed applications retain the trade and video and redirect to thanks', async () => {
    const f = fixture('apply'); const data = form(); data.set('trade', 'creative'); data.set('video_url', 'https://synthetic.example/clip.mp4');
    await assert.rejects(f.actions.submitApplication({ error: '' }, data), /NEXT_REDIRECT/);
    assert.equal(f.requests[0].body?.trade, 'creative'); assert.equal(f.requests[0].body?.video_url, 'https://synthetic.example/clip.mp4');
    assert.deepEqual(f.effects, ['applicant-notification', 'redirect:/field/apply?submitted=1']);
  });
  test('confirmed onboarding uses the authenticated contractor and preserves the completion flow', async () => {
    const f = fixture('field'); await assert.rejects(f.actions.completeOnboarding({ error: '' }, form()), /NEXT_REDIRECT/);
    assert.equal(f.requests[0].params.get('id'), 'eq.contractor-a');
    assert.equal(f.requests[0].body?.status, 'active'); assert.equal(f.requests[0].body?.sms_opt_in, true);
    assert.deepEqual(f.effects, ['onboarded-notification', 'redirect:/field']);
  });
});

describe('text preference confirms the authenticated row', () => {
  for (const mode of ['fail', 'missing'] as const) test(`${mode} cannot report Saved`, async () => {
    const f = fixture('field', { [mode]: () => true });
    assert.equal((await f.actions.setSmsOptIn(false)).ok, false); assert.deepEqual(f.refreshed, []);
  });
  test('signed-out callers cannot write a preference', async () => {
    const f = fixture('field', { signedIn: false }); assert.equal((await f.actions.setSmsOptIn(false)).ok, false); assert.deepEqual(f.requests, []);
  });
  test('explicit opt-out and opt-in retain their exact values', async () => {
    const f = fixture('field');
    for (const target of [false, true]) assert.equal((await f.actions.setSmsOptIn(target)).ok, true);
    assert.deepEqual(f.requests.map((r) => r.body?.sms_opt_in), [false, true]);
    assert.ok(f.requests.every((r) => r.params.get('id') === 'eq.contractor-a'));
  });
});

describe('Handled failures do not retire an email or delete its draft', () => {
  test('requires staff authentication before reading or changing anything', async () => {
    const f = fixture('today', { signedIn: false }); assert.equal((await f.actions.markEmailHandled('email-a')).ok, false); assert.deepEqual(f.requests, []);
  });
  for (const method of ['GET', 'PATCH']) for (const mode of ['fail', 'missing'] as const) test(`${method} ${mode} is visible and performs no cleanup`, async () => {
    const f = fixture('today', { [mode]: (r: Request) => r.method === method });
    assert.equal((await f.actions.markEmailHandled('email-a')).ok, false); assert.deepEqual(f.effects, []); assert.deepEqual(f.refreshed, []);
  });
  test('confirmed retirement deletes the existing draft and refreshes both feeds', async () => {
    const f = fixture('today'); assert.equal((await f.actions.markEmailHandled('email-a')).ok, true);
    assert.ok(f.requests.every((r) => r.params.get('gmail_message_id') === 'eq.email-a'));
    assert.equal(f.requests[1].body?.handled_via, 'operator'); assert.equal(f.requests[1].body?.is_unread, false);
    assert.deepEqual(f.effects, ['delete:draft-a']); assert.deepEqual(f.refreshed, ['/today', '/']);
  });
});

describe('trip order reports incomplete writes', () => {
  for (const table of ['inspection_packets', 'packet_stops']) test(`${table} read failure cannot become an empty success`, async () => {
    const f = fixture('packet', { fail: (r) => r.table === table && r.method === 'GET' });
    assert.equal((await f.actions.reorderPacketStops('packet-a', ['b', 'a'])).ok, false);
    assert.ok(f.requests.every((r) => r.method === 'GET'));
  });
  test('locked packets and stale or duplicated stop lists cannot be reordered', async () => {
    const locked = fixture('packet', { status: 'paid' }); assert.equal((await locked.actions.reorderPacketStops('packet-a', ['b', 'a'])).ok, false);
    for (const order of [['b'], ['b', 'b'], ['b', 'other']]) {
      const f = fixture('packet'); assert.equal((await f.actions.reorderPacketStops('packet-a', order)).ok, false);
      assert.ok(f.requests.every((r) => r.method === 'GET'));
    }
  });
  for (const mode of ['fail', 'missing'] as const) test(`one stop ${mode} is reported as partial failure without a success event`, async () => {
    const f = fixture('packet', { [mode]: (r: Request) => r.method === 'PATCH' && r.params.get('id') === 'eq.a' });
    const result = await f.actions.reorderPacketStops('packet-a', ['b', 'a']);
    assert.equal(result.ok, false); assert.match(result.error, /Some stops/);
    assert.equal(f.requests.some((r) => r.table === 'packet_events'), false);
    assert.ok(f.requests.filter((r) => r.method === 'PATCH').every((r) => r.params.get('packet_id') === 'eq.packet-a'));
  });
  test('an unchanged order succeeds without writes', async () => {
    const f = fixture('packet'); assert.equal((await f.actions.reorderPacketStops('packet-a', ['a', 'b'])).ok, true);
    assert.ok(f.requests.every((r) => r.method === 'GET'));
  });
  test('confirmed reorder saves the intended positions and event', async () => {
    const f = fixture('packet'); assert.equal((await f.actions.reorderPacketStops('packet-a', ['b', 'a'])).ok, true);
    assert.deepEqual(f.requests.filter((r) => r.method === 'PATCH').map((r) => [r.params.get('id'), r.body?.walk_order]).sort(), [['eq.a', 1], ['eq.b', 0]]);
    assert.equal(f.requests.at(-1)?.body?.event_type, 'stops_reordered');
  });
});

describe('trip text requires a confirmed row', () => {
  for (const action of ['updateStopSlipNote', 'updateStopSlipContent', 'setStopInstructions', 'setPacketInstructions']) {
    test(`${action} rejects missing rows and write errors`, async () => {
      for (const mode of ['fail', 'missing'] as const) {
        const f = fixture('packet', { [mode]: () => true });
        const args = action === 'setPacketInstructions' ? ['packet-a', 'Notes'] : ['packet-a', 'item-a', 'Notes'];
        assert.equal((await f.actions[action](...args)).ok, false);
      }
    });
  }
});
