/**
 * The one approval card, driven in a real browser: the real queue components
 * with synthetic cards, every server action replaced by a recorder, and every
 * remote request blocked. Proves each verb calls what it says, Also on
 * approve gates a slip with no property, an open edit is saved before it
 * sends, Mark handled leaves an Undo, and the card fits a phone.
 *
 * Run: node scripts/approval-card-smoke.mjs   (--compile-only to just bundle)
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-approval-card-'));

// TypeScript straight from src, through a loader that only strips types.
await writeFile(join(scratch,'ts-loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});
module.exports=function(src){return ts.transpileModule(src,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
// Every server action becomes a recorder the test resolves by hand.
await writeFile(join(scratch,'actions.js'),`
const rec=kind=>(...args)=>new Promise(resolve=>window.calls.push({kind,args,resolve}));
export const approveContractorDraft=rec('approve'),markContractorHandled=rec('handled'),undoContractorDecision=rec('undo'),
coachContractorDraft=rec('coach'),editContractorDraft=rec('edit'),redraftContractorDraft=rec('redraft'),
scheduleContractorDraft=rec('schedule'),cancelContractorSchedule=rec('cancel');
export const approveCleanerDraft=rec('approve'),markCleanerHandled=rec('handled'),undoCleanerDecision=rec('undo'),
coachCleanerDraft=rec('coach'),editCleanerDraft=rec('edit'),redraftCleanerDraft=rec('redraft'),
scheduleCleanerDraft=rec('schedule'),cancelCleanerSchedule=rec('cancel');`);
await writeFile(join(scratch,'navigation.js'),`export const useRouter=()=>({refresh(){window.refreshes=(window.refreshes||0)+1;}});`);
await writeFile(join(scratch,'link.js'),`import React from 'react';export default function Link({href,children,...p}){return React.createElement('a',{href,...p},children);}`);
await writeFile(join(scratch,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ContractorMessagingQueue} from '@/app/contractor-messaging/ContractorMessagingQueue';
import {CleanerMessagingQueue} from '@/app/cleaner-messaging/CleanerMessagingQueue';
const mode=new URLSearchParams(location.search).get('mode')||'contractor';
window.calls=[];
const now=new Date().toISOString();
const base={short_id:'syn',channel:'sms_quo',contractor_contact:'+15550100',external_thread_id:'',external_message_id:'',final_response:'',created_at:now,resolved_at:null,send_at:'',outcomes:{work:[],notes:[],error:''}};
const cards=[
 {...base,id:'slip-card',contractor_name:'Sam Field',property_id:'',property_name:'',contractor_text:'Done at the cottage. The dryer vent is loose.',draft:'Thanks Sam, I will get the vent on a slip.',topic:'report',status:'pending',age_minutes:12,proposed_slip:{title:'Dryer vent loose',category:'maintenance',priority:'normal',note:'Vent hood came off the wall.'}},
 {...base,id:'plain-card',contractor_name:'Lee Trade',property_id:'',property_name:'',contractor_text:'Can I come at 9 tomorrow?',draft:'9 works, thank you.',topic:'schedule',status:'pending',age_minutes:300,proposed_slip:null},
 {...base,id:'queued-card',contractor_name:'Pat Paint',property_id:'',property_name:'',contractor_text:'Paint is dry.',draft:'Great, thanks Pat.',topic:'report',status:'scheduled',send_at:new Date(Date.now()+3600e3).toISOString(),age_minutes:40,proposed_slip:null},
];
const cleanerCards=[
 {...base,id:'pt-card',cleaner_name:'Rosa Synthetic',cleaner_contact:'+15550101',property_id:'home-a',property_name:'Synthetic Cottage',cleaner_text:'Acabei a casa, faltam toalhas.',cleaner_text_english:'I finished the house, towels are missing.',inbound_language:'pt',draft:'Obrigada Rosa! Vou levar toalhas amanhã.',draft_english:'Thank you Rosa! I will bring towels tomorrow.',topic:'done',status:'pending',age_minutes:5,proposed_slip:null},
];
window.queue=mode==='cleaner'?cleanerCards:cards;
window.fetch=async url=>new Response(JSON.stringify(String(url).includes('/api/messaging/queue')?{approvals:window.queue,context:{}}:{}),{headers:{'Content-Type':'application/json'}});
const homes=[{id:'home-a',name:'Synthetic Cottage'},{id:'home-b',name:'Synthetic Barn'}];
createRoot(document.getElementById('root')).render(<main id={mode}>{mode==='cleaner'?<CleanerMessagingQueue initialPending={cleanerCards} properties={homes}/>:<ContractorMessagingQueue initialPending={cards} properties={homes} context={{}}/>}</main>);
`);
const alias={'@':join(root,'src'),'./actions':join(scratch,'actions.js'),'next/navigation':join(scratch,'navigation.js'),'next/link':join(scratch,'link.js')};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.tsx'),output:{path:scratch,filename:'bundle.js'},
 resolve:{extensions:['.tsx','.ts','.js'],modules:[join(root,'node_modules')],alias},
 module:{rules:[{test:/\.tsx?$/,use:join(scratch,'ts-loader.cjs')}]},performance:{hints:false}});
 compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Approval card fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}

const css=`*{box-sizing:border-box}body{margin:0;background:#f5f0e4;color:#102b46;font:14px Arial,sans-serif;--paper:#f5f0e4;--paper-2:#efe6cf;--paper-3:#e9dfc4;--ink:#102b46;--ink-1:#102b46;--ink-2:#214263;--ink-3:#59718a;--ink-4:#788ca0;--rule:#d9cda9;--rule-soft:#e3dac4;--signal:#a44e40}.eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase}.font-serif{font-family:Georgia,serif}main{max-width:1100px;margin:20px auto}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}`

 // The real stylesheet: the browser skips the Tailwind at-rules it does not know.
 + (await readFile(join(root,'src/app/globals.css'),'utf8'));
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approval card, synthetic</title><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,checks=0;
const pass=m=>{checks++;console.log('PASS '+m);};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
 const page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);await page.waitForSelector('#approval-slip-card');
 const card=id=>'#approval-'+id;
 const text=sel=>page.$eval(sel,e=>e.textContent.replace(/\s+/g,' '));
 const click=(sel,label)=>page.$$eval(sel+' button',(bs,label)=>{const b=bs.filter(b=>b.checkVisibility()).find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();},label);
 const enabled=(sel,label)=>page.$$eval(sel+' button',(bs,label)=>{const b=bs.find(b=>b.textContent.trim()===label);return !!b&&!b.disabled;},label);
 const calls=()=>page.evaluate(()=>window.calls.map(c=>({kind:c.kind,args:c.args})));
 const finish=(i,result={ok:true})=>page.evaluate((i,result)=>window.calls[i].resolve(result),i,result);
 const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
 const type=(sel,value)=>page.$eval(sel,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);

 assert.match(await text('#needs-review h2'),/Needs review \(2\)/);
 for(const verb of ['Approve & send','Edit','Coach the AI','Redraft','Mark handled'])assert.ok((await text(card('plain-card'))).includes(verb),verb);
 pass('every verb on the card: Approve & send, Edit, Coach the AI, Redraft, Mark handled');

 const slipText=await text(card('slip-card'));
 assert.match(slipText,/Also on approve/);assert.match(slipText,/Files work slip “Dryer vent loose”/);assert.match(slipText,/Select property/);
 assert.match(slipText,/Pick a property for the work slip, or untick it\./);assert.equal(await enabled(card('slip-card'),'Approve & send'),false);
 pass('a slip with no property opens its line and blocks approve');
 await page.select(card('slip-card')+' select','home-b');
 assert.match(await text(card('slip-card')),/Files work slip “Dryer vent loose” at Synthetic Barn/);
 await click(card('slip-card'),'Approve & send');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'approve',args:['slip-card',{fileSlip:true,slipPropertyId:'home-b'}]});
 await finish(0);pass('picking a home names it on the line and approve carries the choice');

 await click(card('plain-card'),'Edit');await page.waitForSelector(card('plain-card')+' textarea');
 assert.match(await text(card('plain-card')),/Edit changes this reply only\.\s*Coach rewrites it and teaches the AI\./);
 await type(card('plain-card')+' textarea','9 works. The side door is open.');
 assert.ok((await text(card('plain-card'))).includes('Save & send'));
 await click(card('plain-card'),'Save & send');await waitCalls(2);
 assert.deepEqual((await calls())[1],{kind:'edit',args:['plain-card','9 works. The side door is open.']});
 await finish(1);await waitCalls(3);assert.deepEqual((await calls())[2],{kind:'approve',args:['plain-card',null]});
 await finish(2,{ok:false,error:'Quo refused the number'});await page.waitForFunction(()=>document.body.innerText.includes('Quo refused the number'));
 assert.match(await text(card('plain-card')),/9 works\. The side door is open\./);
 pass('an open, changed edit is saved and then sent; a failed send keeps the saved words and says why');

 await click(card('plain-card'),'Mark handled');await page.waitForSelector(card('plain-card')+' [aria-label="Mark handled"]');
 for(const r of ['Already answered','They said thanks','Not worth a reply'])assert.ok((await text(card('plain-card'))).includes(r),r);
 await click(card('plain-card'),'Already answered');await waitCalls(4);
 assert.deepEqual((await calls())[3],{kind:'handled',args:['plain-card',{reason:'Already answered'}]});
 await page.evaluate(()=>{window.queue=window.queue.filter(c=>c.id!=='plain-card');});
 await finish(3);await page.waitForSelector('.rt-undo-toast');
 assert.match(await text('.rt-undo-toast'),/Handled · Lee Trade/);
 await page.$$eval('.rt-undo-toast button',bs=>bs.find(b=>b.textContent==='Undo').click());await waitCalls(5);
 assert.deepEqual((await calls())[4],{kind:'undo',args:['plain-card']});await finish(4);
 await page.waitForFunction(()=>document.body.innerText.includes('Back in the queue.'));
 pass('Mark handled is a reason in one tap, then a toast whose Undo calls the audience undo');

 await click(card('queued-card'),'Show ▾');await page.waitForFunction(()=>document.body.textContent.includes('Cancel send to edit or coach'));
 assert.ok((await text(card('queued-card'))).includes('Send now'));pass('a queued card folds to a row and opens to Send now / Cancel send');

 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-desktop.png'),fullPage:true});

 // Cleaners: Portuguese with the English under each side, Edit on the Portuguese.
 await page.evaluate(()=>{window.calls=[];});await page.goto(origin+'/?mode=cleaner');await page.waitForSelector(card('pt-card'));
 const pt=await text(card('pt-card'));
 assert.match(pt,/Proposed reply \(Portuguese\)/);assert.match(pt,/English ?I finished the house, towels are missing\./);assert.match(pt,/English ?Thank you Rosa! I will bring towels tomorrow\./);
 await click(card('pt-card'),'Edit');await page.waitForSelector(card('pt-card')+' textarea');
 assert.match(await text(card('pt-card')),/English, as drafted/);
 await type(card('pt-card')+' textarea','Obrigada Rosa! Levo toalhas hoje.');await click(card('pt-card'),'Save');await waitCalls(1);
 assert.deepEqual((await calls())[0],{kind:'edit',args:['pt-card','Obrigada Rosa! Levo toalhas hoje.']});await finish(0);
 await page.waitForFunction(()=>document.body.textContent.includes('Levo toalhas hoje.'));
 assert.ok(!(await text(card('pt-card'))).includes('I will bring towels tomorrow'),'the English for the old draft is not shown beside the edited words');
 await click(card('pt-card'),'Coach the AI');assert.match(await text(card('pt-card')),/Write the note in English if you like; the reply comes back in Portuguese\./);
 pass('cleaners: English under both sides, Edit on the Portuguese, the language note printed in the coach drawer');
 await page.goto(origin+'/?mode=contractor');await page.waitForSelector('#approval-slip-card');
 await page.setViewport({width:390,height:844});await page.reload();await page.waitForSelector('.rt-inbox-review-toggle');
 await page.$$eval('.rt-inbox-review-toggle',bs=>bs[0].click());
 await page.screenshot({path:join(process.env.SMOKE_SHOTS||tmpdir(),'approval-card-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('fits a phone with no sideways scroll');
 assert.deepEqual(errors,[]);console.log(checks+' checks passed');
}finally{await browser?.close();server.close();await rm(scratch,{recursive:true,force:true});}
