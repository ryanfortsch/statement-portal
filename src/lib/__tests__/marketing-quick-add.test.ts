import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const prospectSource = compile('../../app/properties/actions.ts');
function prospect() {
  let signedIn = true, failure = '', geocodeFails = false;
  const writes: Record<string, unknown>[] = [], paths: string[] = [], geo: string[] = [];
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), insert: async (row: Record<string, unknown>) => { writes.push(row); if (failure === 'throw') throw Error('Lost response'); return { error: failure ? { message: 'Synthetic error' } : null }; } }) };
  const deps: Record<string, unknown> = {
    '@/auth': { auth: async () => signedIn ? { user: { email: 'synthetic@example.test' } } : null },
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/geocode': { geocodeAddress: async (address: string) => { geo.push(address); if (geocodeFails) throw Error('Geocode unavailable'); return { lat: 42, lng: -70 }; } },
    'next/cache': { revalidatePath: (path: string) => paths.push(path) },
    'next/navigation': { redirect: (url: string) => { throw Error('REDIRECT:' + url); } },
  };
  const actions: { createProspectProperty?: (data: FormData) => Promise<{ error: string }> } = {};
  runInNewContext(prospectSource, { exports: actions, require: (name: string) => deps[name] ?? {}, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' } }, FormData });
  const data = new FormData(); data.set('name', 'Synthetic Home'); data.set('address', '123 Test Road'); data.set('city', 'Rockport');
  return { run: () => actions.createProspectProperty!(data), data, writes, paths, geo, fail: (value: string) => { failure = value; }, signOut: () => { signedIn = false; }, noGeocode: () => { geocodeFails = true; } };
}
test('prospect auth gate remains ahead of lookup/geocoding/writes', async () => { const f = prospect(); f.signOut(); await assert.rejects(f.run(), /Not signed in/); assert.equal(f.writes.length + f.geo.length, 0); });
for (const field of ['name', 'address']) test('short prospect ' + field + ' returns an inline error without redirect or mutation', async () => { const f = prospect(); f.data.set(field, 'x'); assert.match((await f.run()).error, /at least/); assert.equal(f.writes.length + f.geo.length + f.paths.length, 0); });
test('prospect insert rejection returns recoverable error without success navigation', async () => { const f = prospect(); f.fail('returned'); assert.match((await f.run()).error, /Could not create/); assert.equal(f.paths.length, 0); });
test('prospect lost response does not become success', async () => { const f = prospect(); f.fail('throw'); await assert.rejects(f.run(), /Lost response/); assert.equal(f.paths.length, 0); });
test('prospect success preserves inactive row, geocoding, and redirect', async () => { const f = prospect(); await assert.rejects(f.run(), /REDIRECT:\/properties\/synthetic_home/); assert.equal(f.writes[0].is_active, false); assert.equal(f.writes[0].kind, 'prospect'); assert.equal(f.writes[0].latitude, 42); assert.deepEqual(f.geo, ['123 Test Road, Rockport MA']); assert.deepEqual(f.paths, ['/properties', '/properties/prospects']); });
test('optional town and failed geocoding retain existing defaults', async () => { const f = prospect(); f.data.set('city', ''); f.noGeocode(); await assert.rejects(f.run(), /REDIRECT:/); assert.equal(f.writes[0].city, 'Gloucester'); assert.equal(f.writes[0].latitude, null); });

const pageSource = compile('../../app/guests/marketing/page.tsx');
async function marketing(mode: string) {
  const exports: { default?: () => Promise<unknown> } = {};
  const React = require('react');
  const deps: Record<string, unknown> = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { default: (p: Record<string, unknown>) => React.createElement('a', p) },
    '@/components/HelmMasthead': { HelmMasthead: () => null }, '@/components/MarketingTabs': { MarketingTabs: () => null },
    '@/lib/property-scope': { CAPE_ANN_REGION: 'cape_ann' },
    '@/lib/fleet': { listFleetProperties: async () => [{ id: 'home', name: 'Synthetic Home' }] },
    '@/lib/supabase': { isConfigured: mode !== 'unconfigured', supabase: { from: () => ({ select: async () => { if (mode === 'thrown') throw Error('Offline'); return { data: mode === 'null' ? null : [], error: mode === 'returned' ? { message: 'Unavailable' } : null }; } }) } },
    './MarketingMemoryEditor': { MarketingMemoryEditor: () => React.createElement('form', { 'data-editor': true }) },
  };
  runInNewContext(pageSource, { exports, require: (name: string) => deps[name] ?? {} });
  return require('react-dom/server').renderToStaticMarkup(await exports.default!());
}
for (const mode of ['unconfigured', 'thrown', 'returned', 'null']) test('marketing ' + mode + ' load shows retry with no blank editable form', async () => { const html = await marketing(mode); assert.match(html, /could not be loaded/); assert.match(html, /Retry loading/); assert.doesNotMatch(html, /data-editor/); });
test('successful empty marketing query still allows a new memory', async () => { const html = await marketing('empty'); assert.match(html, /data-editor/); assert.doesNotMatch(html, /could not be loaded/); });
