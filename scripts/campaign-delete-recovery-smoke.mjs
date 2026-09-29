/** Campaign creation and deletion controls; synthetic I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-campaign-delete-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

for(const [name,path] of [
 ['campaign','src/app/guests/campaigns/new/CampaignCreationForms.tsx'],['DraftButton','src/app/guests/campaigns/new/DraftButton.tsx'],
 ['inspection','src/app/inspections/DeleteInspectionButton.tsx'],['playbook','src/app/playbook/[slug]/DeleteEntryButton.tsx'],['notice','src/components/properties/DeletePropertyNoticeButton.tsx'],
 ['guard','src/lib/use-draft-navigation-guard.ts'],['recover','src/lib/use-recoverable-action.ts'],['unsaved','src/lib/unsaved-work.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const createDraftFromBrief=data=>save('brief',Object.fromEntries(data));export const createDraftCampaign=data=>save('blank',Object.fromEntries(data));
export const deleteInspection=id=>save('inspection',{id});export const deleteEntry=data=>save('playbook',Object.fromEntries(data));
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>{window.refreshes++;};');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,...props}){return <a {...props} href={href}>{children}</a>}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {CampaignCreationForms} from './campaign';import {DeleteInspectionButton} from './inspection';import {DeleteEntryButton} from './playbook';import {DeletePropertyNoticeButton} from './notice';import {hasUnsavedWork} from './unsaved';import {save} from './actions';
window.calls=[];window.navs=0;window.refreshes=0;window.confirmAnswer=false;window.confirms=[];window.guarded=hasUnsavedWork;window.confirm=message=>{window.confirms.push(message);return window.confirmAnswer;};
const mode=new URLSearchParams(location.search).get('mode');createRoot(document.getElementById('root')).render(<><a href="/away" onClick={e=>{e.preventDefault();window.navs++;}}>Leave page</a><section id={mode}>
{mode==='campaign'&&<CampaignCreationForms segments={[{id:'insider',name:'Insider List'},{id:'other',name:'Other'}]} tones={[{id:'editorial',label:'Editorial',sub:'Editorial tone'},{id:'warm',label:'Warm',sub:'Warm tone'}]} defaultSegment="insider"/>}
{mode==='inspection'&&<DeleteInspectionButton inspectionId="synthetic-inspection" label="Synthetic walk"/>}
{mode==='playbook'&&<DeleteEntryButton id="synthetic-entry" title="Synthetic entry"/>}
{(mode==='notice'||mode==='note')&&<DeletePropertyNoticeButton action={()=>save(mode,{})} confirmText="Delete this synthetic record?" label={mode==='note'?'Delete note':'Delete notice'}/>}
</section></>);
`));
const alias={'@/lib/unsaved-work':'unsaved','../actions':'actions','./actions':'actions','@/lib/use-draft-navigation-guard':'guard','@/lib/use-recoverable-action':'recover','./unsaved-work':'unsaved','@/lib/use-soft-refresh':'refresh','next/navigation':'router','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Campaign and delete recovery fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://synthetic.test data:");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic campaign and delete recovery</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
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




await reset('campaign');assert.equal(await value('#segment_id'),'insider');assert.equal(await guard(),false);await page.$eval('details',e=>e.open=true);await edit('#brief','Synthetic holiday brief');await edit('input[name="name"]','Backup draft');await click('#campaign','Draft with Helm →',true);await waitCalls(1);
assert.deepEqual((await calls())[0],{kind:'brief',args:{brief:'Synthetic holiday brief',tone:'editorial',segment_id:'insider'}});assert.equal(await page.$$eval('#campaign input,#campaign textarea,#campaign select,#campaign button',es=>es.every(e=>e.disabled)),true);await submit('#campaign details',true);assert.equal((await calls()).length,1);pass('AI creation captures exact defaults once and freezes both forms against competing submissions');
await leave();assert.equal(await nav(),0);assert.equal(await guard(),true);pass('pending creation blocks ordinary navigation and registers reload protection');
await finish(0,null,true);await waitText('Could not confirm draft creation');await ready('#brief');assert.equal(await value('#brief'),'Synthetic holiday brief');assert.equal(await value('input[name="name"]'),'Backup draft');assert.equal(await page.$eval('a[target="_blank"]',e=>e.getAttribute('href')),'/guests/campaigns');pass('lost response retains both drafts and offers a safe check before retry');
await leave();assert.equal(await nav(),0);assert.equal(await guard(),true);pass('failed draft remains protected against accidental navigation');
await page.click('input[value="warm"]');await edit('#segment_id','other');await click('#campaign','Draft with Helm →');await waitCalls(2);assert.deepEqual((await calls())[1].args,{brief:'Synthetic holiday brief',tone:'warm',segment_id:'other'});await finish(1,null,true);await ready('#brief');assert.equal(await value('#segment_id'),'other');assert.equal(await page.$eval('input[value="warm"]',e=>e.checked),true);pass('AI retry uses and retains the selected tone and segment');
await click('#campaign','Blank draft',true);await waitCalls(3);assert.deepEqual((await calls())[2],{kind:'blank',args:{name:'Backup draft'}});await submit('#campaign',true);assert.equal((await calls()).length,3);await waitText('Creating draft…');pass('blank draft has pending feedback and prevents repeated or competing AI requests');
await finish(2,null,true);await ready('input[name="name"]');assert.equal(await value('input[name="name"]'),'Backup draft');await click('#campaign','Blank draft');await waitCalls(4);assert.equal((await calls())[3].args.name,'Backup draft');await finish(3,null,true);await ready('#brief');pass('blank draft failure preserves its name and enables an explicit retry');
await reset('campaign');await edit('#segment_id','other');assert.equal(await guard(),true);await edit('#segment_id','insider');await clean();await page.click('input[value="warm"]');assert.equal(await guard(),true);pass('segment-only and tone-only edits register unsaved work');
await reset('campaign');await page.$eval('details',e=>e.open=true);await click('#campaign','Blank draft');await click('#campaign','Draft with Helm →');assert.equal((await calls()).length,0);pass('native required-field validation prevents empty drafts');

for(const mode of ['playbook','notice','note']){
 await reset(mode);const label=mode==='playbook'?'Delete':mode==='note'?'Delete note':'Delete notice';
 await click('#'+mode,label);assert.equal((await calls()).length,0);assert.equal(await page.evaluate(()=>window.confirms.length),1);pass(mode+': canceled confirmation never deletes');
 await page.evaluate(()=>window.confirmAnswer=true);await submit('#'+mode,true);await waitCalls(1);assert.equal(await page.evaluate(()=>window.confirms.length),2);assert.equal(await page.$eval('#'+mode+' button',e=>e.disabled),true);assert.equal((await calls())[0].kind,mode);if(mode==='playbook')assert.deepEqual((await calls())[0].args,{id:'synthetic-entry'});pass(mode+': synchronous guard allows one confirmed deletion and shows pending');
 await finish(0,null,true);await waitText('Could not confirm deletion');await ready('#'+mode+' button');assert.equal(await page.$$eval('[role="alert"]',es=>es.length),1);await submit('#'+mode);await waitCalls(2);assert.equal(await page.evaluate(()=>window.confirms.length),3);await finish(1);await ready('#'+mode+' button');assert.equal(await page.$$eval('[role="alert"]',es=>es.length),0);pass(mode+': failure is inline and retry confirms again before clearing the error');
}
await reset('inspection');await click('#inspection','Delete');await click('#inspection','Cancel');assert.equal((await calls()).length,0);await click('#inspection','Delete');await click('#inspection','Confirm',true);await waitCalls(1);assert.deepEqual((await calls())[0],{kind:'inspection',args:{id:'synthetic-inspection'}});assert.equal(await page.$$eval('#inspection button',es=>es.every(e=>e.disabled)),true);pass('inspection inline confirmation and pending lock are preserved');
await finish(0,{ok:false,error:'This inspection is part of a Field packet.'});await waitText('This inspection is part of a Field packet.');assert.equal(await page.evaluate(()=>window.refreshes),0);await click('#inspection','Retry delete');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm deletion');assert.equal(await page.evaluate(()=>window.refreshes),0);pass('inspection returned and thrown errors remain visible without a success refresh');
await click('#inspection','Retry delete',true);await waitCalls(3);await finish(2,{ok:true});await page.waitForFunction(()=>window.refreshes===1);assert.equal(await page.$$eval('[role="alert"]',es=>es.length),0);pass('inspection retry refreshes only after confirmed success');
assert.deepEqual(errors,[]);console.log('Campaign/delete recovery: '+checks+' checks passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
