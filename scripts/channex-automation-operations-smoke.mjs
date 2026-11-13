/** Actual owner status panel; only synthetic read-only reports and local HTTP. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { syntheticAutomationOperations } from '../src/lib/__tests__/fixtures/channex-automation-operations.ts';

const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'helm-automation-operations-'));
const { webpack } = createRequire(import.meta.url)('next/dist/compiled/webpack/webpack');
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
await writeFile(join(scratch, 'panel.js'), compile(await readFile(join(root,
  'src/app/channels/65_calderwood/message-status/AutomationStatusPanel.tsx'), 'utf8')));
await writeFile(join(scratch, 'MessageHoldControl.js'), compile(await readFile(join(root, 'src/app/channels/65_calderwood/message-status/MessageHoldControl.tsx'), 'utf8')));
await writeFile(join(scratch, 'message-control.js'), compile(await readFile(join(root, 'src/lib/channex-messaging/message-control.ts'), 'utf8')));
await writeFile(join(scratch, 'link.js'), compile('export default function Link({children,...props}) {return <a {...props}>{children}</a>}'));
const report = await syntheticAutomationOperations();
await writeFile(join(scratch, 'entry.js'), compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {AutomationStatusPanel} from './panel.js';
const report=${JSON.stringify(report)},params=new URLSearchParams(location.search);
if(params.has('empty')){report.rows=[];report.total=0;}
if(params.has('unavailable')){report.rows=[];report.history='unavailable';report.total=null;}
if(params.has('partial')){report.history='partial';report.total=120;}
if(params.has('controls')){report.rows[0].state='Scheduled';report.rows[0].category='waiting';report.rows[0].note='Scheduled time only. The sender still rechecks holds, booking details and eligibility.';}
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-[1100px] px-5 py-10 sm:px-10"><p className="text-xs uppercase tracking-widest">65 Calderwood · Messages</p><h1 className="mt-3 font-serif text-4xl">Automation status</h1><p className="mt-4">See what is scheduled, what reached a provider and what needs attention.</p><AutomationStatusPanel report={report}/></main>);
`));
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: scratch, entry: join(scratch, 'entry.js'),
    output: { path: scratch, filename: 'bundle.js' }, resolve: { modules: [join(root, 'node_modules')],
      alias: { 'next/link': join(scratch, 'link.js'), '@/lib/channex-messaging/message-control': join(scratch, 'message-control.js') } }, performance: { hints: false } });
  compiler.run((err, stats) => compiler.close(() => err || stats?.hasErrors()
    ? reject(err || Error(stats.toString({ all: false, errors: true }))) : resolve()));
});
const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'src/app/globals.css'), 'utf8'),
  { from: join(root, 'src/app/globals.css') })).css;
const methods = [], posts = []; let controlMode = 'normal', held = false, version = 1;
const control = () => ({sendId:report.rows[0].id,bookingId:report.rows[0].bookingId,lane:'guest',held,token:String(version).padStart(32,'0'),expiresAt:'2035-01-01T20:30:00.000Z',canHold:!held,canResume:held&&controlMode!=='expired'});
const server = createServer(async (req, res) => {
  methods.push(req.method);
  if(req.url.startsWith('/api/channex/message-control')) {
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'){res.end(JSON.stringify({control:controlMode==='identity'?{...control(),bookingId:control().sendId}:control()}));return;}
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);posts.push(input);
    if(controlMode==='conflict'){version++;held=true;res.end(JSON.stringify({state:'conflict',control:control()}));return;}
    assert.equal(input.expected,control().token);held=input.held;version++;
    if(controlMode==='lost'){res.statusCode=503;res.end('{}');return;}
    res.end(JSON.stringify({state:'changed',control:control()}));return;
  }
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(scratch, 'bundle.js'))); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic automation status</title><style>'
    + css + 'body{background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>');
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()), headless: true,
    args: process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args });
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', r => r.url().startsWith(origin + '/') ? r.continue() : r.abort());
  for (const mode of ['', '?empty', '?unavailable', '?partial']) {
    await page.goto(origin + '/' + mode); await page.waitForSelector('#message-history-title');
    const text = await page.$eval('body', e => e.innerText);
    assert.match(text, /Guest messages · Channex/i); assert.match(text, /Cleaner texts · SMS/i);
    assert.match(text, /Automatic enrollment of new Airbnb stays is not implemented/);
    if (mode === '?unavailable') { assert.match(text, /history could not be verified/); assert.doesNotMatch(text, /No Helm message records/); }
    else if (mode === '?empty') { assert.match(text, /No Helm message records/); assert.match(text, /does not confirm that Guesty or Airbnb has no queued/); }
    else { assert.match(text, /accepted · readback pending/); assert.match(text, /SMS accepted · receipt pending/); }
    if (mode === '?partial') assert.match(text, /Older records, including unresolved attempts/);
    assert.deepEqual(await page.$$eval('form', fs => fs.map(f => f.method)), ['get']);
    assert.equal(await page.$$eval('button', bs => bs.length), report.rows.length && !['?empty','?unavailable'].includes(mode) ? 3 : 1);
    for (const width of [1360, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${mode} width ${width}`);
      if (width !== 320 && ['', '?empty'].includes(mode)) await page.screenshot({
        path: join(tmpdir(), `helm-automation-operations-${mode ? 'empty' : 'receipts'}-${width}.png`), fullPage: true });
    }
  }
  await Promise.all([page.waitForNavigation(), page.click('form button')]);
  assert.ok(page.url().includes('/channels/65_calderwood/message-status'));
  assert.ok(methods.every(m => m === 'GET'));
  const button=async label=>{const found=await page.$$('button');for(const b of found){if(await b.evaluate((e,v)=>e.textContent===v,label)){await b.click();return;}}throw Error('Missing button '+label);};
  const text=pattern=>page.waitForFunction(p=>document.body.innerText.includes(p),{},pattern);
  await page.goto(origin+'/?controls');await page.waitForSelector('#message-history-title');
  await button('Review hold');await text('Not held');assert.equal(posts.length,0);
  await button('Hold message');await text('Confirm hold');await button('Cancel');assert.equal(posts.length,0);
  await button('Hold message');await button('Confirm hold');await text('Hold saved.');assert.equal(posts.length,1);assert.equal(posts[0].held,true);
  for(const width of [1360,390]){await page.setViewport({width,height:1000});await page.screenshot({path:join(tmpdir(),`helm-message-hold-${width}.png`),fullPage:true});}
  await button('Review resume');await text('can send on the next automatic check');await button('Remove hold');await text('Hold removed.');assert.equal(posts.length,2);
  controlMode='lost';await button('Hold message');await button('Confirm hold');await text('save outcome is uncertain');assert.equal(posts.length,3);
  controlMode='normal';await button('Review hold');await text('On hold');assert.equal(posts.length,3,'readback never repeats a write');
  controlMode='conflict';await button('Review resume');await button('Remove hold');await text('schedule changed');assert.equal(posts.length,4);assert.equal(held,true);
  controlMode='expired';await button('Refresh hold status');await text('cannot resume in its current state');assert.equal(await page.$$eval('button',bs=>bs.some(b=>b.textContent==='Review resume')),false);
  controlMode='identity';await button('Refresh hold status');await text('Hold status unavailable');assert.equal(posts.length,4);
  for(const width of [1360,390,320]){await page.setViewport({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(errors, []);
  console.log('PASS: actual status panel; receipt distinctions, off senders, empty/error/partial history, GET-only refresh, explicit hold/resume, cancel, stale/expired identity refusal and lost-response readback; 1360/390/320px layouts');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(scratch, { recursive: true, force: true }); }
