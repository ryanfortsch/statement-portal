/** Real queue hook and status control; controlled synthetic fetches only. */
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
const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'helm-queue-refresh-'));
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
for (const [name, path] of [['hook', 'src/lib/use-approval-queue.ts'], ['loader', 'src/lib/queue-loader.ts'], ['control', 'src/components/QueueRefreshControl.tsx']]) {
  let source = await readFile(join(root, path), 'utf8');
  // Shorten only the fixture's watchdog; production remains 20 seconds.
  source = source.replace('options.timeoutMs ?? 20_000', "options.timeoutMs ?? (location.search.includes('manual') ? 20_000 : 800)");
  await writeFile(join(scratch, name + '.js'), compile(source));
}
await writeFile(join(scratch, 'counts.js'), 'export const invalidatePendingCounts=()=>{};');
await writeFile(join(scratch, 'router.js'), 'export const useRouter=()=>({refresh:()=>{throw Error("Queue control must not refresh the route")}});');
await writeFile(join(scratch, 'entry.js'), compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useApprovalQueue} from './hook.js';import {QueueRefreshControl} from './control.js';
window.calls=[];window.offset=0;const now=Date.now;Date.now=()=>now()+window.offset;
window.fetch=(url,options)=>new Promise((resolve,reject)=>window.calls.push({url,options,resolve,reject}));
const seed=[{id:'synthetic-card',status:'pending'}];
function Queue(){
 const {approvals,updatedTick,refreshStatus,refresh}=useApprovalQueue(seed,'guests');
 window.refreshQueue=refresh;
 return <section>{location.search.includes('manual') && <aside><button onClick={()=>window.calls.at(-1)?.resolve(new Response('{}',{status:502}))}>Simulate failure</button><button onClick={()=>window.calls.at(-1)?.resolve(new Response(JSON.stringify({approvals:[{id:'synthetic-card',status:'pending'}]})))}>Simulate success</button></aside>}<h2>Needs review</h2><QueueRefreshControl onRefresh={refresh} refreshTick={updatedTick} status={refreshStatus}/>
 <p id="cards">{approvals.map(a=>a.id).join(', ')}</p><label>Draft reply <textarea defaultValue="Unfinished reply"/></label><p id="tick">{updatedTick}</p></section>;
}
function App(){const [mounted,setMounted]=useState(true);window.unmount=()=>setMounted(false);return <>{mounted&&<Queue/>}</>;}
createRoot(document.getElementById('root')).render(<App/>);
`));
await new Promise((resolve,reject)=>{
 const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:{'@/lib/queue-loader':join(scratch,'loader.js'),'@/lib/pending-count-client':join(scratch,'counts.js'),'next/navigation':join(scratch,'router.js')}},performance:{hints:false}});
 compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
});
if(process.argv.includes('--compile-only')){console.log('Queue refresh fixture compiled');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Queue refresh fixture</title><style>body{margin:40px;background:#f5f0e4;color:#152e47;font:16px Georgia;--ink-3:#52677a;--rule:#dacaac;--signal:#a84b35}section{max-width:700px}button{max-width:100%;line-height:1.8;text-align:left}textarea{display:block;width:90%;margin-top:10px;padding:12px;background:transparent;border:1px solid var(--rule)}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 if(process.argv.includes('--serve')){console.log(`Fixture: ${origin}`);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 else {
  browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForSelector('textarea');
  const text=t=>page.waitForFunction(t=>document.querySelector('button').textContent.includes(t),{},t);
  await page.evaluate(()=>{window.offset=90_000;});await text('1 min ago');
  await page.click('button');await text('Refreshing');
  assert.equal(await page.$eval('#tick',el=>el.textContent),'0');
  await page.evaluate(()=>window.calls[0].resolve(new Response('{}',{status:502})));
  await text('Refresh failed');await text('1 min ago');
  assert.equal(await page.$eval('#cards',el=>el.textContent),'synthetic-card');
  assert.equal(await page.$eval('textarea',el=>el.value),'Unfinished reply');
  await page.click('button');
  await page.evaluate(()=>window.calls[1].resolve(new Response(JSON.stringify({approvals:[{id:'fresh-card'}]}))));
  await page.waitForFunction(()=>document.querySelector('#tick').textContent==='1');await text('just now');
  // Browser returns offline during an outstanding request. Its late success is ignored.
  await page.click('button');
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));window.calls[2].resolve(new Response('{"approvals":[]}'));});
  await text('Offline');assert.equal(await page.$eval('#cards',el=>el.textContent),'fresh-card');
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
  await text('Refreshing');await text('Refresh failed'); // Hung reconnect is bounded.
  await page.click('button');
  await page.evaluate(()=>window.calls.at(-1).resolve(new Response('{"approvals":[]}')));
  await page.waitForFunction(()=>document.querySelector('#tick').textContent==='2');await text('just now');assert.equal(await page.$eval('#cards',el=>el.textContent),'');
  assert.equal(await page.$eval('textarea',el=>el.value),'Unfinished reply');
  await page.setViewport({width:375,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.click('button');await page.evaluate(()=>window.unmount());
  await page.evaluate(()=>window.calls.at(-1).resolve(new Response('{"approvals":[]}')));
  assert.deepEqual(errors,[]);
  console.log('PASS queue failure, retained draft/data/age, confirmed recovery, offline cancellation, reconnect timeout, retry, mobile layout and unmount');
 }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
