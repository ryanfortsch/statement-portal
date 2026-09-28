// Integration check. Uses synthetic credentials and a loopback-only database.
// Run from an isolated checkout: node scripts/property-document-smoke.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] || process.cwd());
assert.ok(!process.env.CI || process.env.SKIP_CHROME_PDF !== '1', 'CI must test real PDF generation');
const outputDir = process.env.PROPERTY_DOCUMENT_TEST_OUTPUT || mkdtempSync(join(tmpdir(), 'helm-document-smoke-'));
mkdirSync(outputDir, { recursive: true });
console.log(`Synthetic integration results: ${outputDir}`);
const require = createRequire(`${root}/package.json`);
const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt')));
const { PDFDocument } = require('pdf-lib');
const { createPropertyDocumentToken, PROPERTY_RENDER_HEADER } = await import(pathToFileURL(`${root}/src/lib/property-document-token.ts`));
const secret = randomBytes(32).toString('hex');
const property = {
  id: 'test-house', name: 'Synthetic Test House', title: 'Synthetic Stay',
  city: 'Gloucester', address: 'Synthetic address',
  wifi_name: 'SYNTHETIC_NETWORK', wifi_name_2: 'SYNTHETIC_NETWORK_2',
  wifi_label: 'Main House', wifi_label_2: 'Second Unit',
  home_guide_overrides: {},
};
const access = { wifi_password: 'SYNTHETIC_WIFI_PASSWORD', wifi_password_2: 'SYNTHETIC_WIFI_PASSWORD_2' };
const dbReads = [];
const passes = [];
const skipped = [];
function pass(name) { passes.push(name); console.log(`PASS: ${name}`); }
const db = createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  const table = url.pathname.split('/').pop();
  dbReads.push(table);
  let row = null;
  if (table === 'properties' && url.searchParams.get('id') === 'eq.test-house') row = property;
  if (table === 'property_access' && url.searchParams.get('property_id') === 'eq.test-house') row = access;
  const single = (req.headers.accept || '').includes('application/vnd.pgrst.object+json');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(single ? row : row ? [row] : []));
});
await new Promise(resolve => db.listen(0, '127.0.0.1', resolve));
const dbPort = db.address().port;
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const appPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${appPort}`;
const env = {
  ...process.env, AUTH_SECRET: secret, AUTH_TRUST_HOST: 'true', AUTH_URL: origin,
  AUTH_GOOGLE_ID: 'synthetic', AUTH_GOOGLE_SECRET: 'synthetic', AUTH_COOKIE_DOMAIN: '',
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${dbPort}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  CHROME_EXECUTABLE_PATH: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : ''),
  VERCEL_PROTECTION_BYPASS: '', NEXT_TELEMETRY_DISABLED: '1', WATCHPACK_POLLING: 'true',
};
const log = createWriteStream(join(outputDir, 'smoke-next.log'));
const app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.pipe(log); app.stderr.pipe(log);
const watchdog = setTimeout(() => { app.kill('SIGTERM'); }, 240_000);
async function get(path, headers = {}) {
  return fetch(`${origin}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
}
function documentPath(type) { return `/properties/test-house/${type}`; }
function renderHeader(type, id = 'test-house', now = Date.now()) {
  return { [PROPERTY_RENDER_HEADER]: createPropertyDocumentToken(id, type, secret, now) };
}
async function assertDenied(path, headers, name) {
  const before = dbReads.length;
  const response = await get(path, headers);
  const body = await response.text();
  assert.ok(response.status === 404 || response.status === 200, `${name}: unexpected status ${response.status}`);
  assert.ok(!body.includes('SYNTHETIC_WIFI_PASSWORD'), `${name}: disclosed synthetic credentials`);
  assert.ok(!body.includes('data-property-document='), `${name}: rendered a document`);
  assert.equal(dbReads.length, before, `${name}: queried the database before authorization`);
  pass(name);
}

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) throw new Error(`Next exited with ${app.exitCode}; see smoke-next.log`);
    try { ready = (await get('/api/version')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Local Next server did not start');
  const cookieName = 'authjs.session-token';
  const cookie = `${cookieName}=${await encode({ secret, salt: cookieName, token: { sub: 'synthetic-staff', email: 'synthetic@risingtidestr.com', name: 'Synthetic Staff' }, maxAge: 600 })}`;
  for (const type of ['wifi-placard', 'home-guide']) {
    const path = documentPath(type);
    await assertDenied(path, {}, `${type}: anonymous access denied before database reads`);
    await assertDenied(path, { [PROPERTY_RENDER_HEADER]: 'forged' }, `${type}: forged render header denied`);
    await assertDenied(path, renderHeader(type, 'other-house'), `${type}: another property's token denied`);
    await assertDenied(path, renderHeader(type === 'wifi-placard' ? 'home-guide' : 'wifi-placard'), `${type}: another document's token denied`);
    await assertDenied(path, renderHeader(type, 'test-house', Date.now() - 121_000), `${type}: expired token denied`);
    const token = createPropertyDocumentToken('test-house', type, secret);
    await assertDenied(`${path}?token=${token}`, {}, `${type}: URL token does not authorize`);
    for (const [mode, headers] of [['render token', renderHeader(type)], ['staff session', { cookie }]]) {
      const response = await get(path, headers);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.ok(body.includes(`data-property-document="${type}"`));
      assert.ok(body.includes('SYNTHETIC_WIFI_PASSWORD'));
      assert.ok(body.includes('SYNTHETIC_WIFI_PASSWORD_2'));
      if (type === 'wifi-placard') assert.ok(body.includes('<svg'), 'QR code was not rendered');
      pass(`${type}: ${mode} renders both synthetic networks`);
    }
    const unauthenticated = await get(`/api/property-pdf?id=test-house&type=${type}`, renderHeader(type));
    assert.equal(unauthenticated.status, 401, 'A render token must not authorize PDF generation');
    pass(`${type}: PDF generation denies non-staff`);
    if (process.env.SKIP_CHROME_PDF === '1') {
      skipped.push(`${type}: real Chrome PDF download (local Chrome cannot launch)`);
      continue;
    }
    const pdf = await get(`/api/property-pdf?id=test-house&type=${type}`, { cookie });
    assert.equal(pdf.status, 200, `PDF generation failed (${type}); see smoke-next.log`);
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    writeFileSync(join(outputDir, `${type}.pdf`), bytes);
    const pdfText = await require('pdf-parse/lib/pdf-parse.js')(Buffer.from(bytes), {
      pagerender: async (page) => {
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str).join(' ');
        console.log(`${type} page ${page.pageIndex + 1}: ${text}`);
        return text;
      },
    });
    assert.ok(pdfText.text.includes('SYNTHETIC_NETWORK'));
    assert.ok(pdfText.text.includes('SYNTHETIC_NETWORK_2'));
    assert.equal(document.getPageCount(), type === 'wifi-placard' ? 2 : 1);
    pass(`${type}: staff download generates a valid ${document.getPageCount()}-page PDF`);
  }
  writeFileSync(join(outputDir, 'smoke-results.json'), JSON.stringify({ tests: passes.length, passed: passes, skipped, synthetic_data_only: true }, null, 2));
  console.log(`All ${passes.length} local integration checks passed.`);
} finally {
  clearTimeout(watchdog);
  if (app.exitCode === null && app.signalCode === null) {
    const stopped = once(app, 'exit');
    app.kill('SIGTERM');
    const forceStop = setTimeout(() => app.kill('SIGKILL'), 5_000);
    await stopped;
    clearTimeout(forceStop);
  }
  await new Promise(resolve => db.close(resolve));
  log.end();
}
