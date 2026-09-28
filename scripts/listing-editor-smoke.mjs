/** Real listing editor in React/Chromium, with synthetic listings and controlled
 * Server Action promises. No GitHub writes or production application are used.
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
  ['component', 'src/app/properties/listing-copy-studio/ListingCopyStudio.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const call = (kind, args) => new Promise((resolve, reject) => {
    window.calls.push({kind, args, resolve, reject});
  });
  export const stageListingCopyEdit = (...args) => call('stage', args);
  export const draftListingCopyFromGuesty = (...args) => call('redraft', args);
  export const publishListingCopyBatch = (...args) => call('publish', args);
`);
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useEffect, useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {ListingCopyStudio} from './component.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  window.calls = []; window.confirmations = []; window.acceptReplacement = false;
  window.guarded = hasUnsavedWork;
  const manual = new URLSearchParams(location.search).has('manual');
  if (manual) window.confirm = message => {
    window.confirmations.push(message); return window.acceptReplacement;
  };
  const initialRows = ['North','South'].map(name => ({
    guestyListingId:name, publicName:'Synthetic ' + name, internalName:name, liveUrl:'#',
    tagline:name + ' saved tagline', description:name + ' saved About',
    highlights:['Harbor views','Private patio','Parking'], staged:true, flags:[],
  }));
  function Fixture() {
    const [mounted,setMounted] = useState(true);
    const [tick,setTick] = useState(0);
    window.unmount = () => setMounted(false);
    useEffect(() => {const id=setInterval(()=>setTick(n=>n+1),50);return()=>clearInterval(id);},[]);
    const latest = () => window.calls.at(-1);
    return <>
      <aside><h1>Synthetic listing editor check</h1>
        <p>Guard: {hasUnsavedWork() ? 'active' : 'clear'} · Calls: {window.calls.length} · Confirmations: {window.confirmations.length}</p>
        {manual && <>
          <label><input type="checkbox" onChange={e=>window.acceptReplacement=e.target.checked}/> Accept replacement</label>
          <button onClick={()=>latest()?.reject(new Error('Synthetic transport failure'))}>Reject action</button>
          <button onClick={()=>latest()?.resolve({ok:false,error:'Synthetic returned failure'})}>Return failure</button>
          <button onClick={()=>latest()?.resolve({ok:true,staged:true,prUrl:'#',draft:{tagline:'Guesty tagline',description:'Guesty About',highlights:['Guesty one','Guesty two','Guesty three']}})}>Succeed action</button>
          <button onClick={()=>setMounted(v=>!v)}>Toggle editor</button>
        </>}
      </aside>
      {mounted && <ListingCopyStudio initialRows={initialRows}/>}
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done, reject) => {
  const compiler = webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      '../[id]/stay-cape-ann/actions':join(scratch,'actions.js'),
      '@/lib/unsaved-work':join(scratch,'unsaved-work.js'),
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
    res.end('<!doctype html><title>Listing editor safeguard fixture</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--positive:#175d29;--signal:#a22}button{margin-right:8px}aside{background:#eee;padding:12px}</style><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page, checks = 0;
try {
  if (process.argv.includes('--serve')) {
    console.log(`Fixture: ${origin}/?manual=1`);
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
      if (dialog.type() === 'beforeunload') {await dialog.accept();return;}
      confirmations.push(dialog.message());
      if (decisions.shift()) await dialog.accept(); else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(origin+'/') ? request.continue() : request.abort());
    const click = async text => {
      const button = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text || b.getAttribute('aria-label')===text),text);
      assert.ok(button.asElement(),`Missing button: ${text}`);
      await button.asElement().click(); await button.dispose();
    };
    const reset = async () => {
      await page.goto(origin); await page.waitForSelector('button');
      await click('Expand');
    };
    const edit = (selector,value) => page.$eval(selector,(input,value)=>{
      const proto=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const tagline = 'input[placeholder^="8"]';
    const readCopy = () => page.evaluate(()=>[...document.querySelectorAll('input[type=text], input:not([type]), textarea')].map(e=>e.value));
    const waitCalls = n => page.waitForFunction(n=>window.calls.length===n,{},n);
    const finish = (result,reject=false) => page.evaluate((result,reject)=>{
      const call=window.calls.at(-1); reject ? call.reject(new Error('Synthetic transport failure')) : call.resolve(result);
    },result,reject);
    const waitText = text=>page.waitForFunction(text=>document.body.innerText.includes(text),{},text);
    const enabled = text=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)?.disabled===false,text);
    const pass = name=>{checks++;console.log(`PASS ${name}`);};

    await reset(); await edit(tagline,'Manual tagline'); await edit('textarea','Manual About');
    await edit('input[placeholder="Highlight 1"]','Manual highlight');
    const manualCopy=await readCopy();
    decisions.push(false); await click('Redraft from Guesty');
    await page.waitForFunction(()=>document.activeElement?.textContent==='Redraft from Guesty');
    assert.equal(confirmations.length,1); assert.match(confirmations[0],/Synthetic North/);
    assert.deepEqual(await readCopy(),manualCopy);
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.equal(await enabled('Publish all (1)'),false);
    pass('cancelled replacement preserves every field and does not call Guesty');

    decisions.push(true); await click('Redraft from Guesty'); await waitCalls(1);
    await waitText('Redrafting…');
    assert.equal(await enabled('Publish all (1)'),false);
    assert.equal(await page.evaluate(()=>document.body.innerText.includes('Publishing…')),false);
    await finish(null,true); await waitText('Could not load Guesty copy');
    assert.deepEqual(await readCopy(),manualCopy);
    assert.equal(await enabled('Redraft from Guesty'),true);
    assert.equal(await page.$eval(tagline,e=>e.disabled),false);
    decisions.push(true); await click('Redraft from Guesty'); await waitCalls(2);
    await finish({ok:false,error:'Synthetic returned failure'}); await waitText('Synthetic returned failure');
    assert.deepEqual(await readCopy(),manualCopy);
    pass('thrown and returned redraft failures preserve text and unlock retry');

    decisions.push(true); await click('Redraft from Guesty'); await waitCalls(3);
    await finish({ok:true,draft:{tagline:'Guesty tagline',description:'Guesty About',highlights:['One','Two','Three']}});
    await page.waitForFunction(()=>document.querySelector('textarea').value==='Guesty About');
    assert.equal(await enabled('Stage edit'),true);
    assert.equal(await page.evaluate(()=>window.guarded()),true);
    pass('confirmed replacement applies the returned copy as unsaved work');

    await reset(); const before=confirmations.length;
    await click('Expand'); await click('Redraft from Guesty'); await waitCalls(1);
    assert.equal(confirmations.length,before);
    assert.equal(await page.$$eval('input:not([type=checkbox]), textarea',els=>els.every(e=>e.disabled)),true);
    await finish(null,true); await waitText('Could not load Guesty copy');
    pass('unchanged copy needs no confirmation and pending actions lock editing');

    await reset(); await edit(tagline,'Restage this');
    await click('Publish all (1)');
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    await waitText('Stage your unsaved edits before publishing.');
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Stage edit');b.click();b.click();});
    await waitCalls(1); assert.equal(await page.evaluate(()=>window.calls[0].kind),'stage');
    await waitText('Staging…');
    assert.equal(await page.evaluate(()=>document.body.innerText.includes('Publishing…')),false);
    await finish(null,true); await waitText('Could not confirm the save');
    assert.equal(await page.$eval(tagline,e=>e.value),'Restage this');
    assert.equal(await enabled('Stage edit'),true);
    assert.equal(await enabled('Publish all (1)'),false);
    pass('dirty rows block publication and duplicate stage clicks issue one request');

    await click('Stage edit'); await waitCalls(2);
    await finish({ok:false,error:'Synthetic returned failure'}); await waitText('Synthetic returned failure');
    assert.equal(await enabled('Stage edit'),true);
    await click('Stage edit'); await waitCalls(3); await finish({ok:true,staged:true});
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Publish all (2)'&&!b.disabled));
    assert.equal(await page.evaluate(()=>window.guarded()),false);
    pass('stage retries retain text and successful restaging re-enables publication');

    await click('Expand'); await click('Publish all (2)'); await waitCalls(4);
    await waitText('Publishing…');
    assert.equal(await page.$$eval('input:not([type=checkbox]), textarea',els=>els.every(e=>e.disabled)),true);
    assert.equal(await page.evaluate(()=>window.guarded()),true);
    await finish({ok:false,error:'Synthetic publish failure'}); await waitText('Synthetic publish failure');
    assert.equal(await enabled('Publish all (2)'),true);
    await click('Publish all (2)'); await waitCalls(5); await finish(null,true);
    await waitText('Could not confirm publication');
    assert.equal(await enabled('Publish all (2)'),true);
    assert.equal(await page.$eval(tagline,e=>e.disabled),false);
    pass('publication locks all copy and failed responses preserve staged markers');

    await click('Publish all (2)'); await waitCalls(6); await finish({ok:true,prUrl:'#'});
    await waitText('Published. The site rebuilds in a couple minutes.');
    assert.equal(await enabled('Publish all (0)'),false);
    assert.equal(await page.evaluate(()=>window.guarded()),false);
    assert.deepEqual(errors,[]);
    pass('confirmed publication clears staged state and leaves no browser errors');
    console.log(`All ${checks} listing editor browser checks passed.`);
  }
} catch (error) {
  if (page && !page.isClosed()) console.error('Synthetic editor state:',await page.evaluate(()=>({
    text:document.body.innerText,calls:window.calls?.map(c=>c.kind),
  })).catch(()=>null));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
