/** Real queue/CRM/composer components, synthetic records and controlled actions only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-queue-actions-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path,extra=''] of [
  ['queue','src/app/work/QueueClient.tsx','\nexport {WorkSlipRowItem,TaskRowItem};'],
  ['crm','src/app/crm/CrmListClient.tsx'],
  ['runs','src/app/work/RunsRail.tsx','\nexport {WorkOrderComposer,RunCard,VendorGroup};'],
  ['picker','src/components/TeamPicker.tsx'],['unsaved','src/lib/unsaved-work.ts'],
  ['work-types','src/lib/work-types.ts'],['supplies','src/lib/inspection-supplies.ts'],['quo-lines','src/lib/quo-lines.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')+extra));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const bulkUpdateWorkSlips=a=>save('bulkSlips',a),bulkUpdateTasks=a=>save('bulkTasks',a);
export const updateWorkSlipStatus=a=>save('doneSlip',a),updateTaskStatus=a=>save('doneTask',a);
export const attachUnknownToContact=a=>save('attach',a),dismissUnknownNumber=a=>save('dismissPhone',a);
export const acceptContactSuggestion=a=>save('accept',a),dismissContactSuggestion=a=>save('skip',a);
export const emailWorkOrder=a=>save('draft',a),markRunScheduled=a=>save('schedule',a);
export const createWorkSlip=a=>save('createSlip',a),createTask=a=>save('createTask',a),createContact=a=>save('createContact',a),addUnknownAsContact=a=>save('promote',a),planRunsNow=a=>save('plan',a),publishRun=a=>save('publish',a);
`);
await writeFile(join(scratch,'router.js'),`
export const useRouter=()=>({push:url=>window.navigations.push(url),replace:url=>window.history.replaceState(null,'',url),refresh:()=>window.refreshes++});
export const usePathname=()=>'/work',useSearchParams=()=>new URLSearchParams(location.search);
`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,prefetch,...props}){return <a {...props} href={href} onClick={e=>{e.preventDefault();window.navigations.push(href);}}>{children}</a>}`));
await writeFile(join(scratch,'empty.js'),'export const SyncGmailButton=()=>null,SyncQuoButton=()=>null,SyncQuoContactsButton=()=>null,PhotoUploader=()=>null;');
await writeFile(join(scratch,'team.js'),`export const TEAM_MEMBERS=[];export const getTeamMember=()=>null,displayNameForEmail=e=>e,initialsForEmail=e=>e?.slice(0,2)||'+';`);
await writeFile(join(scratch,'crm-types.js'),`export const CONTACT_TYPE_LABELS={owner:'Owner',lead:'Lead',vendor:'Vendor',other:'Other'};`);
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {QueueClient,WorkSlipRowItem,TaskRowItem} from './queue.js';import {CrmListClient} from './crm.js';
import {WorkOrderComposer,RunCard,VendorGroup} from './runs.js';import {hasUnsavedWork} from './unsaved.js';
const params=new URLSearchParams(location.search),mode=params.get('mode');
window.calls=[];window.navigations=[];window.refreshes=0;window.opened=[];window.closeCount=0;window.confirmations=[];window.confirmResult=false;window.guarded=hasUnsavedWork;
window.confirm=m=>{window.confirmations.push(m);return window.confirmResult;};window.open=url=>{window.opened.push(url);return null;};
const now='2026-09-01T12:00:00Z',me='me@example.test';
const properties=[{id:'synthetic-home',name:'Synthetic Home',city:'Gloucester',title:null,is_active:true}];
const slips=['a','b'].map(id=>({id:'slip-'+id,title:'Slip '+id,property_id:'synthetic-home',category:'maintenance',priority:'normal',status:'open',assigned_to_type:'unassigned',created_at:now}));
const tasks=['a','b'].map(id=>({id:'task-'+id,title:'Task '+id,priority:'medium',status:'open',scope:'corporate',created_at:now}));
const contacts=['a','b'].map(id=>({id:'contact-'+id,name:'Contact '+id,type:'owner',emails:[],phone:null,tags:[],linked_property_ids:[],created_at:now,updated_at:now}));
const unknownNumbers=['+19785550101','+19785550102'].map(phone=>({phone,last_body:'Synthetic message'}));
const suggestions=['a','b'].map(id=>({id:'suggestion-'+id,suggested_name:'Suggestion '+id,suggestion_type:'add_contact',reason:'Synthetic suggestion'}));
const initialRoster=[{email:'vendor@example.test',name:'Original Vendor',organization:'Original Company'}];
const initialRun={packetId:'packet-a',title:'Synthetic Run',status:'published',visitDate:'2026-10-01',slips,closedSlipCount:0};
function Fixture(){
 const [mounted,setMounted]=useState(true),[roster,setRoster]=useState(initialRoster),[slipIds,setSlipIds]=useState(['slip-a','slip-b']);
 window.changeRoster=()=>{setRoster([{...initialRoster[0],name:'Renamed Vendor',organization:'Changed Company'}]);setSlipIds(['different-slip']);};
 window.unmount=()=>setMounted(false);const close=()=>{window.closeCount++;setMounted(false);};if(!mounted)return null;
 return <>
 {mode==='queue'&&<section id="queue"><QueueClient workSlips={slips} snoozedSlips={[]} tasks={tasks} properties={properties} myEmail={me} slipCommentCounts={{}} taskCommentCounts={{}} reporterNames={{}}/></section>}
 {mode==='done'&&<section id="done"><section id="slip"><WorkSlipRowItem slip={slips[0]} selected={false} onToggleSelect={()=>{}} commentCount={0}/></section><section id="task"><TaskRowItem task={tasks[0]} selected={false} onToggleSelect={()=>{}} commentCount={0}/></section></section>}
 {mode==='crm'&&<section id="crm"><CrmListClient contacts={contacts} properties={properties} counts={{all:2,owner:2,vendor:0,lead:0,other:0}} lastTouchByContact={{}} unknownNumbers={unknownNumbers} guestByPhone={{}} suggestions={suggestions}/></section>}
 {mode==='composer'&&<section id="composer"><WorkOrderComposer slipIds={slipIds} visitDate={params.has('undated')?null:'2026-10-01'} roster={roster} contextLabel="Synthetic order" onClose={close}/></section>}
 {mode==='parents'&&<section id="parents"><section id="run"><RunCard run={initialRun} roster={roster}/></section><section id="vendor"><VendorGroup propertyName="Synthetic Home" slips={slips} roster={roster}/></section></section>}
 </>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'./actions':'actions','./runs-actions':'actions','@/lib/use-soft-refresh':'refresh','@/lib/unsaved-work':'unsaved','@/lib/team':'team','@/components/TeamPicker':'picker','@/components/PhotoUploader':'empty','@/lib/crm':'crm-types','@/lib/work-types':'work-types','@/lib/inspection-supplies':'supplies','@/lib/quo-lines':'quo-lines','./SyncGmailButton':'empty','./SyncQuoButton':'empty','./SyncQuoContactsButton':'empty','next/navigation':'router','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Queue actions fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic action recovery</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+mode);};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const value=s=>page.$eval(s,e=>e.value),body=()=>page.$eval('body',e=>e.innerText);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args})));
const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const confirm=v=>page.evaluate(v=>{window.confirmResult=v;},v);
const pass=m=>{checks++;console.log('PASS '+m);};
const beforeUnload=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
const checked=label=>page.$eval('[aria-label="'+label+'"]',e=>e.getAttribute('aria-checked')==='true');
const switchTab=tab=>page.$$eval('#queue button',(bs,tab)=>{const b=bs.find(b=>b.textContent.startsWith(tab));if(!b)throw Error('Missing tab '+tab);b.click();},tab);
const selectMixed=async()=>{await click('#queue','Select work slip Slip a');await switchTab('Tasks');await click('#queue','Select task Task a');};
const bulk='[aria-label="Bulk actions"]';

await reset('queue','&open=synthetic-home');await selectMixed();await click(bulk,'Normal',true);await waitCalls(2);
assert.deepEqual((await calls()).map(c=>[c.kind,c.args.patch.priority]),[['bulkSlips','normal'],['bulkTasks','medium']]);
assert.equal(await page.$eval('[aria-label="Select task Task a"]',e=>e.disabled),true);await click(bulk,'Clear');assert.equal(await checked('Select task Task a'),true);assert.equal(await beforeUnload(),true);
await finish(1,{ok:false,error:'Tasks denied'});assert.equal(await guard(),true);await finish(0,{ok:true,updated:1});await ready(bulk+' button');await clean();await waitText('Work slips: update confirmed for 1. Tasks: Tasks denied');
assert.equal(await checked('Select task Task a'),true);await switchTab('Property Work');assert.equal(await checked('Select work slip Slip a'),false);
pass('mixed bulk results wait for both groups, preserve task failures, clear only confirmed slips, and retain normal-to-medium mapping');
await click(bulk,'Assign to me',true);await waitCalls(3);assert.deepEqual((await calls())[2],{kind:'bulkTasks',args:{ids:['task-a'],patch:{assigned_to_email:'me@example.test'}}});await finish(2,{ok:true,updated:1});await clean();await page.waitForFunction(()=>!document.querySelector('[aria-label="Bulk actions"]'));
pass('bulk retry submits only remaining IDs and same-tick double clicks cannot repeat either group');

await reset('queue','&open=synthetic-home');await selectMixed();await click(bulk,'Mark done');await waitCalls(2);await finish(0,null,true);await finish(1,{ok:true,updated:1});await ready(bulk+' button');
await waitText('Work slips: could not confirm the update');assert.equal(await checked('Select task Task a'),false);await switchTab('Property Work');assert.equal(await checked('Select work slip Slip a'),true);assert.equal(await page.evaluate(()=>window.refreshes),1);
pass('a lost bulk response retains only the uncertain group and refreshes to reconcile a possibly committed update');
await click(bulk,'Unassign');await waitCalls(3);assert.deepEqual((await calls())[2].args,{ids:['slip-a'],patch:{assigned_to_email:null}});await finish(2,{ok:false,error:'Slip retry failed'});await ready(bulk+' button');await waitText('Slip retry failed');assert.equal(await checked('Select work slip Slip a'),true);await click(bulk,'Clear');
pass('returned retry errors stay visible with the remaining selection and explicit Clear recovers normally');

await reset('queue','&open=synthetic-home');await selectMixed();await click(bulk,'High');await waitCalls(2);await finish(0,{ok:false,error:'Slip failure'});await finish(1,null,true);await ready(bulk+' button');await waitText('Slip failure');await waitText('Tasks: could not confirm');
assert.match(await body(),/2 selected/);await click(bulk,'Low');await waitCalls(4);assert.deepEqual((await calls()).slice(2).map(c=>c.args.patch.priority),['low','low']);await finish(2,{ok:true,updated:1});await finish(3,{ok:true,updated:1});await clean();
pass('two different failure modes keep both groups selected and a later confirmed retry clears them');

for(const [scope,kind] of [['slip','doneSlip'],['task','doneTask']]){
 await reset('done');await click('#'+scope,'✓ Done',true);await waitCalls(1);assert.equal((await calls())[0].kind,kind);await page.waitForFunction(scope=>document.querySelector('#'+scope).textContent==='',{},scope);assert.equal(await beforeUnload(),true);
 await finish(0,{ok:false,error:'Completion denied'});await ready('#'+scope+' button');await waitText('Could not mark done: Completion denied');
 await click('#'+scope,'✓ Done');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm completion');await ready('#'+scope+' button');assert.equal(await page.evaluate(()=>window.refreshes),2);
 pass(scope+' quick Done keeps optimistic removal, restores the row with returned/thrown failure feedback, and blocks repeat clicks');
 await click('#'+scope,'✓ Done');await waitCalls(3);await finish(2);await clean();assert.equal(await page.$eval('#'+scope,e=>e.textContent),'');
 pass(scope+' quick Done retries explicitly, refreshes, and stays hidden only after confirmed success');
}

// Locate real CRM rows by the accessible picker; no test-only production IDs.
const crmRow=async(kind,index)=>{
 const selector=kind==='phone'?'select[aria-label^="Attach "]':'select[aria-label^="Contact type for "]';
 await page.$$eval('#crm '+selector,(es,index)=>{document.querySelectorAll('[data-test-row]').forEach(e=>e.removeAttribute('data-test-row'));es[index].parentElement.parentElement.setAttribute('data-test-row','');},index);
 return '[data-test-row]';
};
await reset('crm');let row=await crmRow('phone',0);await edit(row+' select','contact-a');await click(row,'Attach',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{phone:'+19785550101',contactId:'contact-a'});
assert.equal(await page.$eval(row+' select',e=>e.disabled),true);await click(row,'Add as new');assert.equal(await page.$('[role="dialog"]'),null);await click(row,'…');assert.equal((await calls()).length,1);
row=await crmRow('phone',1);await edit(row+' select','contact-b');await click(row,'Attach');await waitCalls(2);await finish(0,null,true);
row=await crmRow('phone',0);await ready(row+' select');assert.equal(await value(row+' select'),'contact-a');await waitText('Could not confirm the link');row=await crmRow('phone',1);assert.equal(await page.$eval(row+' select',e=>e.disabled),true);assert.equal(await guard(),true);
await finish(1,{ok:false,error:'Second link failed'});await ready(row+' select');await clean();assert.equal(await value(row+' select'),'contact-b');
pass('phone rows retain exact contact choices after failures and completing one request cannot unlock another pending row');
row=await crmRow('phone',0);await click(row,'Attach');await waitCalls(3);assert.equal((await calls())[2].args.contactId,'contact-a');await finish(2,{ok:true,filled:false,contactName:'Contact a'});await waitText('Linked to Contact a');await ready(row+' select');
pass('existing-primary-phone success keeps its explanatory note and leaves the selected target intact');
row=await crmRow('phone',1);await click(row,'Attach');await waitCalls(4);await finish(3,{ok:true,filled:true,contactName:'Contact b'});await page.waitForFunction(()=>document.querySelectorAll('#crm select[aria-label^="Attach "]').length===1);
pass('confirmed phone-fill success removes only the matching unknown number');
row=await crmRow('phone',0);await click(row,'Dismiss',true);await waitCalls(5);await finish(4,{ok:false,error:'Dismiss denied'});await ready(row+' select');await waitText('Dismiss denied');await click(row,'Dismiss');await waitCalls(6);await finish(5,null,true);await ready(row+' select');await waitText('Could not confirm dismissal');
await click(row,'Dismiss');await waitCalls(7);await finish(6);await clean();await page.waitForFunction(()=>!document.querySelector('#crm select[aria-label^="Attach "]'));
pass('phone dismissal reports returned and thrown failures, prevents duplicate requests, and hides only confirmed dismissals');

await reset('crm');row=await crmRow('suggestion',0);await edit(row+' select','vendor');const acceptLabel=await page.$eval(row+' button',e=>e.textContent.trim());await click(row,acceptLabel,true);await waitCalls(1);
assert.deepEqual((await calls())[0],{kind:'accept',args:{id:'suggestion-a',contactType:'vendor'}});assert.equal(await page.$eval(row+' select',e=>e.disabled),true);await click(row,'Skip');assert.equal((await calls()).length,1);
row=await crmRow('suggestion',1);await click(row,'Skip',true);await waitCalls(2);await finish(0,{ok:false,error:'Accept denied'});row=await crmRow('suggestion',0);await ready(row+' select');await waitText('Accept denied');assert.equal(await value(row+' select'),'vendor');
row=await crmRow('suggestion',1);assert.equal(await page.$eval(row+' select',e=>e.disabled),true);await finish(1,null,true);await ready(row+' select');await waitText('Could not confirm Skip');await clean();
pass('suggestion Accept and Skip share a per-row lock, preserve selected type, and independent rows recover separately');
row=await crmRow('suggestion',0);await click(row,acceptLabel);await waitCalls(3);await finish(2,null,true);await ready(row+' select');await waitText('Check your contacts before retrying to avoid a duplicate');assert.equal(await value(row+' select'),'vendor');assert.deepEqual(await page.evaluate(()=>window.navigations),[]);
pass('uncertain suggestion acceptance retains the type, warns against duplicates, and never retries or navigates automatically');
row=await crmRow('suggestion',1);await click(row,'Skip');await waitCalls(4);row=await crmRow('suggestion',0);await click(row,acceptLabel);await waitCalls(5);await finish(4,{ok:true,contactId:'created-contact'});await waitText('Updated Suggestion a.');
assert.equal(await page.$eval('a[href="/crm/created-contact"]',e=>e.target),'_blank');assert.deepEqual(await page.evaluate(()=>window.navigations),[]);assert.equal(await guard(),true);row=await crmRow('suggestion',0);assert.equal(await page.$eval(row+' select',e=>e.disabled),true);
await finish(3,{ok:false,error:'Skip denied'});await ready(row+' select');await waitText('Skip denied');
pass('confirmed acceptance offers an explicit contact link without interrupting another pending row or losing its failure');
await click(row,'Skip');await waitCalls(6);await finish(5);await clean();await page.waitForFunction(()=>!document.querySelector('#crm select[aria-label^="Contact type for "]'));await waitText('Updated Suggestion a.');
pass('Skip success removes its own suggestion while the accepted-contact result remains available');

const draftResult={ok:true,draftUrl:'https://example.test/synthetic-draft',jobCount:2,photoCount:3,warnings:['One synthetic warning']};
await reset('composer');assert.equal(await guard(),false);await edit('#composer select','custom');await edit('#composer input[placeholder="Name"]','Custom Vendor');await edit('#composer input[type="email"]','custom@example.test');await edit('#composer textarea','Exact note\nTiming and parts');assert.equal(await beforeUnload(),true);
await click('#composer','Cancel');assert.equal(await page.evaluate(()=>window.closeCount),0);await click('#composer','Create Gmail draft',true);await waitCalls(1);
assert.equal(await page.$$eval('#composer input,#composer textarea,#composer select',es=>es.every(e=>e.matches(':disabled'))),true);await confirm(true);await click('#composer','Cancel');assert.equal(await page.evaluate(()=>window.closeCount),0);
await finish(0,{ok:false,error:'Draft denied'});await ready('#composer textarea');assert.equal(await value('#composer textarea'),'Exact note\nTiming and parts');assert.equal(await value('#composer input[type="email"]'),'custom@example.test');
pass('work-order creation freezes the exact recipient and note, blocks duplicate drafts and closing, and retains returned failures');
await click('#composer','Create Gmail draft');await waitCalls(2);assert.deepEqual((await calls())[1].args,(await calls())[0].args);await finish(1,null,true);await ready('#composer textarea');await waitText('Check Gmail Drafts before retrying');assert.equal(await guard(),true);assert.deepEqual(await page.evaluate(()=>window.opened),[]);
pass('a lost draft response keeps every field, shows the uncertainty, and neither opens Gmail nor repeats the action');
await edit('#composer textarea','Revised exact note');await click('#composer','Create Gmail draft');await waitCalls(3);assert.equal((await calls())[2].args.note,'Revised exact note');await finish(2,draftResult);await waitText('Draft ready for custom@example.test');await clean();
assert.deepEqual(await page.evaluate(()=>window.opened),[draftResult.draftUrl]);assert.equal(await value('#composer input[type="date"]'),'2026-10-01');await waitText('One synthetic warning');
pass('confirmed draft creation opens only its returned review link and releases only the saved composer state');
await edit('#composer input[type="date"]','2026-10-04');assert.equal(await guard(),true);await confirm(false);await click('#composer','Close work order');assert.equal(await page.evaluate(()=>window.closeCount),0);
await click('#composer','Mark scheduled',true);await waitCalls(4);assert.deepEqual((await calls())[3].args,{slipIds:['slip-a','slip-b'],scheduledDate:'2026-10-04',vendorName:'Custom Vendor',vendorOrganization:null});assert.equal(await page.$eval('#composer input[type="date"]',e=>e.disabled),true);
await confirm(true);await click('#composer','Close work order');assert.equal(await page.evaluate(()=>window.closeCount),0);await finish(3,{ok:false,error:'Scheduling denied'});await ready('#composer input[type="date"]');await waitText('Scheduling denied');assert.equal(await value('#composer input[type="date"]'),'2026-10-04');
pass('scheduling protects the chosen date from close and repeated clicks and retains it after a returned failure');
await click('#composer','Mark scheduled');await waitCalls(5);await finish(4,null,true);await ready('#composer input[type="date"]');await waitText('Could not confirm scheduling');assert.equal(await guard(),true);await edit('#composer input[type="date"]','2026-10-05');await click('#composer','Mark scheduled');await waitCalls(6);assert.equal((await calls())[5].args.scheduledDate,'2026-10-05');
await finish(5,{ok:true,updated:1,label:'Vendor: Custom Vendor'});await clean();await waitText('1 slip scheduled');await click('#composer','Close work order');assert.equal(await page.evaluate(()=>window.closeCount),1);
pass('scheduling recovers from a lost response, retries the current date, and reports the server count on confirmed success');

await reset('composer','&undated=1');await click('#composer','Create Gmail draft');await waitCalls(1);await page.evaluate(()=>window.changeRoster());await finish(0,draftResult);await waitText('Draft ready');await click('#composer','Mark scheduled');await waitCalls(2);
assert.deepEqual((await calls())[1].args,{slipIds:['slip-a','slip-b'],scheduledDate:null,vendorName:'Original Vendor',vendorOrganization:'Original Company'});await finish(1,{ok:true,updated:0,label:'Vendor: Original Vendor'});await clean();await waitText('0 slips scheduled');
pass('scheduling uses the confirmed draft’s original vendor and slip IDs even if refreshed props change, preserving undated scheduling and zero-count results');

await reset('composer');await edit('#composer textarea','Discard this note');await confirm(true);await click('#composer','Cancel');await clean();assert.equal(await page.evaluate(()=>window.closeCount),1);
pass('explicit composer discard releases its refresh guard without any draft request');

await reset('parents');for(const scope of ['#run','#vendor']){await click(scope,'Email…');await edit(scope+' textarea','Independent note '+scope);await click(scope,'Email…');assert.equal(await value(scope+' textarea'),'Independent note '+scope);}
await confirm(true);await click('#run','Cancel');assert.equal(await guard(),true);await click('#vendor','Create Gmail draft');await waitCalls(1);await page.evaluate(()=>window.unmount());await clean();await finish(0,null,true);
pass('both parent Email buttons preserve open composers; closing one cannot release the other’s guard, and unmount cleans up pending guards');

assert.deepEqual(errors,[]);console.log('All '+checks+' queue action browser checks passed.');
}catch(error){if(page)console.error('Synthetic action state:',await page.evaluate(()=>({body:document.body.innerText,calls:window.calls?.map(({kind,args})=>({kind,args})),guarded:window.guarded?.()})));throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
