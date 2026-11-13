/** Actual enrollment panel, Button and confirmation dialog. Synthetic API only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-cleaner-enrollment-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of Object.entries({panel:'src/app/channels/65_calderwood/message-preparation/cleaners/CleanerEnrollmentPanel.tsx',
 contract:'src/lib/channex-messaging/cleaner-runtime-contract.ts',button:'src/components/Button.tsx',confirm:'src/components/ConfirmDialog.tsx',
 classes:'src/lib/button-class.ts',question:'src/lib/confirm-question.ts'}))await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'link.js'),compile(`export default function Link({children,...props}){return <a {...props}>{children}</a>}`));
await writeFile(join(scratch,'watchdog.js'),'export function usePendingWatchdog(){}');
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {CleanerEnrollmentPanel} from './panel.js';import {ConfirmProvider} from './confirm.js';
const params=new URLSearchParams(location.search),id='00000000-0000-4000-8000-000000000001';
const reference={captureId:id,templateDigest:'b'.repeat(64)};
window.calls=[];window.lose=true;window.releaseId=params.has('recorded')?'00000000-0000-4000-8000-000000000002':null;
const review=()=>({...reference,observedAt:new Date().toISOString(),authority:params.has('pending')?'guesty':'helm',automationsEnabled:false,
 scopeEnabled:!params.has('pending'),routeGeneration:id,recipientReady:true,templatesReady:true,recipientReview:'c'.repeat(64),
 releaseId:window.releaseId,configurationReady:true,canEnroll:!window.releaseId&&!params.has('pending'),canSend:false});
window.fetch=async(url,init)=>{
 if(url!=='/api/channex/message-preparation/cleaner-enrollment')throw Error('Unapproved fixture endpoint');
 const request=JSON.parse(init.body);window.calls.push(request);
 if(request.action==='review')return Response.json(params.has('configuration')?{state:'configuration_required',canSend:false}:{state:'review',review:review(),canSend:false});
 window.releaseId=request.releaseId;
 if(window.lose){window.lose=false;throw Error('Synthetic response lost after commit');}
 return Response.json({state:'existing',releaseId:request.releaseId,canSend:false});
};
createRoot(document.getElementById('root')).render(<ConfirmProvider><main className="max-w-[1000px] mx-auto px-5 sm:px-10 py-10"><p className="eyebrow">65 Calderwood · Message handover</p><h1 className="font-serif text-4xl mt-3">Cleaner automation</h1><p className="mt-4">Keep the existing reminder times and establish one sender.</p><CleanerEnrollmentPanel reference={params.has('missing')?null:reference}/></main></ConfirmProvider>);
`));
const alias={'@/components/Button':'button','@/components/ConfirmDialog':'confirm','@/lib/button-class':'classes','@/lib/confirm-question':'question',
 '@/lib/use-pending-watchdog':'watchdog','next/link':'link','@/lib/channex-messaging/cleaner-runtime-contract':'contract'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),
 output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});
 compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
const css=(await postcss([tailwind({base:root})]).process(await readFile(join(root,'src/app/globals.css'),'utf8'),{from:join(root,'src/app/globals.css')})).css;
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic cleaner enrollment</title><style>'+css+'body{background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>');
});
let browser;
try {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 const text=()=>page.$eval('body',e=>e.innerText);
 const click=async(label,scope='body')=>page.$eval(scope,(e,label)=>{const b=[...e.querySelectorAll('button')].find(b=>b.textContent===label);if(!b)throw Error(label);b.click();},label);
 await page.goto(origin+'/?missing');assert.equal(await page.evaluate(()=>window.calls.length),0);assert.match(await text(),/saved original-template archive/);
 await page.goto(origin+'/?configuration');await page.waitForFunction(()=>document.body.innerText.includes('Sending remains off.'));assert.equal(await page.$('input'),null);
 await page.goto(origin+'/?pending');await page.waitForFunction(()=>document.body.innerText.includes('Handover review'));assert.equal(await page.$('input'),null);
 await page.goto(origin+'/?recorded');await page.waitForFunction(()=>document.body.innerText.includes('No replacement request is needed.'));assert.equal(await page.$('input'),null);
 await page.goto(origin);await page.waitForSelector('input');
 assert.equal(await page.$$eval('button',bs=>bs.find(b=>b.textContent==='Record cleaner enrollment').disabled),true);
 const fields=await page.$$('input:not([type="checkbox"])');
 for(const [i,value] of ['00000000-0000-4000-8000-000000000003','2026-11-12T12:00:00.000Z','2026-11-12T13:00:00.000Z'].entries())await fields[i].type(value);
 await page.click('input[type="checkbox"]');await click('Record cleaner enrollment');await page.waitForSelector('[role="alertdialog"]');
 await click('Cancel','[role="alertdialog"]');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='enroll').length),0);
 await click('Record cleaner enrollment');await page.waitForSelector('[role="alertdialog"]');await click('Record cleaner enrollment','[role="alertdialog"]');
 await page.waitForSelector('[role="alert"]');const saved=await page.evaluate(()=>window.calls.find(c=>c.action==='enroll'));
 assert.ok(saved.releaseId);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helm-calderwood-cleaner-enrollment:v1')).releaseId),saved.releaseId);
 await click('Refresh review');await page.waitForFunction(()=>document.body.innerText.includes('Receipt recorded'));
 await page.click('input[type="checkbox"]');await click('Confirm saved request');await page.waitForSelector('[role="alertdialog"]');
 await click('Confirm saved request','[role="alertdialog"]');await page.waitForFunction(()=>document.body.innerText.includes('Cleaner enrollment receipt confirmed.'));
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.action==='enroll')),[saved,saved]);
 assert.equal(await page.$$eval('input:not([type="checkbox"])',xs=>xs.every(x=>x.disabled)),true);
 for(const width of [1280,390]){await page.setViewport({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:join(tmpdir(),`helm-cleaner-enrollment-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PASS: actual owner panel and confirmation dialog; pending/configuration gates, cancellation, lost-response retry preserves exact request, recorded receipt and mobile layout');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
