/** Real React/Chromium checks for the shared uploader. All uploads stay on a
 * loopback fixture; no storage credentials, app server, or database are used.
 * Run: node scripts/photo-upload-smoke.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), 'helm-photo-upload-'));
const output = resolve(process.env.PHOTO_UPLOAD_TEST_OUTPUT || join(tmpdir(), 'helm-photo-upload-results'));
await mkdir(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rNsAAAAASUVORK5CYII=', 'base64');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
await writeFile(join(scratch, 'uploader.js'), compile(await readFile(join(root, 'src/components/PhotoUploader.tsx'), 'utf8')));
await writeFile(join(scratch, 'compress.js'), compile(await readFile(join(root, 'src/lib/image-compress.ts'), 'utf8')));
await writeFile(join(scratch, 'entry.js'), compile(`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoUploader } from './uploader.js';
window.changes = []; window.submits = 0; window.busyEvents = [];
function Fixture() {
  const [urls, setUrls] = useState(['/synthetic/existing.png']);
  const [disabled, setDisabled] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpoint] = useState('/api/upload');
  window.fixture = { setDisabled, setMounted, setEndpoint,
    addExternal: () => setUrls(v => [...v, '/synthetic/external.png']) };
  return <main style={{maxWidth: 440, margin: '24px auto', fontFamily: 'sans-serif'}}>
    <form onSubmit={e => { e.preventDefault(); window.submits++; }}>
      {mounted && <PhotoUploader value={urls} onChange={next => {
        window.changes.push(next); setUrls(next);
      }} folder="synthetic-work-slip" endpoint={endpoint} disabled={disabled}
        onUploadingChange={value => { setBusy(value); window.busyEvents.push(value); }} />}
      <button id="submit" type="submit">Save form</button>
      <button id="direct-save" type="button" disabled={busy}>Save dialog</button>
    </form>
    <output id="urls">{JSON.stringify(urls)}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`));

await new Promise((done, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: scratch,
    entry: join(scratch, 'entry.js'), output: { path: scratch, filename: 'bundle.js' },
    resolve: { modules: [join(root, 'node_modules')], alias: { '@/lib/image-compress': join(scratch, 'compress.js') } },
    performance: { hints: false },
  });
  compiler.run((error, stats) => compiler.close(() => {
    if (error || stats?.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
    else done();
  }));
});

const uploads = [];
const holds = new Map();
let active = 0;
let peak = 0;
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    if (req.url === '/bundle.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(join(scratch, 'bundle.js')));
    } else if (req.url?.startsWith('/synthetic/')) {
      res.setHeader('Content-Type', 'image/png'); res.end(png);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>:root{--paper:#fff;--paper-2:#f6f3ed;--ink:#20303a;--ink-3:#52606a;--rule:#d6d0c6;--negative:#a32d2d}button{margin-top:6px}#urls{display:block;overflow-wrap:anywhere;font-size:11px;margin-top:20px}</style><div id="root"></div><script src="/bundle.js"></script>');
    }
    return;
  }
  active++; peak = Math.max(peak, active);
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const form = await new Request('http://localhost/upload', {
      method: 'POST', headers: req.headers, body: Buffer.concat(chunks),
    }).formData();
    const file = form.get('file');
    const attempt = uploads.filter(item => item.name === file.name).length + 1;
    uploads.push({ name: file.name, folder: form.get('folder'), endpoint: req.url, attempt });
    if (file.name.startsWith('hold')) await new Promise(resolve => holds.set(file.name, resolve));
    if (file.name === 'bad-json.png' && attempt === 1) { res.statusCode = 502; res.end('Temporary upstream failure'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (file.name === 'retry.png' && attempt === 1) {
      res.statusCode = 503; res.end(JSON.stringify({ error: 'Synthetic temporary failure' })); return;
    }
    res.end(JSON.stringify({ ok: true, url: `/synthetic/${file.name}-${attempt}.png` }));
  } finally { active--; }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const passed = [];
const check = (name, fn) => { fn(); passed.push(name); console.log(`PASS ${name}`); };
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()),
    headless: true, args: process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(origin + '/') || request.url().startsWith('data:')) request.continue();
    else request.abort();
  });
  await page.goto(origin);
  await page.waitForSelector('input[type=file]');
  const select = async (...names) => {
    const paths = await Promise.all(names.map(async name => { const p = join(scratch, name); await writeFile(p, png); return p; }));
    await (await page.$('input[type=file]')).uploadFile(...paths);
  };
  const idle = () => page.waitForFunction(() => !document.querySelector('input[type=file]').disabled, { timeout: 10000 });
  const urls = () => page.$eval('#urls', element => JSON.parse(element.textContent));
  assert.equal(await page.$eval('input[type=file]', el => el.multiple), true);
  passed.push('picker allows multiple photos');

  await select('hold-first.png', 'retry.png', 'last.png');
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('Uploading 1 of 3'));
  await page.click('#submit');
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(await page.$eval('#direct-save', el => el.disabled), true);
  passed.push('form and dialog saves wait for pending uploads');
  // External changes while an upload is pending must survive the append.
  await page.evaluate(() => window.fixture.addExternal());
  while (!holds.has('hold-first.png')) await new Promise(resolve => setTimeout(resolve, 20));
  holds.get('hold-first.png')();
  await idle();
  check('batch continues past failure and preserves existing/new parent photos', () => assert.deepEqual(uploads.map(u => u.name), ['hold-first.png', 'retry.png', 'last.png']));
  assert.deepEqual(await urls(), ['/synthetic/existing.png', '/synthetic/external.png', '/synthetic/hold-first.png-1.png', '/synthetic/last.png-1.png']);
  assert.equal(await page.evaluate(() => window.changes.length), 1);
  assert.equal(peak, 1);
  assert.equal(uploads.every(item => item.folder === 'synthetic-work-slip'), true);
  await page.screenshot({ path: join(output, 'partial-failure-mobile.png'), fullPage: true });
  await page.click('[aria-label="Retry retry.png"]');
  await idle();
  check('individual retry uploads only the failed photo', () => assert.deepEqual(uploads.map(u => u.name), ['hold-first.png', 'retry.png', 'last.png', 'retry.png']));
  assert.equal((await urls()).length, 5);
  assert.equal(await page.$('[role=alert]'), null);
  await page.click('#submit');
  assert.equal(await page.evaluate(() => window.submits), 1);

  await select('last.png'); await idle();
  check('same file can be selected again and single upload still works', () => assert.equal(uploads.at(-1).attempt, 2));
  await select('bad-json.png'); await idle();
  // Browser offline mode is deterministic; a reset socket can be retried by
  // Chromium itself and silently turn the intended failure into a success.
  await page.setOfflineMode(true);
  await select('network.png'); await idle();
  await page.setOfflineMode(false);
  assert.equal((await page.$$('[aria-label^="Retry "]')).length, 2);
  passed.push('non-JSON and network failures stay individually retryable');
  await page.click('[aria-label="Remove failed photo bad-json.png"]');
  assert.equal((await page.$$('[aria-label^="Retry "]')).length, 1);
  await page.click('[aria-label="Retry network.png"]'); await idle();
  assert.equal(uploads.at(-1).name, 'network.png');
  assert.equal(await page.$('[role=alert]'), null);

  await page.evaluate(() => window.fixture.setEndpoint('/api/field/upload'));
  await select('field.png'); await idle();
  check('custom upload endpoint is preserved', () => assert.equal(uploads.at(-1).endpoint, '/api/field/upload'));
  await page.evaluate(() => window.fixture.setDisabled(true));
  await page.waitForFunction(() => document.querySelector('input[type=file]').disabled);
  assert.equal(await page.$eval('[aria-label="Remove photo"]', el => el.disabled), true);
  await page.evaluate(() => window.fixture.setDisabled(false)); await idle();
  await page.click('[aria-label^="Open photo 1 of "]');
  await page.waitForSelector('[role=dialog]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { hidden: true });
  assert.equal(await page.$('[role=dialog]'), null);
  const beforeRemove = (await urls()).length;
  await page.click('[aria-label="Remove photo"]');
  assert.equal((await urls()).length, beforeRemove - 1);
  passed.push('disabled state, photo viewer, and removal still work');

  await select('hold-unmount.png', 'never-upload.png');
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('Uploading 1 of 2'));
  while (!holds.has('hold-unmount.png')) await new Promise(resolve => setTimeout(resolve, 20));
  const changes = await page.evaluate(() => window.changes.length);
  await page.evaluate(() => window.fixture.setMounted(false));
  await page.waitForSelector('input[type=file]', { hidden: true });
  holds.get('hold-unmount.png')();
  await new Promise(resolve => setTimeout(resolve, 100));
  check('unmount stops queued work without a stale parent update', () => assert.equal(uploads.some(u => u.name === 'never-upload.png'), false));
  assert.equal(await page.evaluate(() => window.changes.length), changes);
  assert.deepEqual(pageErrors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed, checks: passed.length, peakConcurrentUploads: peak, syntheticOnly: true }, null, 2));
  console.log(`All ${passed.length} photo upload checks passed.`);
} finally {
  for (const release of holds.values()) release();
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
