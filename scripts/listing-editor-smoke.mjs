/** The listing editor that remains (the property page's Listing section) in React/Chromium:
 * Draft with AI fills the Guesty description fields and Save listing saves them.
 * Synthetic content and controlled Server Action promises only; no model, no database.
 * (Until 2026-10-18 this fixture drove the Listing Copy Studio, which is retired.)
 * --serve exposes the same fixture for manual browser checks. */
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
const scratch = await mkdtemp(join(tmpdir(), 'helm-listing-editor-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['component', 'src/app/properties/[id]/ListingPanel.tsx'],
  ['policy', 'src/app/properties/[id]/HousePolicyReadout.tsx'],
  ['stabletime', 'src/lib/stable-time.ts'],
  ['confirm-dialog', 'src/components/ConfirmDialog.tsx'],
  ['confirm-question', 'src/lib/confirm-question.ts'],
  ['button-class', 'src/lib/button-class.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const call = (kind, args) => new Promise((resolve, reject) => {
    window.calls.push({kind, args, resolve, reject});
  });
  export const draftListingWithAiAction = (...args) => call('draft', args);
  export const saveListingContentAction = (propertyId, prev, fd) => call('save', [propertyId, Object.fromEntries([...fd.entries()].filter(([k]) => typeof fd.get(k) === 'string'))]);
  const unused = () => Promise.resolve({ ok: true });
  export const addPhotoUrlAction = unused, deletePhotoAction = unused, movePhotoAction = unused,
    recordUploadedPhotoAction = unused, setHeroAction = unused, updatePhotoAction = unused;
`);
await writeFile(join(scratch, 'link.js'), compile(`
  import React from 'react';
  export default function Link({href, children, ...rest}) { return <a href={href} {...rest}>{children}</a>; }
`));
await writeFile(join(scratch, 'blob.js'), `export const upload = () => Promise.reject(new Error('No uploads in this fixture'));`);
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {ListingPanel} from './component.js';
  window.calls = [];
  const base = {
    property_id: 'synthetic', title: 'Saved title', summary: 'Saved summary', space: '', access: '',
    interaction: 'Text us', neighborhood: '', notes: '', property_type: 'House', room_type: '',
    bedrooms: 3, bathrooms: 2, beds: 4, amenities: ['Wifi'], amenities_not_included: [],
    source: 'helm', source_ref: null, updated_at: '2026-10-18T12:00:00Z', updated_by: 'staff@example.test',
  };
  const policy = {checkout: null, maxOccupancy: null, pets: null, quietHours: null, cancellation: null, houseRules: null};
  function Fixture() {
    const [content, setContent] = useState(base);
    window.setContent = patch => setContent(c => ({...c, ...patch}));
    return <ListingPanel propertyId="synthetic" content={content} photos={[]} rooms={[]} bedSummaryText=""
      catalog={[{group: 'Basics', items: ['Wifi', 'Washer']}]} consumers={{}} helmRun={false}
      registry={{title: 'Registry title', bedrooms: 3, bathrooms: 2}} housePolicy={policy}/>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done, reject) => {
  const compiler = webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      './listing-actions':join(scratch,'actions.js'),
      './HousePolicyReadout':join(scratch,'policy.js'),
      '@/lib/stable-time':join(scratch,'stabletime.js'),
      '@/components/ConfirmDialog':join(scratch,'confirm-dialog.js'),
      '@/lib/confirm-question':join(scratch,'confirm-question.js'),
      '@/lib/button-class':join(scratch,'button-class.js'),
      'next/link':join(scratch,'link.js'),
      '@vercel/blob/client':join(scratch,'blob.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error || stats?.hasErrors()
    ? reject(error || Error(stats.toString({all:false,errors:true}))) : done()));
});
const server = createServer(async (req,res) => {
  if (req.method !== 'GET') {res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if (req.url === '/bundle.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(join(scratch,'bundle.js')));
  } else {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Listing editor fixture</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--positive:#175d29;--negative:#a22;--signal:#a22}button{margin-right:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page, checks = 0;
try {
  if (process.argv.includes('--serve')) {
    console.log(`Fixture: ${origin}/`);
    await new Promise(resolve => {process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else {
    browser = await puppeteer.launch({
      executablePath:process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()),
      headless:true,args:process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args,
    });
    page = await browser.newPage(); page.setDefaultTimeout(10000);
    const errors=[], confirmations=[], decisions=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('dialog', async dialog => {
      confirmations.push(dialog.message());
      if (decisions.shift()) await dialog.accept(); else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(origin+'/') ? request.continue() : request.abort());
    const click = text => page.evaluate(text => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
      if (!b || b.disabled) throw Error(`Button not ready: ${text}`);
      b.click();
    }, text);
    const reset = async () => { await page.goto(origin); await page.waitForSelector('textarea[name="space"]'); };
    const val = name => page.$eval(`[name="${name}"]`, e => e.value);
    const edit = (selector,value) => page.$eval(selector,(input,value)=>{
      const proto=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const waitCalls = n => page.waitForFunction(n=>window.calls.length===n,{},n);
    const waitText = text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
    const finish = (result,reject=false) => page.evaluate((result,reject)=>{
      const call=window.calls.at(-1); reject ? call.reject(new Error('Synthetic transport failure')) : call.resolve(result);
    },result,reject);
    const draft = {title:'AI title',summary:'AI summary',space:'AI space',access:'AI access',neighborhood:'AI neighborhood'};
    const pass = name=>{checks++;console.log(`PASS ${name}`);};

    await reset();
    await edit('input[aria-label="Note for Draft with AI"]','The view at low tide');
    decisions.push(false); await click('Draft with AI'); await waitCalls(1);
    assert.equal(confirmations.length,1); assert.match(confirmations[0],/Fill blanks only keeps your text/);
    assert.deepEqual(await page.evaluate(()=>window.calls[0].args),['synthetic','The view at low tide']);
    await waitText('Drafting…');
    await finish({ok:true,draft,photos:2}); await waitText('Drafted from the property record and 2 Listing photos.');
    assert.equal(await val('summary'),'Saved summary'); assert.equal(await val('title'),'Saved title');
    assert.equal(await val('space'),'AI space'); assert.equal(await val('access'),'AI access'); assert.equal(await val('neighborhood'),'AI neighborhood');
    assert.equal(await val('interaction'),'Text us');
    pass('a declined replacement keeps typed text, fills only the blanks, and never touches a set title');

    decisions.push(true); await click('Draft with AI'); await waitCalls(2);
    await finish({ok:true,draft:{...draft,summary:'Second summary'},photos:0}); await waitText('Drafted from the property record.');
    assert.equal(await val('summary'),'Second summary'); assert.equal(await val('title'),'Saved title');
    pass('an accepted replacement rewrites the four description fields');

    await edit('textarea[name="space"]','Hand edit'); const before = await page.evaluate(()=>['summary','space','access','neighborhood'].map(n=>document.querySelector(`[name="${n}"]`).value));
    decisions.push(true); await click('Draft with AI'); await waitCalls(3);
    await finish({ok:false,error:'Could not draft the listing: synthetic'}); await waitText('Could not draft the listing: synthetic');
    decisions.push(true); await click('Draft with AI'); await waitCalls(4);
    await finish(null,true); await waitText('Could not draft the listing. Try again.');
    assert.deepEqual(await page.evaluate(()=>['summary','space','access','neighborhood'].map(n=>document.querySelector(`[name="${n}"]`).value)),before);
    pass('returned and thrown failures keep every field as it was and allow a retry');

    await page.$eval('form', f => f.requestSubmit()); await waitCalls(5);
    const saved = await page.evaluate(()=>window.calls.at(-1).args[1]);
    assert.equal(saved.summary,'Second summary'); assert.equal(saved.space,'Hand edit'); assert.equal(saved.title,'Saved title');
    await finish({error:null,ok:true,message:'Saved.'}); await waitText('Saved.');
    pass('Save listing saves the drafted text with the hand edits');

    await page.evaluate(()=>window.setContent({updated_at:'2026-10-18T13:00:00Z',summary:'Newer saved summary',space:'Newer space'}));
    await page.waitForFunction(()=>document.querySelector('[name="summary"]').value==='Newer saved summary');
    assert.equal(await val('space'),'Newer space');
    assert.deepEqual(errors,[]);
    pass('a newer saved record replaces an old draft instead of being overwritten by it');
    console.log(`All ${checks} listing editor browser checks passed.`);
  }
} catch (error) {
  if (page && !page.isClosed()) console.error('Synthetic editor state:',await page.evaluate(()=>({
    text:document.body.innerText.slice(0,2000),calls:window.calls?.map(c=>c.kind),
  })).catch(()=>null));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
