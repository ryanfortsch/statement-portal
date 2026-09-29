/** Guest material forms, checklist queues, and owner request recovery; synthetic records and controlled I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-guest-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [
 ['note','src/components/properties/NoteEditorForm.tsx'],['notice','src/components/properties/NoticeEditorForm.tsx'],['guide','src/components/properties/HomeGuideCustomizeForm.tsx'],
 ['form','src/components/properties/RetainedPropertyForm.tsx'],['readiness','src/components/projections/ReadinessChecklistClient.tsx'],['order','src/app/properties/[id]/order-checklist/OrderChecklistClient.tsx'],
 ['owner','src/components/OwnerRequestsPanel.tsx'],['recover','src/lib/use-recoverable-action.ts'],['unsaved','src/lib/unsaved-work.ts'],['guard','src/lib/use-draft-navigation-guard.ts'],
 ['queue','src/lib/checklist-save-queue.ts'],['saves','src/lib/use-checklist-saves.ts'],['status','src/components/ChecklistSaveStatus.tsx'],['readiness-catalog','src/lib/projections-readiness.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
// Extract the real guide catalog without bringing server database imports into the fixture.
const catalogSource=ts.createSourceFile('properties.ts',await readFile(join(root,'src/lib/properties.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const catalog=ts.createPrinter().printList(ts.ListFormat.MultiLine,ts.factory.createNodeArray(catalogSource.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['HOME_GUIDE_CATALOG','HOME_GUIDE_CATALOG_KEYS'].includes(d.name.getText(catalogSource))))),catalogSource);
await writeFile(join(scratch,'properties.js'),compile(catalog));
await writeFile(join(scratch,'order-catalog.js'),"export const LINEN_VENDOR='Synthetic vendor';");
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const updateHomeGuideOverrides=(id,data)=>save('guide',{id,fields:[...data.entries()]});
export const setReadinessHave=(id,label,count)=>save('have',{id,label,count});
export const setReadinessNote=(id,key,value)=>save('note',{id,key,value});
export const requestReadinessReview=id=>save('send',{id});
export const setOrderHaveAction=args=>save('have',args);
export const setOrderNoteAction=args=>save('note',args);
export const addOwnerRequestSlipAction=args=>save('owner',args);
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({children,...props}){return <a {...props} onClick={e=>{props.onClick?.(e);if(!e.defaultPrevented){window.navs++;e.preventDefault();}}}>{children}</a>;}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Link from './link.js';
import {NoteEditorForm} from './note.js';import {NoticeEditorForm} from './notice.js';import {HomeGuideCustomizeForm} from './guide.js';import {ReadinessChecklistClient} from './readiness.js';import {OrderChecklistClient} from './order.js';import {OwnerRequestsPanel} from './owner.js';import {hasUnsavedWork} from './unsaved.js';import {save} from './actions.js';
window.calls=[];window.navs=0;window.reloads=0;window.prints=0;window.print=()=>window.prints++;window.guarded=hasUnsavedWork;window.confirmAnswer=false;window.confirm=()=>window.confirmAnswer;
const groups=[{title:'Kitchen',items:[{label:'Cups',count:4},{label:'Plates',count:6}]}],initial={have:{Cups:1},notes:{supply_closet:'Old closet',order_notes:'Old order'}};
function Fixture(){const mode=new URLSearchParams(location.search).get('mode');const [mounted,setMounted]=useState(true);window.unmount=()=>setMounted(false);if(!mounted)return null;return <><Link href="/away">Leave page</Link><section id={mode}>
{mode==='note'&&<NoteEditorForm propertyId="home-a" initial={{title:'Old title',body:'Old body',tag:'old'}} submitLabel="Save note" action={data=>save('form',{fields:[...data.entries()]})}/>}
{mode==='notice'&&<NoticeEditorForm propertyId="home-a" initial={{title:'Old title',body:'Old body',eyebrow:'Old kicker'}} submitLabel="Save notice" action={data=>save('form',{fields:[...data.entries()]})}/>}
{mode==='guide'&&<HomeGuideCustomizeForm propertyId="home-a" overrides={{wifi:'Old guide copy'}}/>}
{mode==='readiness'&&<ReadinessChecklistClient projectionId="prospect-a" propertyTag="Synthetic home" salutation="Sample owner" propertyTypeLabel="home" groups={groups} context={{maxGuests:4,bedrooms:2,bathrooms:1,bathroomsFromIntake:true}} initial={initial} printHref="/print"/>}
{mode==='order'&&<OrderChecklistClient propertyId="home-a" propertyName="Synthetic home" groups={groups} context={{maxGuests:4,bedrooms:2,bathrooms:1,beds:[],bedCount:2,bedsFromRooms:true,guestsFromBeds:true,bathroomsFromRecord:true}} initial={initial} supplyClosetLocation="Hall"/>}
{mode==='owner'&&<OwnerRequestsPanel houses={[{propertyId:'home-a',name:'Synthetic home'}]} candidates={{'home-a':{candidates:[]}}} selections={{}} includeHandled={{}} maintenanceCharge={{}} loading={false} onSelectionsChange={()=>{}} onToggleHandled={()=>{}} onReloadHouse={()=>window.reloads++}/>}
</section></>;}createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'./actions':'actions','@/app/properties/actions':'actions','@/app/projections/actions':'actions','@/app/statements/actions':'actions','./RetainedPropertyForm':'form','@/lib/properties':'properties','@/lib/projections-readiness':'readiness-catalog','@/lib/order-checklist':'order-catalog','@/lib/use-recoverable-action':'recover','@/lib/unsaved-work':'unsaved','./unsaved-work':'unsaved','@/lib/use-draft-navigation-guard':'guard','./use-draft-navigation-guard':'guard','./checklist-save-queue':'queue','@/lib/use-checklist-saves':'saves','@/components/ChecklistSaveStatus':'status','next/link':'link','next/navigation':'router'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Guest materials fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic guest materials</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1100});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+mode);};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
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
const failureText='Could not confirm the save';
for(const mode of ['note','notice','guide']){
 await reset(mode);if(mode==='guide')await page.click('#guide summary');
 const selector=mode==='guide'?'[name="override_wifi"]':'[name="title"]';
 await edit('#'+mode+' '+selector,'Keep my exact draft');
 if(mode==='note')await page.click('#note [name="guest_facing"]');
 if(mode==='guide'){await edit('#guide [name="slot5_key"]','custom');await edit('#guide [name="slot5_custom_title"]','Beach path');await edit('#guide [name="slot5_body"]','Walk past the garden');}
 assert.equal(await guard(),true);await leave();assert.equal(await nav(),0);pass(mode+': unsaved draft blocks discarded navigation');
 await submit('#'+mode,true);await waitCalls(1);assert.equal(await page.$eval('#'+mode+' '+selector,e=>e.matches(':disabled')),true);await leave();assert.equal(await nav(),0);
 const first=(await calls())[0].args.fields;assert.match(new Map(first).get('submission_id'),/^[0-9a-f-]{36}$/);
 await finish(0,null,true);await waitText(failureText);assert.equal(await value('#'+mode+' '+selector),'Keep my exact draft');assert.equal(await guard(),true);
 if(mode==='note')assert.equal(await page.$eval('#note [name="guest_facing"]',e=>e.checked),true);
 if(mode==='guide'){assert.equal(await value('#guide [name="slot5_key"]'),'custom');assert.equal(await value('#guide [name="slot5_custom_title"]'),'Beach path');assert.equal(await value('#guide [name="slot5_body"]'),'Walk past the garden');}
 pass(mode+': failed response retains all native fields and unlocks without duplicate submission');
 await submit('#'+mode,true);await waitCalls(2);assert.deepEqual((await calls())[1].args.fields,first);await finish(1,undefined);await clean();await waitText('Saved.');pass(mode+': successful retry uses the same identity and releases the draft guard');
}
for(const mode of ['readiness','order']){
 await reset(mode);const qty='#'+mode+' input[type="number"]';
 await edit(qty,'2');await waitCalls(1);await edit(qty,'3');await edit(qty,'4');
 await click('#'+mode,'Plates, 0 of 6, tap to toggle');assert.equal((await calls()).length,1);await finish(0,null,true);await waitCalls(2);
 const count=mode==='readiness'?(await calls())[1].args.count:(await calls())[1].args.count;assert.equal(count,4);assert.equal(await value(qty),'4');await finish(1,{ok:true});await waitCalls(3);await finish(2,{ok:true});await clean();
 pass(mode+': rapid counts coalesce, serialize across rows, and an older failure cannot revert a newer count');
 await edit(qty,'2');await waitCalls(4);await finish(3,mode==='order'?{ok:false,error:'Synthetic rejection'}:null,mode==='readiness');await waitText('Some changes could not be saved');assert.equal(await value(qty),'2');assert.equal(await guard(),true);await leave();assert.equal(await nav(),0);
 await click('#'+mode,'Retry saving',true);await waitCalls(5);await finish(4,{ok:true});await clean();pass(mode+': failed count stays visible with an explicit successful retry');
 const noteSel=mode==='readiness'?'#readiness textarea':'#order textarea';await edit(noteSel,'First draft');await edit(noteSel,'Latest note');assert.equal(await guard(),true);await blur(noteSel);await blur(noteSel);await waitCalls(6);assert.equal((await calls())[5].args.value,'Latest note');await finish(5,null,true);await waitText('Some changes could not be saved');assert.equal(await value(noteSel),'Latest note');assert.equal(await guard(),true);
 await click('#'+mode,'Retry saving');await waitCalls(7);await finish(6,{ok:true});await clean();pass(mode+': debounced note is guarded immediately, blur is deduplicated, and failed text survives retry');
 await edit(noteSel,'Waiting for debounce');await waitCalls(8);await finish(7,{ok:true});await clean();pass(mode+': paused typing autosaves without requiring blur');
 await edit(noteSel,'Draft before leaving');await page.evaluate(()=>window.confirmAnswer=true);await leave();assert.equal(await nav(),1);await page.evaluate(()=>window.unmount());await clean();pass(mode+': explicit discard permits leaving and unmount releases the guard');
}
await reset('readiness');await edit('#readiness textarea','Fresh team note');await click('#readiness','Send to team for review →',true);await waitCalls(1);assert.equal((await calls())[0].kind,'note');assert.equal(await page.$eval('#readiness textarea',e=>e.matches(':disabled')),true);assert.equal(await guard(),true);
await finish(0);await waitCalls(2);assert.equal((await calls())[1].kind,'send');await finish(1,{ok:true});await waitText('✓ Sent to team');await clean();await click('#readiness','✓ Sent to team');assert.equal((await calls()).length,2);pass('team send flushes debounced notes before sending and blocks repeat clicks during and after delivery');
await reset('readiness');await edit('#readiness textarea','Unconfirmed note');await click('#readiness','Send to team for review →');await waitCalls(1);await finish(0,null,true);await waitText('Save the remaining checklist changes before sending.');assert.equal((await calls()).length,1);assert.equal(await value('#readiness textarea'),'Unconfirmed note');await click('#readiness','Retry send to team');assert.equal((await calls()).length,1);await click('#readiness','Retry saving');await waitCalls(2);await finish(1);await clean();await click('#readiness','Retry send to team');await waitCalls(3);await finish(2,null,true);await waitText('Could not confirm delivery');assert.equal(await page.$eval('#readiness textarea',e=>e.matches(':disabled')),false);pass('failed checklist save prevents email; recovered saves allow sending, and a lost delivery response unlocks the screen');
await reset('readiness');await edit('#readiness textarea','Print draft');await page.$eval('#readiness .rt-rc-print',e=>e.click());await waitCalls(1);assert.equal(await nav(),0);await finish(0);await clean();await page.$eval('#readiness .rt-rc-print',e=>e.click());assert.equal(await nav(),1);pass('print view cannot open with an outdated saved checklist');
await reset('owner');await click('#owner','+ Add request');await edit('#owner input','Replace lamp');await edit('#owner textarea','Cord is damaged');await edit('#owner select','purchase');await click('#owner','Cancel');assert.ok(await page.$('#owner input'));await click('#owner','File request',true);await waitCalls(1);const ownerArgs=(await calls())[0].args;assert.match(ownerArgs.requestId,/^[0-9a-f-]{36}$/);assert.equal(await page.$eval('#owner input',e=>e.matches(':disabled')),true);await click('#owner','Cancel');assert.ok(await page.$('#owner input'));await finish(0,null,true);await waitText('Could not confirm the request');assert.equal(await value('#owner input'),'Replace lamp');assert.equal(await value('#owner textarea'),'Cord is damaged');assert.equal(await value('#owner select'),'purchase');pass('owner request blocks discard and duplicate filing while pending, then retains all fields on lost response');
await click('#owner','File request');await waitCalls(2);assert.deepEqual((await calls())[1].args,ownerArgs);await finish(1,{ok:false,error:'Synthetic refusal'});await waitText('Synthetic refusal');await click('#owner','File request');await waitCalls(3);assert.deepEqual((await calls())[2].args,ownerArgs);await finish(2,{ok:true,slipId:'synthetic-slip'});await clean();assert.equal(await page.evaluate(()=>window.reloads),1);assert.equal(await page.$('#owner input'),null);pass('owner request retries the same identity after returned errors and closes only on confirmed success');
await click('#owner','+ Add request');await edit('#owner input','Draft to discard');await page.evaluate(()=>window.confirmAnswer=true);await click('#owner','Cancel');await clean();assert.equal(await page.$('#owner input'),null);pass('owner request cancellation discards only after confirmation');
assert.deepEqual(errors,[]);console.log('PASS '+checks+' guest materials browser checks; no live records or messages used.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
