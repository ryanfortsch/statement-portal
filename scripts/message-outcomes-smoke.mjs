/** Real outcome components; synthetic data only, all remote requests blocked. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-message-outcomes-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [['MessageOutcomes','src/components/MessageOutcomes.tsx'],['RecentMessageOutcomes','src/components/RecentMessageOutcomes.tsx'],['core','src/lib/message-outcomes.ts']]) await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {RecentMessageOutcomes} from './RecentMessageOutcomes.js';
const work={id:'synthetic-slip',title:'Investigate upstairs thermostat schedule',status:'open',assignee:'Unassigned',scheduledDate:'',completedAt:'',error:''};
const note={id:'synthetic-note',audience:'cleaner',recipient:'Test cleaner',status:'pending',body:'The guests have left. The house is ready for cleaning.',error:''};
const items=[{id:'synthetic-source',who:'Guest',property:'Example home',sourceText:'We have left the house. The upstairs AC ran at night and was very cold.',replyStatus:'approved',resolvedAt:'2026-09-30T14:00:00Z',outcomes:{work:[work],notes:[note],error:''}}];
window.items=items;window.calls=[];window.fetch=()=>new Promise((resolve,reject)=>window.calls.push({resolve,reject}));
window.good=()=>window.calls.at(-1).resolve(new Response(JSON.stringify({items:window.items})));window.fail=()=>window.calls.at(-1).resolve(new Response('{}',{status:502}));
createRoot(document.getElementById('root')).render(<><header><b>Helm</b><span>MESSAGING</span></header><main><div className="eyebrow">GUESTS · INBOX</div><RecentMessageOutcomes initial={items} audience="guests"/></main></>);
`));
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:{'@/lib/message-outcomes':join(scratch,'core.js'),'next/link':join(scratch,'link.js')}},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
const css=`*{box-sizing:border-box}body{margin:0;background:#f5f0e4;color:#102b46;font:14px Arial,sans-serif;--paper:#f5f0e4;--paper-2:#efe6cf;--ink-1:#102b46;--ink-2:#214263;--ink-3:#59718a;--ink-4:#788ca0;--rule:#d9cda9;--rule-soft:#e3dac4;--signal:#a44e40;--success:#426d66}header{display:flex;gap:35px;align-items:center;padding:26px 6%;border-bottom:1px solid #102b46}header b{font:28px Georgia}header span,.eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase}main{max-width:1100px;margin:30px auto;padding:0 24px}.font-serif{font-family:Georgia,serif}a{color:inherit}button{font:inherit;cursor:pointer}h2{font-weight:500}p{line-height:1.6}`;
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helm message outcomes · synthetic preview</title><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);await page.waitForSelector('[aria-label="Work and notes"]');await page.waitForFunction(()=>window.calls.length===1);
 assert.match(await page.$eval('body',e=>e.innerText),/Unassigned/);assert.match(await page.$eval('body',e=>e.innerText),/Draft awaiting approval/);
 assert.equal(await page.$eval('a[href^="/work/"]',e=>e.getAttribute('href')),'/work/synthetic-slip');
 await page.$$eval('summary',els=>els.find(e=>e.textContent==='View note').click());assert.equal(await page.$eval('a[href*="#approval-"]',e=>e.getAttribute('href')),'/cleaner-messaging#approval-synthetic-note');
 await page.evaluate(()=>{window.items[0].outcomes.work[0].status='done';window.items[0].outcomes.work[0].assignee='Test HVAC technician';window.items[0].outcomes.notes[0].status='approved';window.good();});
 await page.waitForFunction(()=>document.body.innerText.includes('Completed'));
 assert.match(await page.$eval('body',e=>e.innerText),/Test HVAC technician/);assert.equal(await page.$('a[href*="#approval-"]'),null);
 await page.$$eval('button',bs=>bs.find(b=>b.textContent==='Refresh').click());await page.waitForFunction(()=>window.calls.length===2);await page.evaluate(()=>window.fail());
 await page.waitForFunction(()=>document.body.innerText.includes('Couldn’t refresh'));assert.match(await page.$eval('body',e=>e.innerText),/Completed/);
 await page.$$eval('button',bs=>bs.find(b=>b.textContent==='Retry').click());await page.waitForFunction(()=>window.calls.length===3);await page.evaluate(()=>window.good());await page.waitForFunction(()=>!document.body.innerText.includes('Couldn’t refresh'));
 // Screenshot the initial actionable state, not a fabricated production record.
 await page.evaluate(()=>{window.items[0].outcomes.work[0].status='open';window.items[0].outcomes.work[0].assignee='Unassigned';window.items[0].outcomes.notes[0].status='pending';});
 await page.$$eval('button',bs=>bs.find(b=>b.textContent==='Refresh').click());await page.waitForFunction(()=>window.calls.length===4);await page.evaluate(()=>window.good());await page.waitForFunction(()=>document.body.innerText.includes('Unassigned'));
 await page.screenshot({path:'/private/tmp/helm-message-outcomes-desktop.png',fullPage:true});
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/private/tmp/helm-message-outcomes-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: live status changes, note/source details, exact links, failed refresh retention, retry, and mobile width');
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
