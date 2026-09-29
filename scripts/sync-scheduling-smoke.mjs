/** Actual client components with controlled requests and synthetic records only. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-sync-scheduling-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [
 ['gmail','src/app/crm/SyncGmailButton.tsx'],['quo','src/app/crm/SyncQuoButton.tsx'],['contacts','src/app/crm/SyncQuoContactsButton.tsx'],
 ['plan','src/app/turnovers/PlanButton.tsx'],['adhoc','src/app/fieldwork/packets/adhoc/AdhocForm.tsx'],['offer','src/app/fieldwork/packets/OfferToPicker.tsx'],
 ['runs','src/app/work/RunsRail.tsx'],['done','src/app/properties/[id]/MarkSlipDoneButton.tsx'],['resolve','src/app/properties/[id]/ResolveFlagButton.tsx'],
 ['contacted','src/app/properties/[id]/MarkContactedButton.tsx'],['summary','src/lib/manual-sync-result.ts'],['unsaved','src/lib/unsaved-work.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const setInspectionPlan=a=>save('planSave',a),deleteInspectionPlan=id=>save('planDelete',id);
export const createAdHocPacketAction=(prev,data)=>save('adhoc',[...data.entries()]);
export const planRunsNow=()=>save('planRuns',null),publishRun=id=>save('publish',id);
export const emailWorkOrder=a=>save('draft',a),markRunScheduled=a=>save('schedule',a);
export const updateWorkSlipStatus=a=>save('done',a),resolveInspectionNote=id=>save('resolveWalk',id);
export const togglePropertyNoteResolved=(propertyId,noteId,resolveOnly)=>save('resolveProperty',{propertyId,noteId,resolveOnly});
export const markOwnerContacted=a=>save('contacted',a);
`);
await writeFile(join(scratch,'router.js'),`export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,prefetch,...props}){return <a {...props} href={href} onClick={e=>e.preventDefault()}>{children}</a>}`));
await writeFile(join(scratch,'team.js'),`export const displayNameForEmail=e=>e,getTeamMember=()=>null;`);
// The picker is a separate tested control; exercise this editor's selected value.
await writeFile(join(scratch,'picker.js'),compile(`import React from 'react';export function TeamPicker({value,onChange}){return <select aria-label="Inspector" value={value??''} onChange={e=>onChange(e.target.value||null)}><option value="">Anyone</option><option value="original@example.test">Original</option><option value="new@example.test">New inspector</option></select>}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SyncGmailButton} from './gmail.js';import {SyncQuoButton} from './quo.js';import {SyncQuoContactsButton} from './contacts.js';
import {PlanButton} from './plan.js';import {AdhocForm} from './adhoc.js';import {RunsRail} from './runs.js';
import {MarkSlipDoneButton} from './done.js';import {ResolveFlagButton} from './resolve.js';import {MarkContactedButton} from './contacted.js';
import {hasUnsavedWork} from './unsaved.js';import {save} from './actions.js';
const params=new URLSearchParams(location.search),mode=params.get('mode');
window.calls=[];window.refreshes=0;window.confirmations=[];window.confirmResult=false;window.guarded=hasUnsavedWork;window.redirects=[];
window.confirm=m=>{window.confirmations.push(m);return window.confirmResult;};window.fetch=(url,options)=>save('fetch',{url,options});window.open=()=>null;
class RedirectBoundary extends React.Component {state={redirected:false};static getDerivedStateFromError(){return {redirected:true};}componentDidCatch(error){if(!String(error.digest).startsWith('NEXT_REDIRECT;'))throw error;window.redirects.push(error.digest);}render(){return this.state.redirected?<div>Redirect received</div>:this.props.children;}}
const initialPlan={planId:params.has('new')?null:'plan-a',plannedForDate:params.has('new')?null:'2030-10-01',plannedBy:'staff@example.test',plannedNotes:params.has('new')?null:'Saved inspection notes',assignedToEmail:params.has('new')?null:'original@example.test'};
const properties=[{id:'home-a',name:'Synthetic Home',city:'Gloucester'},{id:'home-b',name:'Other Home',city:'Rockport'}];
const run={packetId:'packet-a',title:'Synthetic Run',status:'draft',suggested:true,visitDate:'2030-10-01',slips:[],closedSlipCount:0};
function Fixture(){const [mounted,setMounted]=useState(true),[plan,setPlan]=useState(initialPlan);
 window.unmount=()=>setMounted(false);window.updatePlan=()=>setPlan({...initialPlan,plannedNotes:'Refreshed notes',plannedForDate:'2030-10-02'});if(!mounted)return null;
 return <>
 {(mode==='sync'||mode==='all')&&<section id="sync"><section id="gmail"><SyncGmailButton/></section><section id="quo"><SyncQuoButton/></section><section id="contacts"><SyncQuoContactsButton/></section></section>}
 {(mode==='plan'||mode==='all')&&<section id="plan"><PlanButton {...plan} guestyReservationId="stay-a" propertyId="home-a" checkInDate="2030-10-05" checkOutDate="2030-09-29" myEmail="staff@example.test" variant={params.has('byline')?'byline':'chip'}/></section>}
 {(mode==='adhoc'||mode==='all')&&<section id="adhoc"><RedirectBoundary><AdhocForm properties={properties} offerable={[{id:'crew-a',name:'Alex Synthetic'},{id:'crew-b',name:'Blair Synthetic'}]}/></RedirectBoundary></section>}
 {mode==='runs'&&<section id="runs"><RunsRail standalone data={{runs:[run],roster:[],vendorNeeded:[],backlog:[],unclassifiedCount:0}}/></section>}
 {mode==='shortcuts'&&<section id="shortcuts"><section id="done"><MarkSlipDoneButton slipId="slip-a" propertyId="home-a"/></section><section id="walk"><ResolveFlagButton propertyId="home-a" flagId="walk-a" source="walk"/></section><section id="property"><ResolveFlagButton propertyId="home-a" flagId="note-a" source="property"/></section><section id="contacted"><MarkContactedButton propertyId="home-a"/></section></section>}
 </>;
}createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'./actions':'actions','../actions':'actions','./plan-actions':'actions','./runs-actions':'actions','@/app/work/actions':'actions','@/app/inspections/actions':'actions','@/app/properties/actions':'actions','../OfferToPicker':'offer','@/lib/use-soft-refresh':'refresh','@/lib/unsaved-work':'unsaved','@/lib/manual-sync-result':'summary','@/lib/team':'team','@/components/TeamPicker':'picker','next/navigation':'router','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Sync and scheduling fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic sync and scheduling</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+(mode==='all'?'sync':mode));};
const click=(scope,label,twice=false)=>page.$$eval(scope+' button',(bs,label,twice)=>{const b=bs.find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const value=s=>page.$eval(s,e=>e.value),body=()=>page.$eval('body',e=>e.innerText);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args})));
const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const finishFetch=(i,data,{status=200,badJson=false}={})=>page.evaluate((i,data,status,badJson)=>window.calls[i].resolve({ok:status>=200&&status<300,status,json:async()=>{if(badJson)throw Error('Synthetic invalid JSON');return data;}}),i,data,status,badJson);
const ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const confirm=v=>page.evaluate(v=>{window.confirmResult=v;},v);
const pass=m=>{checks++;console.log('PASS '+m);};
const beforeUnload=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
const gmail={ok:true,inserted:0,scanned:3,skipped:3,contacts:1,mailboxes:['synthetic'],errors:[]};
const quo={ok:true,summary:{messages_inserted:0,calls_inserted:0,cleaning_completions_inserted:0,errors:[]}};
const contacts={ok:true,suggestionsGenerated:0,inserted:0};

for(const [scope,label,empty,partial,url] of [
 ['gmail','Sync Replies',gmail,{...gmail,errors:[{error:'Synthetic mailbox failure'}]},'/api/cron/sync-gmail-replies?hours=24'],
 ['quo','Sync Quo',quo,{...quo,summary:{...quo.summary,errors:['Synthetic phone failure']}},'/api/sync-quo'],
 ['contacts','Sync Contacts',contacts,{ok:true,suggestionsGenerated:3,inserted:1},'/api/sync-quo-contacts'],
]){
 await reset('sync');await click('#'+scope,label,true);await waitCalls(1);assert.equal((await calls())[0].args.url,url);assert.equal(await beforeUnload(),true);assert.equal(await page.$eval('#'+scope+' button',e=>e.disabled),true);
 await finishFetch(0,partial);await ready('#'+scope+' button');await waitText('sync incomplete');assert.ok(await page.$('#'+scope+' [role="alert"]'));assert.doesNotMatch(await page.$eval('#'+scope,e=>e.innerText),/No new/);
 pass(scope+' sync reports partial failure honestly and rejects same-tick double clicks');
 await click('#'+scope,label);await waitCalls(2);await finishFetch(1,{});await ready('#'+scope+' button');await waitText('Could not confirm the sync result');
 await click('#'+scope,label);await waitCalls(3);await finishFetch(2,null,{badJson:true});await ready('#'+scope+' button');assert.ok(await page.$('#'+scope+' [role="alert"]'));
 pass(scope+' empty or malformed successful responses cannot become a clean zero');
 await click('#'+scope,label);await waitCalls(4);await finishFetch(3,{error:'Synthetic HTTP error'},{status:503});await ready('#'+scope+' button');await waitText('Synthetic HTTP error');
 await click('#'+scope,label);await waitCalls(5);await finish(4,null,true);await ready('#'+scope+' button');await waitText('Could not confirm the sync result');
 await click('#'+scope,label);await waitCalls(6);await finishFetch(5,empty);await ready('#'+scope+' button');await clean();assert.equal(await page.$('#'+scope+' [role="alert"]'),null);assert.ok(await page.$('#'+scope+' [role="status"]'));
 pass(scope+' HTTP and thrown failures unlock controls; explicit retry can report a genuine empty result');
}
await reset('sync');await click('#gmail','Sync Replies');await click('#quo','Sync Quo');await waitCalls(2);await finishFetch(0,{...gmail,inserted:2,errors:[{error:'Some failed'}]});await ready('#gmail button');assert.equal(await guard(),true);assert.equal(await page.evaluate(()=>window.refreshes),1);
await finishFetch(1,{...quo,summary:{...quo.summary,cleaning_completions_inserted:1,errors:['Some failed']}});await clean();assert.equal(await page.evaluate(()=>window.refreshes),2);
pass('partial captures refresh saved activity while each concurrent sync holds its own pending guard');

const openPlan=()=>page.$eval('#plan button',e=>e.click());
for(const extra of ['', '&byline=1']){
 await reset('plan',extra);await openPlan();await page.waitForSelector('#plan textarea');assert.equal(await value('#plan textarea'),'Saved inspection notes');assert.equal(await guard(),false);
 await edit('#plan input[type="date"]','2030-10-03');await edit('#plan select','new@example.test');await edit('#plan textarea','Revised notes\nKeep the details');await click('#plan','Close');assert.ok(await page.$('#plan textarea'));assert.equal(await beforeUnload(),true);
 await click('#plan','Save Plan',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{guestyReservationId:'stay-a',propertyId:'home-a',checkinDate:'2030-10-05',checkoutDate:'2030-09-29',plannedForDate:'2030-10-03',notes:'Revised notes\nKeep the details',assignedToEmail:'new@example.test'});
 assert.equal(await page.$$eval('#plan fieldset input,#plan fieldset textarea,#plan fieldset select,#plan fieldset button',es=>es.every(e=>e.matches(':disabled'))),true);await confirm(true);await page.$eval('#plan [role="dialog"]',e=>e.click());assert.ok(await page.$('#plan textarea'));
 await finish(0,{ok:false,error:'Plan rejected'});await ready('#plan textarea');await waitText('Plan rejected');await click('#plan','Save Plan');await waitCalls(2);await finish(1,null,true);await ready('#plan textarea');await waitText('Could not confirm the inspection plan save');assert.equal(await value('#plan select'),'new@example.test');assert.equal(await value('#plan textarea'),'Revised notes\nKeep the details');
 pass((extra?'byline':'chip')+' inspection plan loads saved notes, freezes all fields, blocks closes/duplicates, and keeps returned/thrown failures');
 await click('#plan','Save Plan');await waitCalls(3);await finish(2,{ok:true,id:'plan-a'});await clean();await page.waitForFunction(()=>!document.querySelector('#plan textarea'));await openPlan();assert.equal(await value('#plan textarea'),'Revised notes\nKeep the details');assert.equal(await guard(),false);
 await edit('#plan textarea','Discard this');await confirm(false);await click('#plan','Cancel');assert.equal(await value('#plan textarea'),'Discard this');await confirm(true);await click('#plan','Cancel');await clean();await openPlan();assert.equal(await value('#plan textarea'),'Revised notes\nKeep the details');
 pass((extra?'byline':'chip')+' plan success updates the local baseline immediately and explicit discard restores only confirmed values');
}
await edit('#plan textarea','Draft during refresh');await page.evaluate(()=>window.updatePlan());assert.equal(await value('#plan textarea'),'Draft during refresh');await confirm(true);await click('#plan','Cancel');await openPlan();assert.equal(await value('#plan textarea'),'Refreshed notes');assert.equal(await value('#plan input[type="date"]'),'2030-10-02');
pass('server refresh cannot overwrite an open inspection draft, while reopening after discard uses refreshed values');
await click('#plan','Remove plan',true);await waitCalls(4);await finish(3,{ok:false,error:'Removal denied'});await ready('#plan textarea');await waitText('Removal denied');await click('#plan','Remove plan');await waitCalls(5);await finish(4,null,true);await ready('#plan textarea');await waitText('Could not confirm plan removal');assert.equal(await value('#plan textarea'),'Refreshed notes');
await click('#plan','Remove plan');await waitCalls(6);await finish(5);await clean();await waitText('+ Plan inspection');await openPlan();assert.equal(await value('#plan textarea'),'');assert.equal(await page.$$eval('#plan button',bs=>bs.some(b=>b.textContent==='Remove plan')),false);
pass('plan deletion retains the current form on failure and only confirmed removal resets the saved plan');
await reset('plan','&new=1');await openPlan();assert.equal(await value('#plan input[type="date"]'),'2030-10-05');await edit('#plan select','new@example.test');await click('#plan','Save Plan');await waitCalls(1);await finish(0,{ok:true,id:'new-plan'});await clean();await openPlan();await click('#plan','Remove plan');await waitCalls(2);assert.equal((await calls())[1].args,'new-plan');await finish(1);await clean();
pass('new inspection plans retain the existing default day and use the returned ID before refreshed props arrive');

const submitJob=(mode,twice=false)=>page.$eval('#adhoc form',(form,mode,twice)=>{const button=form.querySelector('button[value="'+mode+'"]');form.requestSubmit(button);if(twice)form.requestSubmit(button);},mode,twice);
const fillJob=async()=>{await edit('#adhoc [name="title"]','Synthetic job');await edit('#adhoc [name="property_id"]','home-b');await edit('#adhoc [name="visit_date"]','2030-10-04');await edit('#adhoc [name="visit_time"]','13:30');await edit('#adhoc [name="price_dollars"]','75');await edit('#adhoc [name="scope"]','Exact job details\nSecond line');await edit('#adhoc [name="bring_list"]','Filter and gloves');await page.$eval('#adhoc [name="supply_run"]',e=>e.click());await click('#adhoc','Alex');await click('#adhoc','Blair');};
for(const mode of ['draft','publish']){
 await reset('adhoc');await fillJob();assert.equal(await beforeUnload(),true);await submitJob(mode,true);await waitCalls(1);const first=(await calls())[0].args;
 assert.equal(Object.fromEntries(first).mode,mode);assert.equal(Object.fromEntries(first).price_dollars,'75');assert.deepEqual(first.filter(([k])=>k==='offer_to').map(([,v])=>v),['crew-a','crew-b']);assert.equal(Object.fromEntries(first).supply_run,'on');
 assert.equal(await page.$$eval('#adhoc input,#adhoc textarea,#adhoc select,#adhoc button',es=>es.every(e=>e.matches(':disabled'))),true);await submitJob(mode==='draft'?'publish':'draft');assert.equal((await calls()).length,1);
 await finish(0,{error:'Synthetic job rejected'});await ready('#adhoc input');await waitText('Synthetic job rejected');assert.equal(await value('#adhoc [name="title"]'),'Synthetic job');assert.equal(await value('#adhoc [name="property_id"]'),'home-b');assert.equal(await page.$eval('#adhoc [name="supply_run"]',e=>e.checked),true);
 await submitJob(mode);await waitCalls(2);assert.deepEqual((await calls())[1].args,first);await finish(1,null,true);await ready('#adhoc input');await waitText('Check the job list before retrying');assert.equal(await guard(),true);assert.equal(await value('#adhoc [name="scope"]'),'Exact job details\nSecond line');
 pass(mode+' job retains all native fields, selected contractors and checkbox state through returned/thrown errors and blocks competing submissions');
 await click('#adhoc','Discard changes');await clean();assert.equal(await value('#adhoc [name="title"]'),'');assert.equal(await page.$$eval('#adhoc [name="offer_to"]',es=>es.length),0);assert.equal(await page.$eval('#adhoc [name="supply_run"]',e=>e.checked),false);
 pass(mode+' job discard resets contractor picks as well as native fields without creating a job');
}
await reset('adhoc');await click('#adhoc','Alex');assert.equal(await guard(),true);await click('#adhoc','everyone');await clean();await fillJob();await submitJob('draft');await waitCalls(1);
await page.evaluate(()=>{const e=Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;push;/fieldwork/packets/synthetic;303;';window.calls[0].reject(e);});await waitText('Redirect received');await clean();assert.equal(await page.evaluate(()=>window.redirects.length),1);assert.doesNotMatch(await body(),/Could not confirm whether the job was created/);
pass('contractor-only choices arm the draft guard and successful job creation still follows the Next redirect');

await reset('runs');await click('#runs','Plan now',true);await waitCalls(1);assert.equal((await calls())[0].kind,'planRuns');assert.equal(await beforeUnload(),true);await finish(0,{ok:false,error:'Planning denied'});await waitText('Planning denied');await ready('#runs button');
await click('#runs','Plan now');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm planning');await ready('#runs button');await click('#runs','Plan now');await waitCalls(3);await finish(2,{ok:true,created:2,kept:3,noVacancy:1,classifying:4});await clean();await waitText('2 planned');await waitText('3 unchanged');await waitText('triaging 4');assert.equal(await page.$('#runs [role="alert"]'),null);
pass('maintenance planning blocks repeat clicks, reports returned and thrown failures, and preserves the real planning summary on success');
await click('#runs','Publish',true);await waitCalls(4);assert.equal((await calls())[3].args,'packet-a');await finish(3,{ok:false,error:'Packet cannot publish'});await clean();await waitText('Packet cannot publish');await click('#runs','Publish');await waitCalls(5);await finish(4,null,true);await clean();await waitText('Open the packet to check its status');
await click('#runs','Publish');await waitCalls(6);await finish(5);await clean();await waitText('Published');assert.equal(await page.$$eval('#runs button',bs=>bs.some(b=>b.textContent==='Publish')),false);
pass('maintenance publication keeps its target on failure and removes Publish only after a confirmed response');

await reset('shortcuts');await click('#done','Done');assert.equal((await calls()).length,0);await click('#done','Confirm ✓',true);await waitCalls(1);assert.deepEqual((await calls())[0].args,{id:'slip-a',status:'done',propertyId:'home-a'});await finish(0,{ok:false,error:'Completion denied'});await clean();await waitText('Completion denied');await click('#done','Retry');assert.equal((await calls()).length,1);await click('#done','Confirm ✓');await waitCalls(2);await finish(1,null,true);await clean();await waitText('Could not confirm completion');
await click('#done','Retry');await click('#done','Confirm ✓');await waitCalls(3);await finish(2);await clean();await waitText('Done ✓');assert.equal(await page.$eval('#done button',e=>e.disabled),true);
pass('property Done retains two-tap confirmation, explains both failure paths, and prevents a repeat write after success');
for(const scope of ['walk','property']){
 await reset('shortcuts');await click('#'+scope,'Resolve',true);await waitCalls(1);assert.doesNotMatch(await page.$eval('#'+scope,e=>e.innerText),/^Resolved$/);
 if(scope==='property')assert.deepEqual((await calls())[0].args,{propertyId:'home-a',noteId:'note-a',resolveOnly:true});
 if(scope==='walk'){await finish(0,{ok:false,error:'Resolve denied'});await clean();await waitText('Resolve denied');await click('#'+scope,'Resolve');await waitCalls(2);await finish(1,null,true);}else await finish(0,null,true);
 await clean();await waitText('Could not confirm resolution');await click('#'+scope,'Resolve');const next=scope==='walk'?3:2;await waitCalls(next);await finish(next-1);await clean();await waitText('Resolved');assert.equal(await page.$('#'+scope+' button'),null);
 pass(scope+' flag shows pending until confirmation, recovers failed resolution, and submits one explicit resolve per attempt');
}
await reset('shortcuts');await click('#contacted','I reached out');await click('#contacted','Phone',true);await waitCalls(1);await finish(0,{ok:false,error:'Contact denied'});await clean();await waitText('Retry Phone');await click('#contacted','Retry Phone',true);await waitCalls(2);assert.deepEqual((await calls())[1].args,{property_id:'home-a',channel:'phone'});await finish(1,null,true);await clean();await waitText('Check Last contacted');await click('#contacted','Retry Phone');await waitCalls(3);await finish(2,{ok:true,at:'2030-10-01T12:00:00Z'});await clean();await waitText('Saved ✓');
await click('#contacted','Saved ✓');await click('#contacted','Email');await waitCalls(4);await finish(3,{ok:false,error:'Later email failed'});await clean();assert.doesNotMatch(await page.$eval('#contacted',e=>e.innerText),/Saved ✓/);await waitText('Retry Email');await click('#contacted','Dismiss');assert.equal(await page.$('#contacted [role="alert"]'),null);
pass('I reached out retains the failed channel for retry and clears stale Saved feedback when a later update fails');

await reset('all');await openPlan();await edit('#plan textarea','Independent inspection draft');await click('#gmail','Sync Replies');await waitCalls(1);await finishFetch(0,gmail);await ready('#gmail button');assert.equal(await guard(),true);await fillJob();await confirm(true);await click('#plan','Cancel');assert.equal(await guard(),true);await click('#adhoc','Discard changes');await clean();
pass('sync completion and inspection discard cannot release an independent job draft guard');
await click('#gmail','Sync Replies');await waitCalls(2);await page.evaluate(()=>window.unmount());await clean();await finish(1,null,true);
pass('unmount releases pending guards and late responses cause no browser errors');

assert.deepEqual(errors,[]);console.log('All '+checks+' sync and scheduling browser checks passed.');
}catch(error){if(page)console.error('Synthetic sync/scheduling state:',await page.evaluate(()=>({body:document.body.innerText,calls:window.calls?.map(({kind,args})=>({kind,args})),guarded:window.guarded?.()})));throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
