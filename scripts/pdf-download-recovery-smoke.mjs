/** PDF download controls and onboarding navigation; synthetic records and controlled I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-downloads-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

for(const [name,path] of [
 ['owner','src/app/contract/[token]/signed/DownloadCopyButton.tsx'],['guest','src/app/agreement/[token]/signed/AgreementDownloadButton.tsx'],['projection','src/components/projections/DownloadPdfButton.tsx'],['onboarding','src/app/contract/[token]/signed/CompleteOnboardingButton.tsx'],['download-hook','src/lib/use-pdf-download.ts'],['pdf-download','src/lib/pdf-download.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
// Mock only the framework navigation boundary; the production link and its label are real.
await writeFile(join(scratch,'link.js'),compile(`
import React,{createContext,useContext,useState} from 'react';const Status=createContext({pending:false});export const useLinkStatus=()=>useContext(Status);
export default function Link({href,children,onClick,...props}){const [pending,setPending]=useState(false);window.finishNavigation=()=>setPending(false);return <Status.Provider value={{pending}}><a {...props} href={href} onClick={event=>{onClick?.(event);const modified=event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0;if(modified){window.modified.push({prevented:event.defaultPrevented,href});event.preventDefault();return;}if(event.defaultPrevented)return;event.preventDefault();window.navs.push(href);setPending(true);}}>{children}</a></Status.Provider>}
`));
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {DownloadCopyButton} from './owner';import {AgreementDownloadButton} from './guest';import {DownloadPdfButton} from './projection';import {CompleteOnboardingButton} from './onboarding';
window.calls=[];window.downloads=[];window.blobs=[];window.revoked=[];window.cleanup=[];window.navs=[];window.modified=[];window.failClick=false;
const wait=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
const setTimer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>ms===5000?(window.cleanup.push(fn),12345):setTimer(fn,ms,...args);
const makeUrl=URL.createObjectURL.bind(URL),revokeUrl=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{window.blobs.push({size:blob.size,type:blob.type});return makeUrl(blob);};URL.revokeObjectURL=url=>{window.revoked.push(url);revokeUrl(url);};
const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('blob:')){if(window.failClick)throw Error('Synthetic download failure');window.downloads.push({url:this.href,filename:this.download});return;}return click.call(this);};
window.fetch=async(url,options)=>{const spec=await wait('fetch',{url,options});const response=new Response(spec.body??'%PDF-1.7\\nSynthetic fixture\\n%%EOF',{status:spec.status??200,headers:{'Content-Type':spec.type??'application/pdf',...(spec.filename?{'Content-Disposition':'attachment; filename="'+spec.filename+'"'}:{})}});if(spec.delayBody){response.blob=async()=>{const body=await wait('body',{});return new Blob([body],{type:'application/pdf'});};}return response;};
const mode=new URLSearchParams(location.search).get('mode');createRoot(document.getElementById('root')).render(<section id={mode}>
{mode==='owner'&&<DownloadCopyButton href="/api/projection-pdf?id=synthetic&amp;type=contract&amp;token=synthetic-token" label="Download a copy"/>}
{mode==='guest'&&<AgreementDownloadButton href="/api/agreement-pdf?id=synthetic&amp;token=synthetic-token"/>}
{mode==='projection'&&<DownloadPdfButton projectionId="synthetic projection" type="contract" label="Download contract"/>}
{mode==='onboarding'&&<CompleteOnboardingButton href="/onboarding/synthetic-token"/>}
</section>);
`));
const alias={'@/lib/use-pdf-download':'download-hook','./pdf-download':'pdf-download','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Download recovery fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://synthetic.test data:");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic download recovery</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1100});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+mode);};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.filter(b=>b.checkVisibility()).find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args}))),waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const value=s=>page.$eval(s,e=>e.value),ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const text=()=>page.$eval('body',e=>e.innerText),waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const blur=s=>page.$eval(s,e=>e.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
const pass=m=>{checks++;console.log('PASS '+m);};
const submit=(scope,twice=false)=>page.$eval(scope+' form',(form,twice)=>{form.requestSubmit();if(twice)form.requestSubmit();},twice);

const nav=()=>page.evaluate(()=>window.navs);
const leave=()=>page.$$eval('a',links=>links.find(a=>a.textContent==='Leave page').click());



const activate=(mode,twice=false)=>page.$eval('#'+mode+(mode==='projection'?' button':' a'),(element,twice)=>{element.click();if(twice)element.click();},twice);
const busy=mode=>page.$eval('#'+mode+(mode==='projection'?' button':' a'),e=>e.matches(':disabled')||e.getAttribute('aria-busy')==='true');
const idle=mode=>page.waitForFunction(mode=>{const e=document.querySelector('#'+mode+(mode==='projection'?' button':' a'));return e&&!e.matches(':disabled')&&e.getAttribute('aria-busy')!=='true';},{},mode);
for(const mode of ['owner','guest','projection']){
 await reset(mode);await activate(mode,true);await waitCalls(1);assert.equal(await busy(mode),true);const request=(await calls())[0].args;
 assert.equal(request.options.cache,'no-store');assert.equal(request.url,mode==='owner'?'/api/projection-pdf?id=synthetic&type=contract&token=synthetic-token':mode==='guest'?'/api/agreement-pdf?id=synthetic&token=synthetic-token':'/api/projection-pdf?id=synthetic%20projection&type=contract');pass(mode+': rapid clicks send one request with the original endpoint and authorization parameters');
 await finish(0,{delayBody:true,filename:'Signed copy.pdf'});await waitCalls(2);assert.equal(await busy(mode),true);await activate(mode,true);assert.equal((await calls()).length,2);assert.equal(await page.evaluate(()=>window.downloads.length),0);pass(mode+': progress stays pending until the body arrives, not just the headers');
 await finish(1,'%PDF-1.7 synthetic bytes');await idle(mode);assert.equal(await page.evaluate(()=>window.downloads[0].filename),'Signed copy.pdf');assert.equal(await page.evaluate(()=>window.revoked.length),0);assert.equal(await page.evaluate(()=>window.cleanup.length),1);await page.evaluate(()=>window.cleanup.shift()());assert.equal(await page.evaluate(()=>window.revoked.length),1);pass(mode+': validated response starts one file download and delays blob cleanup');
 for(const spec of [{status:401},{status:500},{type:'text/html',body:'<html>sign in</html>'},{body:''},{body:'not a pdf'}]){const n=(await calls()).length;await activate(mode);await waitCalls(n+1);await finish(n,spec);await page.waitForSelector('[role="alert"]');await idle(mode);assert.equal(await page.evaluate(()=>window.downloads.length),1);}pass(mode+': HTTP errors, login pages, empty responses and invalid PDF bodies show retry without saving files');
 let n=(await calls()).length;await activate(mode);await waitCalls(n+1);await finish(n,null,true);await waitText('Check your connection');await idle(mode);pass(mode+': lost requests release the control for retry');
 n=(await calls()).length;await activate(mode);await waitCalls(n+1);await finish(n,{delayBody:true});await waitCalls(n+2);await finish(n+1,null,true);await waitText('Check your connection');await idle(mode);assert.equal(await page.evaluate(()=>window.downloads.length),1);pass(mode+': interrupted response bodies never become downloads');
 await page.evaluate(()=>window.failClick=true);n=(await calls()).length;await activate(mode);await waitCalls(n+1);await finish(n,{});await waitText('Check your connection');await idle(mode);assert.equal(await page.evaluate(()=>window.cleanup.length),1);await page.evaluate(()=>{window.cleanup.shift()();window.failClick=false;});pass(mode+': browser download failures still clean up the blob and permit retry');
 n=(await calls()).length;await activate(mode);await waitCalls(n+1);await finish(n,{});await idle(mode);assert.equal(await page.$$eval('[role="alert"]',es=>es.length),0);assert.equal(await page.evaluate(()=>window.downloads.at(-1).filename),mode==='owner'?'signed-contract.pdf':mode==='guest'?'signed-agreement.pdf':'contract-synthetic projection.pdf');pass(mode+': a successful retry clears the error and preserves a useful fallback filename');
}
await reset('onboarding');await activate('onboarding');await waitText('Loading');assert.deepEqual(await page.evaluate(()=>window.navs),['/onboarding/synthetic-token']);await page.evaluate(()=>window.finishNavigation());await waitText('Complete the onboarding form');await activate('onboarding');assert.equal(await page.evaluate(()=>window.navs.length),2);pass('interrupted onboarding transition resets its label and allows another navigation');
await page.evaluate(()=>window.finishNavigation());await waitText('Complete the onboarding form');
for(const key of ['ctrlKey','metaKey','shiftKey','altKey']){await page.$eval('#onboarding a',(e,key)=>e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,[key]:true})),key);assert.equal(await page.evaluate(()=>window.modified.at(-1).prevented),false);assert.equal(await page.evaluate(()=>window.navs.length),2);}pass('onboarding keeps native modifier-click behavior instead of intercepting new tabs');
assert.equal(await page.$eval('#onboarding a',e=>e.getAttribute('href')),'/onboarding/synthetic-token');assert.deepEqual(errors,[]);console.log('PASS '+checks+' PDF download and onboarding browser checks; synthetic responses only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
