/** Inspection layout and inline field photos; synthetic records and controlled I/O only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-layout-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;

for(const [name,path] of [
 ['confirmed-save','src/lib/confirmed-save.ts'],
 ['form-draft','src/components/FieldFormDraft.tsx'],['form-store','src/lib/field-form-drafts.ts'],
 ['layout','src/app/properties/[id]/layout/LayoutEditor.tsx'],['stop','src/app/field/packet/[packetId]/StopWorkList.tsx'],['StopSlipEditor','src/app/field/packet/[packetId]/StopSlipEditor.tsx'],['photos','src/components/PhotoUploader.tsx'],
 ['recover','src/lib/use-recoverable-action.ts'],['saves','src/lib/use-checklist-saves.ts'],['queue','src/lib/checklist-save-queue.ts'],['unsaved','src/lib/unsaved-work.ts'],['guard','src/lib/use-draft-navigation-guard.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const saveLayout=(propertyId,itemIds)=>save('layout',{propertyId,itemIds});
export const createCustomItem=input=>save('custom',input);
export const updateSlipFromStop=input=>save('edit',input);
export const checkFieldTaskCompletion=async()=>{window.checks=(window.checks||0)+1;return {ok:!!window.taskConfirmed};};
export const resolveSlipFromStop=input=>save('complete',input);
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'compress.js'),`export const compressImage=async file=>file;`);
await writeFile(join(scratch,'entry.js'),compile(`
import React from 'react';import {createRoot} from 'react-dom/client';import {LayoutEditor} from './layout';import {StopWorkList} from './stop';import {hasUnsavedWork} from './unsaved';import {save} from './actions';
window.calls=[];window.guarded=hasUnsavedWork;window.confirmAnswer=false;window.confirms=0;window.confirm=()=>{window.confirms++;return window.confirmAnswer;};
window.fetch=async(url,options)=>{const result=await save('upload',{url,file:options.body.get('file').name});return {ok:result.ok,status:result.ok?200:500,json:async()=>result};};
const card=(id,title)=>({itemId:id,title,description:null,category:'Room',isCustom:false});
const item=(slipId,title)=>({slipId,title,description:'Original details',thumbs:['https://synthetic.test/old.jpg'],kind:'task',group:'stop',priority:'normal',done:false,flags:[],opened:'Synthetic item',categoryLabel:'Maintenance',sub:null,bring:null,note:null});
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')).render(<main id={mode}>{mode==='layout'?<LayoutEditor propertyId="home-a" initialDeck={[card('a','Alpha'),card('b','Bravo'),card('c','Charlie')]} initialAddable={[card('d','Delta')]} isCustomized/>:<StopWorkList packetId="packet-a" stopId="stop-a" items={[item('slip-a','Cupboard'),item('slip-b','Lounge chair')]} readOnly={mode==='readonly'}/>}</main>);
`));
const alias={'@/lib/confirmed-save':'confirmed-save','@/components/FieldFormDraft':'form-draft','@/lib/field-form-drafts':'form-store','./actions':'actions','../../actions':'actions','@/components/PhotoUploader':'photos','@/lib/image-compress':'compress','@/lib/use-recoverable-action':'recover','./use-recoverable-action':'recover','@/lib/use-checklist-saves':'saves','./checklist-save-queue':'queue','@/lib/unsaved-work':'unsaved','./unsaved-work':'unsaved','@/lib/use-draft-navigation-guard':'guard','./use-draft-navigation-guard':'guard','next/navigation':'router'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Layout and photos fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' https://synthetic.test data:");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic layout and photos</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
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


await reset('layout');
const order=()=>page.$$eval('.rt-card',cards=>cards.map(c=>c.querySelector('[aria-label^="Remove "]').getAttribute('aria-label').slice(7)));
await click('.rt-card:nth-child(1)','Move down');await waitCalls(1);
await click('.rt-card:nth-child(3)','Move up');assert.equal((await calls()).length,1);assert.deepEqual(await order(),['Bravo','Charlie','Alpha']);assert.equal(await guard(),true);
await finish(0,{ok:false,error:'Old write failed'});await waitCalls(2);assert.deepEqual((await calls())[1].args.itemIds,['b','c','a']);await finish(1);await clean();pass('rapid reorders serialize and an older failure cannot discard the latest order');
await click('.rt-card:nth-child(1)','Remove Bravo');await waitCalls(3);await finish(2,null,true);await waitText('Synthetic lost response');assert.deepEqual(await order(),['Charlie','Alpha']);assert.equal(await guard(),true);await click('#layout','Retry saving',true);await waitCalls(4);await finish(3);await clean();pass('failed layout writes retain the desired deck and explicit retry clears the guard');
await page.evaluate(()=>{window.dragGrip=document.querySelector('.rt-grip');window.dragData=new DataTransfer();window.dragGrip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.dragData}));});
await page.$eval('.rt-card:nth-child(2)',e=>e.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.dragData})));assert.deepEqual(await order(),['Alpha','Charlie']);
await page.evaluate(()=>window.dragGrip.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window.dragData})));assert.deepEqual(await order(),['Charlie','Alpha']);assert.equal((await calls()).length,4);await clean();pass('cancelled drag restores original order without a write');
await page.evaluate(()=>{window.dragGrip=document.querySelector('.rt-grip');window.dragData=new DataTransfer();window.dragGrip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.dragData}));});
await page.$eval('.rt-card:nth-child(2)',e=>e.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.dragData})));
await page.$eval('.rt-card',e=>e.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:window.dragData})));await page.evaluate(()=>window.dragGrip.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window.dragData})));await waitCalls(5);assert.deepEqual((await calls())[4].args.itemIds,['a','c']);await finish(4);await clean();pass('successful drag saves exactly once');
await click('#layout','+ Add a card');const title='#layout input',desc='#layout textarea';await edit(title,'Custom inspection');await edit(desc,'Keep this precise wording');await click('#layout','Close');await click('#layout','+ Add a card');assert.equal(await value(title),'Custom inspection');assert.equal(await guard(),true);pass('custom draft survives hiding the add panel and guards navigation');
await click('.rt-card:nth-child(1)','Move down');await waitCalls(6);await click('#layout','Add card',true);assert.equal((await calls()).length,6);assert.equal(await page.$eval(title,e=>e.disabled),true);
await finish(5);await waitCalls(7);const custom=(await calls())[6].args;assert.deepEqual(custom.itemIds,['c','a']);assert.equal(await page.$eval('.rt-card button',e=>e.disabled),true);await finish(6,null,true);await waitText('Could not confirm the card save');assert.equal(await value(title),'Custom inspection');assert.equal(await value(desc),'Keep this precise wording');pass('custom creation waits for pending order and blocks conflicting edits; interrupted wording survives');
await click('#layout','Add card');await waitCalls(8);assert.equal((await calls())[7].args.requestId,custom.requestId);await finish(7,{ok:false,error:'Attach failed'});await waitText('Attach failed');await click('#layout','Add card');await waitCalls(9);assert.equal((await calls())[8].args.requestId,custom.requestId);await finish(8,{ok:true,data:{id:custom.requestId,title:custom.title,description:custom.description,category:'Custom'}});await clean();assert.deepEqual(await order(),['Charlie','Alpha','Custom inspection']);assert.equal(await value(title),'');pass('custom retries reuse one identity and confirmed creation appends exactly once');
await click('#layout','+ Delta',true);await waitCalls(10);assert.equal((await calls())[9].args.itemIds.filter(id=>id==='d').length,1);await finish(9);await clean();pass('double-clicking standard add cannot duplicate a card');
await edit(title,'Retained failed order');await click('.rt-card:nth-child(1)','Move down');await waitCalls(11);await finish(10,{ok:false,error:'Order unavailable'});await waitText('Order unavailable');await click('#layout','Add card');await waitText('Retry the unsaved checklist changes');assert.equal((await calls()).length,11);assert.equal(await value(title),'Retained failed order');pass('custom creation refuses to overwrite an unsaved failed layout');

await reset('photos');await page.setViewport({width:390,height:844});
await click('#photos','Details for Cupboard');await click('#photos','Edit');
const slipTitle='input[aria-label="Slip title"]',slipDetails='textarea[aria-label="Slip details"]';
await edit(slipTitle,'Cupboard hinge needs repair');await edit(slipDetails,'The top hinge sticks.');await click('#photos','Photos (1)');assert.equal(await page.$eval(slipTitle,e=>e.value),'Cupboard hinge needs repair');assert.equal((await text()).includes('Saving keeps this slip open.'),true);pass('mobile inline edit has a Photos tab and switching tabs preserves text');
const upload=async()=>page.$eval('input[type="file"]',e=>{const d=new DataTransfer();d.items.add(new File(['synthetic'],'hinge.jpg',{type:'image/jpeg'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));});
await upload();await waitCalls(1);assert.equal((await calls())[0].args.url,'/api/field/upload');await click('#photos','Cancel');await click('#photos','Details for Lounge chair');assert.equal(await page.$eval(slipTitle,e=>e.value),'Cupboard hinge needs repair');assert.equal(await guard(),true);assert.equal((await calls()).length,1);pass('upload uses contractor authentication and blocks abandoning the slip mid-upload');
await click('#photos','Details');await click('#photos','Photos (1)');await finish(0,{ok:false,error:'Synthetic upload failure'});await waitText('Retry or remove failed uploads');assert.equal(await page.$$eval('button',bs=>bs.find(b=>b.textContent.trim()==='Save').disabled),true);
await click('#photos','Retry');await waitCalls(2);await finish(1,{ok:true,url:'https://synthetic.test/new.jpg'});await waitText('Photos (2)');pass('failed selected files stay retryable across tabs and cannot silently disappear on save');
await click('#photos','Details');assert.equal(await value(slipDetails),'The top hinge sticks.');await click('#photos','Save',true);await waitCalls(3);assert.deepEqual((await calls())[2].args.photoUrls,['https://synthetic.test/new.jpg']);assert.equal(await page.$eval(slipTitle,e=>e.disabled),true);await finish(2,null,true);await waitText('Could not confirm the save');assert.equal(await value(slipTitle),'Cupboard hinge needs repair');await click('#photos','Photos (2)');assert.equal(await page.$$eval('img',els=>els.some(e=>e.src==='https://synthetic.test/new.jpg')),true);pass('interrupted save retains text and uploaded photos and prevents duplicate submissions');
await click('#photos','Save');await waitCalls(4);await finish(3,{ok:false,error:'Refused'});await waitText('Could not save this slip');await click('#photos','Save');await waitCalls(5);await finish(4,{ok:true,photoUrls:['https://synthetic.test/old.jpg','https://synthetic.test/new.jpg']});await clean();await waitText('Cupboard hinge needs repair');assert.equal((await calls()).some(c=>c.kind==='complete'),false);assert.equal(await page.$$eval('img',els=>els.some(e=>e.src==='https://synthetic.test/old.jpg')&&els.some(e=>e.src==='https://synthetic.test/new.jpg')),true);pass('confirmed save shows both old and new photos without completing the slip');
await click('#photos','Edit');await click('#photos','Photos (2)');await click('#photos','Details');await edit(slipDetails,'Unsaved followup');await click('#photos','Cancel');assert.equal(await value(slipDetails),'Unsaved followup');await page.evaluate(()=>window.confirmAnswer=true);await click('#photos','Cancel');await clean();pass('discard requires explicit confirmation while saved photos remain available on reopen');
await reset('readonly');await click('#readonly','Details for Cupboard');assert.equal(await page.$$eval('button',bs=>bs.some(b=>b.textContent.trim()==='Edit')),false);assert.equal((await calls()).length,0);pass('read-only packet cannot edit or attach photos');
await reset('photos');
await click('#photos','Mark Cupboard done',true);await waitCalls(1);
assert.equal(await page.$$eval('button',bs=>bs.some(b=>b.getAttribute('aria-label')==='Done')),false);
await finish(0,null,true);await waitText('Could not confirm the save.');
assert.equal((await calls()).length,1);
await page.evaluate(()=>{window.taskConfirmed=true;});await click('#photos','Check / retry save');
await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Done'));
assert.equal((await calls()).length,1);pass('quick completion waits for confirmation, blocks double taps and checks the original save before retrying');
assert.deepEqual(errors,[]);console.log('PASS '+checks+' layout and photos browser checks; synthetic data only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
