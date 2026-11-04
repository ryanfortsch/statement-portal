/** Statements receipt UI. Synthetic homes and controlled I/O only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack');
const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'helm-receipts-'));
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sources = {
  workspace: 'src/app/statements/receipts/StatementReceipts.tsx', capture: 'src/components/ReceiptCapture.tsx',
  button: 'src/components/Button.tsx', empty: 'src/components/EmptyState.tsx',
  'button-class': 'src/lib/button-class.ts', month: 'src/lib/statements-month.ts', date: 'src/lib/operating-date.ts',
  unsaved: 'src/lib/unsaved-work.ts',
};
for (const [name, path] of Object.entries(sources)) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'boundary.js'), compile(`
import React from 'react';
export const useConfirm=()=>({ask:async()=>false});
export const usePendingWatchdog=()=>{};
export const deleteWithFreezeRetry=()=>{throw Error('Unexpected deletion');};
export default function Link({children,...props}){return <a {...props}>{children}</a>;}
`));
await writeFile(join(scratch, 'entry.js'), compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {StatementReceipts} from './workspace';
import {hasUnsavedWork} from './unsaved';window.guarded=hasUnsavedWork;
window.calls=[];window.rows=[];window.failList=false;window.mode='pending';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(url,options={})=>{
  if(String(url).startsWith('/api/receipts?')){
    if(window.failList)return response({error:'Synthetic read failure'},500);
    const q=new URL(url,location.origin).searchParams;
    return response({receipts:window.rows.filter(r=>r.property_id===q.get('property_id')&&r.month===q.get('month'))});
  }
  if(url==='/api/receipts/extract'){
    window.calls.push({kind:'extract'});
    if(options.body.get('file').type==='application/pdf')return response({ok:false,extracted:null,reason:'pdf_not_supported'});
    return response({ok:true,extracted:{amount:50.25,vendor:'Synthetic shop',expense_date:'2026-11-03',category:'supplies',note:'House supplies',confidence:'high'}});
  }
  if(url!=='/api/receipts'||options.method!=='POST')throw Error('Unexpected request '+url);
  const fields=Object.fromEntries([...options.body].map(([k,v])=>[k,v instanceof File?{name:v.name,size:v.size}:v]));
  window.calls.push({kind:'save',fields});
  await new Promise(resolve=>setTimeout(resolve,40));
  if(window.mode==='duplicate'&&!fields.acknowledge_warnings)return response({needs_confirm:true,warnings:[{kind:'possible_duplicate_receipt',message:'A receipt for $50.25 is already saved. Check the saved receipts.'}]});
  const receipt={...fields,id:'receipt-'+(window.rows.length+1),amount:Number(fields.amount),receipt_path:fields.file?'private/synthetic.pdf':null};window.rows.push(receipt);
  if(window.mode==='partial')return response({receipt,statement_found:true,error:'Receipt saved. Do not add it again. Refresh the statement.'},500);
  return response({ok:true,receipt,statement_found:window.mode==='existing'});
};
createRoot(document.getElementById('root')).render(<StatementReceipts properties={[{id:'new-home',name:'New Home',location:'Synthetic Town'},{id:'other-home',name:'Other Home',location:''}]} initialMonth="2026-11" initialPropertyId=""/>);
`));
const alias = {
  '@/components/ReceiptCapture': 'capture', '@/components/Button': 'button', '@/components/EmptyState': 'empty',
  '@/lib/button-class': 'button-class', '@/lib/statements-month': 'month', './operating-date.ts': 'date',
  '@/lib/unsaved-work': 'unsaved',
  '@/components/ConfirmDialog': 'boundary', '@/lib/use-pending-watchdog': 'boundary', '@/lib/freeze-confirm': 'boundary', 'next/link': 'boundary',
};
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: scratch, entry: join(scratch, 'entry.js'), output: { path: scratch, filename: 'bundle.js' }, resolve: { modules: [join(root, 'node_modules')], alias: Object.fromEntries(Object.entries(alias).map(([k, v]) => [k, join(scratch, v + '.js')])) }, performance: { hints: false } });
  compiler.run((err, stats) => compiler.close(() => err || stats?.hasErrors() ? reject(err || Error(stats.toString({ all: false, errors: true }))) : resolve()));
});
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(await readFile(join(scratch, 'bundle.js'))); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>Synthetic statement receipts</title><style>body{font:14px system-ui;max-width:860px;margin:30px auto;--paper:#fff;--paper-2:#faf8f3;--ink:#222;--ink-3:#555;--rule:#ccc;--signal:#a43;--positive:#174}input,select{box-sizing:border-box}button,a{margin:4px;padding:8px}h2{font:24px Georgia}</style><div id="root"></div><script src="/bundle.js"></script>'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
let browser, page, checks = 0;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()), headless: true, args: process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args });
  page = await browser.newPage(); page.setDefaultTimeout(10000); await page.setViewport({ width: 1100, height: 850 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true); page.on('request', r => r.url().startsWith(origin + '/') ? r.continue() : r.abort());
  const click = (label, twice = false) => page.$$eval('button', (buttons, label, twice) => { const b = buttons.find(b => b.textContent.trim() === label); if (!b) throw Error('Missing ' + label); b.click(); if (twice) b.click(); }, label, twice);
  const edit = (selector, value) => page.$eval(selector, (e, value) => { Object.getOwnPropertyDescriptor(e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, value); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, value);
  const text = t => page.waitForFunction(t => document.body.textContent.includes(t), {}, t);
  const saves = () => page.evaluate(() => window.calls.filter(c => c.kind === 'save'));
  const load = async mode => { await page.goto(origin); await page.waitForSelector('select'); await page.evaluate(mode => window.mode = mode, mode); };
  const choose = async () => { await edit('select', 'new-home'); await text('No receipts saved'); await click('Add receipt'); };
  const manual = async () => { await choose(); await click('Enter manually'); await edit('input[type="number"]', '50.25'); };
  const pass = message => { checks++; console.log('PASS ' + message); };

  await load('pending');
  assert.equal(await page.$$eval('button', bs => bs.find(b => b.textContent === 'Add receipt').disabled), true);
  await manual(); assert.equal(await page.evaluate(() => window.guarded()), true);
  await click('Cancel'); assert.equal((await saves()).length, 0);
  assert.equal(await page.evaluate(() => window.guarded()), false);
  pass('property choice is required; unsaved edits guard refresh; cancelling releases the guard and writes nothing');

  await choose();
  const receiptPath = join(scratch, 'synthetic.pdf'); await writeFile(receiptPath, '%PDF-1.7 synthetic fixture');
  await (await page.$('input[type="file"]')).uploadFile(receiptPath); await text('Review');
  await text('Could not read the receipt. Enter the details manually.');
  for (const [field, value] of Object.entries({ amount: '50.25', vendor: 'Synthetic shop', date: '2026-11-03', category: 'supplies', note: 'House supplies' })) await edit(`[id$="-${field}"]`, value);
  assert.equal(await page.$eval('select', e => e.disabled), true);
  await edit('input[id$="-month"]', '2026-12');
  await click('Confirm', true); await text('It will be included when this month’s statement is imported.');
  const saved = await saves(); assert.equal(saved.length, 1);
  assert.equal(await page.evaluate(() => window.guarded()), false);
  assert.deepEqual(saved[0].fields, { property_id: 'new-home', month: '2026-12', amount: '50.25', vendor_name: 'Synthetic shop', description: 'House supplies', expense_date: '2026-11-03', category: 'supplies', file: { name: 'synthetic.pdf', size: 26 } });
  await text('Receipt attached'); await text('Saved for New Home · 2026-12');
  assert.equal(await page.$eval('section[aria-label="Saved receipts"] li', e => e.textContent.includes('50.25')), true);
  pass('first receipt keeps property, selected month, expense date, category, note and file; rapid clicks save once; saved list refreshes');

  await load('duplicate'); await manual(); await click('Confirm'); await text('Check the saved receipts.');
  await click('Cancel'); assert.equal((await saves()).length, 1); assert.equal(await page.evaluate(() => window.rows.length), 0);
  pass('duplicate warning can be cancelled without creating a receipt');
  await manual(); await click('Confirm'); await text('Check the saved receipts.'); await click('Add anyway'); await text('Saved.');
  assert.equal((await saves()).at(-1).fields.acknowledge_warnings, 'true');
  pass('explicit duplicate override uses the existing acknowledgment field');

  await load('partial'); await manual(); await click('Confirm'); await text('Do not add it again.');
  assert.equal(await page.$$eval('button', bs => bs.some(b => b.textContent === 'Confirm')), false);
  assert.equal((await saves()).length, 1); await click('Close'); await text('No attachment');
  pass('saved-but-recompute-failed response removes Confirm and preserves the warning and saved receipt');

  await load('existing'); await manual(); await click('Confirm'); await text('Included under Repairs & Maintenance.');
  pass('existing statement save remains labeled as included');

  await load('pending'); await page.evaluate(() => window.failList = true); await edit('select', 'new-home'); await text('Saved receipts did not load.');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('No receipts saved')), false);
  await page.evaluate(() => window.failList = false); await click('Retry'); await text('No receipts saved');
  pass('read failure stays distinct from an empty list and supports retry');

  await page.setViewport({ width: 390, height: 844 }); await click('Add receipt'); await click('Enter manually');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  pass('mobile layout fits and the browser reports no runtime errors');
  console.log(`PASS ${checks} statement receipt browser checks; synthetic responses only.`);
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({ text: document.body.innerText, calls: window.calls })));
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(scratch, { recursive: true, force: true });
}
