/** Run the real autosave component in React/Chromium with controlled, synthetic
 * save promises. No application server, owner data, or database is used. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), 'helm-autosave-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
await writeFile(join(scratch, 'component.js'), compile(await readFile(join(root, 'src/components/onboarding/OnboardingAutoSave.tsx'), 'utf8')));
await writeFile(join(scratch, 'queue.js'), compile(await readFile(join(root, 'src/lib/draft-autosave.ts'), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `export const saveOnboardingDraft = fd => new Promise((resolve, reject) => {
  window.saves.push({ answer: fd.get('answer'), resolve, reject });
});`);
await writeFile(join(scratch, 'entry.js'), compile(`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingAutoSave } from './component.js';
window.saves = []; window.submissions = [];
function Fixture() {
  const [mounted, setMounted] = useState(true);
  window.unmount = () => setMounted(false);
  return mounted && <OnboardingAutoSave initialSavedAt={new Date().toISOString()}>
    <form onSubmit={event => {
      event.preventDefault(); window.submissions.push(new FormData(event.currentTarget).get('answer'));
    }}>
      <label>Answer <input required name="answer" defaultValue="Original" /></label>
      <button type="submit">Submit form</button>
    </form>
  </OnboardingAutoSave>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`));
await new Promise((done, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: scratch,
    entry: join(scratch, 'entry.js'), output: { path: scratch, filename: 'bundle.js' },
    resolve: { modules: [join(root, 'node_modules')], alias: {
      '@/app/projections/actions': join(scratch, 'actions.js'),
      '@/lib/draft-autosave': join(scratch, 'queue.js'),
    } }, performance: { hints: false },
  });
  compiler.run((error, stats) => compiler.close(() => {
    if (error || stats?.hasErrors()) reject(error || Error(stats.toString({ all: false, errors: true })));
    else done();
  }));
});
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
  if (req.url === '/bundle.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(scratch, 'bundle.js')));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let checks = 0;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()),
    headless: true, args: process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args,
  });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
  const reset = async () => { await page.goto(origin); await page.waitForSelector('input'); };
  const edit = value => page.$eval('input', (input, value) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const status = () => page.$eval('[role=status]', el => el.innerText);
  const waitSaves = (count, timeout = 3000) => page.waitForFunction(count => window.saves.length === count, { timeout }, count);
  const resolveSave = (index, ok = true) => page.evaluate((index, ok) => {
    window.saves[index].resolve(ok ? { ok: true, savedAt: new Date().toISOString() } : { ok: false, reason: 'Synthetic failure' });
  }, index, ok);
  const hide = () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const pass = name => { checks++; console.log(`PASS ${name}`); };

  await reset();
  assert.match(await status(), /Saved/);
  await edit('First'); assert.equal(await status(), 'Unsaved changes');
  await waitSaves(1);
  await edit('Latest'); await resolveSave(0);
  await page.waitForFunction(() => document.querySelector('[role=status]').innerText === 'Unsaved changes');
  await hide(); await waitSaves(2, 750);
  assert.equal(await page.evaluate(() => window.saves[1].answer), 'Latest');
  await resolveSave(1);
  await page.waitForFunction(() => document.querySelector('[role=status]').innerText.startsWith('Saved'));
  pass('old success leaves newer edits unsaved and tab-hide saves the latest answers');

  await reset(); await edit('Retry me'); await waitSaves(1); await resolveSave(0, false);
  await page.waitForFunction(() => document.querySelector('[role=status]').innerText.includes('Couldn’t save'));
  await hide(); await waitSaves(2, 750); await resolveSave(1);
  await page.waitForFunction(() => document.querySelector('[role=status]').innerText.startsWith('Saved'));
  pass('failed draft remains retryable and only success displays Saved');

  await reset(); await edit('Old snapshot'); await waitSaves(1);
  await edit('Final answer'); await page.click('button[type=submit]');
  assert.equal(await page.evaluate(() => window.submissions.length), 0);
  await resolveSave(0);
  await page.waitForFunction(() => window.submissions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.submissions), ['Final answer']);
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(await page.evaluate(() => window.saves.length), 1);
  pass('final submit waits for an older save and submits the latest answers exactly once');

  await reset(); await edit('Submit before debounce'); await page.click('button[type=submit]');
  await page.waitForFunction(() => window.submissions.length === 1);
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(await page.evaluate(() => window.saves.length), 0);
  pass('immediate final submit cancels the pending autosave timer');

  await reset(); await edit('Old'); await waitSaves(1);
  await page.click('button[type=submit]'); await edit(''); await resolveSave(0);
  await waitSaves(2); assert.equal(await page.evaluate(() => window.submissions.length), 0);
  assert.equal(await page.evaluate(() => window.saves[1].answer), '');
  await resolveSave(1); await edit('Corrected'); await page.click('button[type=submit]');
  await page.waitForFunction(() => window.submissions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.submissions), ['Corrected']);
  pass('replayed submission preserves native validation and autosave can resume');

  await reset(); await edit('Pending'); await waitSaves(1);
  await page.click('button[type=submit]'); await page.evaluate(() => window.unmount());
  await page.waitForSelector('input', { hidden: true }); await resolveSave(0);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await page.evaluate(() => window.submissions.length), 0);
  assert.deepEqual(errors, []);
  pass('unmount does not replay a pending submit or produce React errors');
  console.log(`All ${checks} onboarding autosave browser checks passed.`);
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
