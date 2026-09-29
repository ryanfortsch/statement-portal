/** Actual forms, synthetic records/actions only. No external requests or writes. */
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
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'helm-forms-recovery-'));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [['owner-draft','src/lib/use-owner-email-draft.ts'],['draft-guard','src/lib/use-draft-navigation-guard.ts']])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
for(const [name,path,extra=''] of [
  ['queue','src/app/work/QueueClient.tsx','\nexport {WorkSlipModal,TaskModal};'],
  ['crm','src/app/crm/CrmListClient.tsx','\nexport {NewContactModal};'],
  ['contact','src/app/crm/[id]/ContactDetail.tsx'],
  ['owners','src/app/properties/[id]/OwnersEditor.tsx'],
  ['facts','src/app/owner-messaging/OwnerFactsEditor.tsx'],
  ['vendor','src/app/fieldwork/trades/VendorForm.tsx'],
  ['documents','src/app/properties/[id]/DocumentsPanel.tsx'],
  ['section','src/components/Section.tsx'],['picker','src/components/TeamPicker.tsx'],
  ['unsaved','src/lib/unsaved-work.ts'],['work-types','src/lib/work-types.ts'],
  ['supplies','src/lib/inspection-supplies.ts'],['trades','src/lib/trades.ts'],['quo-lines','src/lib/quo-lines.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')+extra));
await writeFile(join(scratch,'document-types.js'),compile((await readFile(join(root,'src/lib/property-documents.ts'),'utf8')).replace("import { supabase } from '@/lib/supabase';",'')));
await writeFile(join(scratch,'actions.js'),`
export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
export const createWorkSlip=a=>save('slip',a),createTask=a=>save('task',a),createContact=a=>save('createContact',a),updateContact=a=>save('contact',a),deleteContact=a=>save('deleteContact',a);
export const addContactTouch=a=>save('touch',a),deleteContactTouch=a=>save('deleteTouch',a);
export const saveOwnerCards=(propertyId,owners)=>save('owners',{propertyId,owners}),saveOwnerFacts=a=>save('facts',a);
export const saveTradeVendor=(prev,data)=>save('vendor',[...data.entries()]);
export const uploadPropertyDocument=(id,prev,data)=>save('upload',{id,data:[...data.entries()].map(([k,v])=>[k,v instanceof File?{name:v.name,size:v.size,type:v.type}:v])});
export const deletePropertyDocument=(propertyId,documentId)=>save('deleteDocument',{propertyId,documentId});
export const updateWorkSlipStatus=()=>{},updateTaskStatus=()=>{},bulkUpdateWorkSlips=()=>{},bulkUpdateTasks=()=>{},addUnknownAsContact=()=>{},dismissUnknownNumber=()=>{},attachUnknownToContact=()=>{},acceptContactSuggestion=()=>{},dismissContactSuggestion=()=>{};
`);
await writeFile(join(scratch,'router.js'),`
export const useRouter=()=>({push:url=>window.navigations.push(url),refresh:()=>window.refreshes++});
export const usePathname=()=>'/work',useSearchParams=()=>new URLSearchParams();
export {unstable_rethrow} from 'next/dist/client/components/unstable-rethrow.browser';
`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>window.refreshes++;');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react';export default function Link({href,children,...props}){return <a {...props} href={href} onClick={e=>{e.preventDefault();window.navigations.push(href);}}>{children}</a>}`));
await writeFile(join(scratch,'empty.js'),'export const SyncGmailButton=()=>null,SyncQuoButton=()=>null,SyncQuoContactsButton=()=>null,ContactDraftEmailButton=()=>null;');
await writeFile(join(scratch,'team.js'),`export const TEAM_MEMBERS=[];export const getTeamMember=()=>null,displayNameForEmail=e=>e,initialsForEmail=e=>e?.slice(0,2)||'+';`);
await writeFile(join(scratch,'crm-types.js'),`export const CONTACT_TYPE_LABELS={owner:'Owner',lead:'Lead',vendor:'Vendor',other:'Other'},TOUCH_CHANNEL_LABELS={email:'Email',call:'Call',note:'Note'},TOUCH_SOURCE_LABELS={manual:'Manual'};export const touchSource=()=> 'manual';`);
// Only the uploader is stubbed: its real upload batch has its own browser suite.
await writeFile(join(scratch,'photo.js'),compile(`import React from 'react';export function PhotoUploader({onChange,onUploadingChange,disabled}){window.finishPhotos=()=>{onChange(['https://example.test/photo.jpg']);onUploadingChange(false);};return <button type="button" disabled={disabled} onClick={()=>onUploadingChange(true)}>Start synthetic photos</button>;}`));
await writeFile(join(scratch,'entry.js'),compile(`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkSlipModal,TaskModal} from './queue.js';import {NewContactModal} from './crm.js';import {ContactDetail} from './contact.js';
import {OwnersEditor} from './owners.js';import {OwnerFactsEditor} from './facts.js';import {VendorForm} from './vendor.js';import {DocumentsPanel} from './documents.js';import {hasUnsavedWork} from './unsaved.js';import {save} from './actions.js';
const p=new URLSearchParams(location.search),mode=p.get('mode');
window.calls=[];window.navigations=[];window.refreshes=0;window.closeCount=0;window.confirmations=[];window.confirmResult=false;window.guarded=hasUnsavedWork;window.redirects=[];
window.confirm=m=>{window.confirmations.push(m);return window.confirmResult;};
const properties=[{id:'synthetic-home',name:'Synthetic Home',city:'Gloucester',title:null,is_active:true},{id:'other-home',name:'Other Home',city:'Rockport',title:null,is_active:true}];
const me='me@example.test',now='2026-09-01T12:00:00Z';
const contact={id:'synthetic-contact',type:'other',name:'Original contact',emails:['old@example.test'],phone:'9785550100',organization:'Original company',notes:'Original contact note',tags:['old'],linked_property_ids:[],created_by_email:me,created_at:now,updated_at:now};
const owner={first_name:'Original',last_name:'Owner',email:'owner@example.test',phone:'9785550101',is_primary:true,role:'Owner',notes:'Original owner note'};
const vendor={id:'synthetic-vendor',name:'Original vendor',category:'plumbing',standing:'backup',insured:null,emergency:false,w9_on_file:false,property_ids:[],notes:'Original vendor notes'};
const docs=['a','b'].map(id=>({id,property_id:'synthetic-home',label:'Document '+id,category:'insurance',file_url:'https://example.test/'+id+'.pdf',size_bytes:9,source:'upload',uploaded_by_email:me,created_at:now}));
class RedirectBoundary extends React.Component {state={redirected:false};static getDerivedStateFromError(){return {redirected:true};}componentDidCatch(error){if(!String(error.digest).startsWith('NEXT_REDIRECT;'))throw error;window.redirects.push(error.digest);}render(){return this.state.redirected?<div>Redirect received</div>:this.props.children;}}
function Fixture(){const [mounted,setMounted]=useState(true);window.unmount=()=>setMounted(false);const close=()=>{window.closeCount++;setMounted(false);};if(!mounted)return null;return <>
{mode==='slip'&&<section id="slip"><WorkSlipModal properties={properties} prefillPropertyId={null} myEmail={me} onClose={close}/></section>}
{mode==='task'&&<section id="task"><TaskModal properties={properties} myEmail={me} onClose={close}/></section>}
{mode==='crm'&&<section id="crm"><NewContactModal properties={properties} initialPhone={p.has('promote')?'9785550123':undefined} initialType={p.has('promote')?'lead':undefined} onSubmit={p.has('promote')?a=>save('promote',a):undefined} onClose={close} onCreated={id=>{window.navigations.push('/crm/'+id);close();}}/></section>}
{(mode==='contact'||mode==='all')&&<section id="contact"><ContactDetail contact={contact} touches={[]} properties={properties} linkedSlips={[]} myEmail={me}/></section>}
{(mode==='owners'||mode==='all')&&<section id="owners"><OwnersEditor propertyId="synthetic-home" initialOwners={[owner]}/></section>}
{(mode==='facts'||mode==='all')&&<section id="facts"><OwnerFactsEditor initialContent="Original owner facts" initialBytes={20} learnedContent="- Learned synthetic rule"/></section>}
{mode==='vendor'&&<section id="vendor"><RedirectBoundary><VendorForm properties={properties} trade="handyman" vendor={p.has('edit')?vendor:undefined}/></RedirectBoundary></section>}
{(mode==='docs'||mode==='all')&&<section id="docs"><DocumentsPanel propertyId="synthetic-home" documents={docs}/></section>}
</>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`));
const alias={'@/lib/use-owner-email-draft':'owner-draft','./use-draft-navigation-guard':'draft-guard','./unsaved-work':'unsaved','./actions':'actions','../actions':'actions','@/app/properties/actions':'actions','@/lib/use-soft-refresh':'refresh','@/lib/unsaved-work':'unsaved','@/lib/team':'team','@/components/Section':'section','@/components/TeamPicker':'picker','@/components/PhotoUploader':'photo','@/lib/crm':'crm-types','@/lib/work-types':'work-types','@/lib/inspection-supplies':'supplies','@/lib/quo-lines':'quo-lines','@/lib/trades':'trades','@/lib/property-documents':'document-types','./SyncGmailButton':'empty','./SyncQuoButton':'empty','./SyncQuoContactsButton':'empty','./ContactDraftEmailButton':'empty','next/navigation':'router','next/link':'link'};
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:Object.fromEntries(Object.entries(alias).map(([k,v])=>[k,join(scratch,v+'.js')]))},performance:{hints:false}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));});
if(process.argv.includes('--compile-only')){console.log('Forms recovery fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{if(req.method!=='GET'){res.writeHead(405).end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(scratch,'bundle.js')));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic forms</title><style>body{font:14px system-ui;--ink:#222;--paper:#fff;--rule:#ccc}section{margin:20px}button{margin:4px}label{display:block}fieldset{min-width:0}input,textarea,select{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;let browser,page,checks=0;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1250,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
const reset=async(mode,extra='')=>{await page.goto(origin+'/?mode='+mode+extra);await page.waitForSelector('#'+(mode==='all'?'contact':mode));};
const click=(section,label,twice=false)=>page.$$eval('#'+section+' button',(bs,label,twice)=>{const b=bs.find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();if(twice)b.click();},label,twice);
const edit=(selector,value)=>page.$eval(selector,(e,value)=>{const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},value);
const labelField=async(section,label)=>{const selector='#'+section+' [data-test-field]';await page.$$eval('#'+section+' label',(ls,label)=>{document.querySelectorAll('[data-test-field]').forEach(e=>e.removeAttribute('data-test-field'));const l=ls.find(l=>l.textContent.trim().replace(/\s+/g,' ').startsWith(label));if(!l)throw Error('Missing label '+label);l.querySelector('input,textarea,select').setAttribute('data-test-field','');},label);return selector;};
const editLabel=async(s,l,v)=>edit(await labelField(s,l),v);
const value=s=>page.$eval(s,e=>e.value),body=()=>page.$eval('body',e=>e.innerText);
const submit=(s,twice=false)=>page.$eval('#'+s+' form',(f,twice)=>{f.requestSubmit();if(twice)f.requestSubmit();},twice);
const calls=()=>page.evaluate(()=>window.calls.map(({kind,args})=>({kind,args})));
const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
const ready=s=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},s);
const waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
const guard=()=>page.evaluate(()=>window.guarded()),clean=()=>page.waitForFunction(()=>!window.guarded());
const confirm=v=>page.evaluate(v=>{window.confirmResult=v;},v);
const backdrop=s=>page.$eval('#'+s+' [role="dialog"]',e=>e.click());
const pass=m=>{checks++;console.log('PASS '+m);};
const closed=()=>page.evaluate(()=>window.closeCount);
const frozen=s=>page.$$eval('#'+s+' form input,#'+s+' form textarea,#'+s+' form select',es=>es.every(e=>e.matches(':disabled')));
const beforeUnload=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});

for(const mode of ['slip','task']){
  await reset(mode);assert.equal(await guard(),false);await editLabel(mode,'Title','Keep this '+mode);
  if(mode==='slip')await editLabel(mode,'Property','synthetic-home');
  await editLabel(mode,'Description','Exact details\nSecond line');assert.equal(await beforeUnload(),true);
  await backdrop(mode);await click(mode,'Close');await click(mode,'Cancel');assert.equal(await closed(),0);
  assert.equal(await value(await labelField(mode,'Title')),'Keep this '+mode);
  await confirm(true);await click(mode,'Cancel');await clean();assert.equal(await closed(),1);
  pass(mode+' draft survives rejected close/backdrop/cancel and releases its guard only on explicit discard');

  await reset(mode);await editLabel(mode,'Title','Save this '+mode);if(mode==='slip')await editLabel(mode,'Property','synthetic-home');
  await editLabel(mode,'Description','Preserve all details');await submit(mode,true);await waitCalls(1);
  const first=(await calls())[0];assert.equal(first.kind,mode);assert.equal(first.args.title,'Save this '+mode);assert.equal(first.args.description,'Preserve all details');
  assert.equal(await frozen(mode),true);await confirm(true);await backdrop(mode);assert.equal(await closed(),0);
  await finish(0,{ok:false,error:'Synthetic returned failure'});await ready('#'+mode+' input');assert.equal(await guard(),true);
  assert.equal(await value(await labelField(mode,'Description')),'Preserve all details');
  await submit(mode);await waitCalls(2);assert.deepEqual((await calls())[1].args,first.args);await finish(1,null,true);
  await ready('#'+mode+' input');await waitText('before retrying to avoid a duplicate');assert.equal(await closed(),0);assert.equal((await calls()).length,2);
  pass(mode+' create freezes fields, blocks duplicate submits and closing, and retains returned/thrown failures without auto-retrying');
  await editLabel(mode,'Title','Latest '+mode);await submit(mode);await waitCalls(3);assert.equal((await calls())[2].args.title,'Latest '+mode);
  await finish(2,{ok:true,id:'new-'+mode});await clean();assert.equal(await closed(),1);
  assert.deepEqual(await page.evaluate(()=>window.navigations),[mode==='slip'?'/work/new-slip':'/work/tasks/new-task']);
  pass(mode+' retry takes the latest draft and navigates only after confirmed creation');
}

await reset('slip');await editLabel('slip','Title','With photos');await editLabel('slip','Property','synthetic-home');await click('slip','+ Photo');await click('slip','Start synthetic photos');
await confirm(true);await backdrop('slip');await submit('slip',true);assert.equal((await calls()).length,0);assert.equal(await closed(),0);assert.equal(await guard(),true);
await page.evaluate(()=>window.finishPhotos());await ready('#slip button[type="submit"]');await submit('slip');await waitCalls(1);assert.deepEqual((await calls())[0].args.photo_urls,['https://example.test/photo.jpg']);
await finish(0,{ok:true,id:'photos'});await clean();pass('work-slip creation and dismissal wait for uploads and include the completed photo URLs');

for(const extra of ['', '&promote=1']){
  await reset('crm',extra);assert.equal(await guard(),false);await editLabel('crm','Name','New contact');await editLabel('crm','Notes','Keep contact notes');await editLabel('crm','Emails','one@example.test\ntwo@example.test');
  await backdrop('crm');assert.equal(await closed(),0);await submit('crm',true);await waitCalls(1);assert.equal(await frozen('crm'),true);
  await confirm(true);await backdrop('crm');assert.equal(await closed(),0);const first=(await calls())[0];assert.equal(first.kind,extra?'promote':'createContact');
  if(extra)assert.equal(first.args.phone,'9785550123');
  await finish(0,{ok:false,error:'Synthetic contact error'});await ready('#crm input');assert.equal(await value(await labelField('crm','Notes')),'Keep contact notes');
  await submit('crm');await waitCalls(2);await finish(1,null,true);await ready('#crm input');await waitText('View saved contacts');assert.equal((await calls()).length,2);
  await editLabel('crm','Name','Latest contact');await submit('crm');await waitCalls(3);assert.equal((await calls())[2].args.name,'Latest contact');
  await finish(2,{ok:true,id:'new-contact'});await clean();assert.equal(await closed(),1);assert.deepEqual(await page.evaluate(()=>window.navigations),['/crm/new-contact']);
  pass((extra?'promoted':'new')+' contact retains all fields through failures, blocks competing closes/submits, and only closes on confirmed creation');
}
await reset('crm','&promote=1');await editLabel('crm','Name','Draft contact');await click('crm','Close');assert.equal(await closed(),0);await confirm(true);await click('crm','Close');await clean();assert.equal(await closed(),1);
pass('contact modal distinguishes a prefilled phone from unsaved typing and confirms explicit discard');

await reset('contact');await click('contact','Edit');await editLabel('contact','Name','Changed contact');await editLabel('contact','Emails','new@example.test\nsecond@example.test');await editLabel('contact','Notes','New details');
await click('contact','Save',true);await waitCalls(1);assert.equal((await calls())[0].kind,'contact');assert.equal(await page.$eval('#contact fieldset input',e=>e.matches(':disabled')),true);
await click('contact','Cancel');assert.ok(await page.$('#contact fieldset'));await finish(0,{ok:false,error:'Contact save failed'});await ready('#contact fieldset input');
await click('contact','Save');await waitCalls(2);await finish(1,null,true);await ready('#contact fieldset input');await waitText('Could not confirm the contact save');assert.equal(await value(await labelField('contact','Name')),'Changed contact');
await click('contact','Save');await waitCalls(3);await finish(2,{ok:true});await clean();await page.waitForFunction(()=>!document.querySelector('#contact fieldset'));
await click('contact','Edit');assert.equal(await value(await labelField('contact','Emails')),'new@example.test\nsecond@example.test');assert.equal(await guard(),false);
pass('contact edits retain their draft, freeze submitted fields, recover both failures, and mark only the confirmed snapshot saved');
await editLabel('contact','Name','Discard me');await click('contact','Cancel');assert.equal(await value(await labelField('contact','Name')),'Discard me');await confirm(true);await click('contact','Cancel');await clean();
await click('contact','Edit');assert.equal(await value(await labelField('contact','Name')),'Changed contact');await click('contact','Cancel');
pass('contact Cancel asks before discarding and restores the last confirmed save instead of stale initial fields');
await editLabel('contact','Summary','Unfinished activity');await click('contact','Edit');await editLabel('contact','Name','Independent contact save');await click('contact','Save');await waitCalls(4);await finish(3,{ok:true});
await page.waitForFunction(()=>!document.querySelector('#contact fieldset'));assert.equal(await guard(),true);assert.equal(await value(await labelField('contact','Summary')),'Unfinished activity');await click('contact','Discard activity draft');await clean();
pass('saving contact details cannot release or erase its separate activity draft');
await confirm(true);await click('contact','Delete',true);await waitCalls(5);assert.equal((await calls())[4].kind,'deleteContact');await click('contact','Edit');assert.equal(await page.$('#contact fieldset'),null);
await finish(4,null,true);await ready('#contact button');await click('contact','Edit');assert.ok(await page.$('#contact fieldset'));
pass('contact deletion blocks repeated deletion and competing edits, then recovers after a lost response');

await reset('owners');await editLabel('owners','Notes','New owner note');await click('owners','+ Add contact');await editLabel('owners','First name','Additional');await editLabel('owners','Email','extra@example.test');
await click('owners','Save owners',true);await waitCalls(1);assert.equal(await page.$eval('#owners fieldset',e=>e.disabled),true);const owners=(await calls())[0].args.owners;
assert.equal(owners.length,2);assert.equal(owners[1].email,'extra@example.test');await finish(0,{ok:false,error:'Owner contacts failed'});await ready('#owners input');
await click('owners','Save owners');await waitCalls(2);await finish(1,null,true);await ready('#owners input');assert.equal(await value(await labelField('owners','First name')),'Additional');assert.equal(await guard(),true);
const normalized=owners.map((o,i)=>({...o,phone:i?'+19785550123':o.phone}));await click('owners','Save owners');await waitCalls(3);await finish(2,{ok:true,owners:normalized});await clean();
assert.equal(await value(await labelField('owners','Phone')),'+19785550123');assert.match(await body(),/saved at/);
pass('owner contacts freeze every add/remove/edit control, retain failures, and use the normalized confirmed response as their saved baseline');
await editLabel('owners','First name','Newer unsaved name');assert.equal(await guard(),true);assert.doesNotMatch(await body(),/saved at/);await click('owners','Discard changes');await clean();assert.equal(await value(await labelField('owners','First name')),'Additional');
pass('owner contacts show an honest saved state and explicit discard restores normalized saved cards');

await reset('facts');await edit('#facts textarea','[synthetic] New owner preference');await click('facts','Save facts',true);await waitCalls(1);assert.equal(await page.$eval('#facts textarea',e=>e.disabled),true);
await finish(0,{ok:false,error:'Facts returned failure'});await ready('#facts textarea');await click('facts','Save facts');await waitCalls(2);await finish(1,null,true);await ready('#facts textarea');await waitText('Could not confirm the facts save');assert.equal(await guard(),true);
await click('facts','Save facts');await waitCalls(3);await finish(2,{ok:true});await clean();assert.match(await body(),/Next draft picks up/);await edit('#facts textarea','Unfinished rule');assert.doesNotMatch(await body(),/Next draft picks up/);
await click('facts','Discard changes');await clean();assert.equal(await value('#facts textarea'),'[synthetic] New owner preference');assert.match(await body(),/Learned synthetic rule/);
pass('owner facts retain failed edits, prevent duplicate saves, protect their saved indicator, and leave learned rules intact');

for(const extra of ['', '&edit=1']){
  await reset('vendor',extra);assert.equal(await guard(),false);await edit('#vendor [name="name"]','Synthetic vendor');await edit('#vendor [name="category"]','plumbing');await edit('#vendor [name="notes"]','Detailed vendor notes');
  await edit('#vendor [name="phone"]','9785550109');await edit('#vendor [name="insured"]','no');await edit('#vendor [name="standing"]','primary');await page.$eval('#vendor [name="emergency"]',e=>e.click());
  await page.$eval('#vendor [name="property_ids"]',e=>{for(const o of e.options)o.selected=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
  await submit('vendor',true);await waitCalls(1);assert.equal(await frozen('vendor'),true);const first=(await calls())[0].args;
  assert.deepEqual(first.filter(([k])=>k==='property_ids').map(([,v])=>v),['synthetic-home','other-home']);assert.equal(Object.fromEntries(first).insured,'no');
  assert.equal(Object.fromEntries(first).id,extra?'synthetic-vendor':undefined);
  await finish(0,{error:'Vendor returned failure'});await ready('#vendor input');await waitText('Vendor returned failure');assert.equal(await value('#vendor [name="name"]'),'Synthetic vendor');assert.equal(await value('#vendor [name="notes"]'),'Detailed vendor notes');
  assert.equal(await page.$eval('#vendor [name="emergency"]',e=>e.checked),true);assert.equal(await guard(),true);
  await submit('vendor');await waitCalls(2);assert.deepEqual((await calls())[1].args,first);await finish(1,null,true);await ready('#vendor input');await waitText('View saved vendors');assert.equal((await calls()).length,2);
  pass((extra?'existing':'new')+' vendor keeps text, multi-selects, checkboxes and tri-state fields through returned and thrown errors without automatic form reset');
  await click('vendor','Discard changes');await clean();assert.equal(await value('#vendor [name="name"]'),extra?'Original vendor':'');assert.equal(await page.$eval('#vendor [name="emergency"]',e=>e.checked),false);
  pass((extra?'existing':'new')+' vendor discard restores its original fields and releases the refresh guard');
}
await reset('vendor');await edit('#vendor [name="name"]','Redirect vendor');await edit('#vendor [name="category"]','plumbing');await submit('vendor');await waitCalls(1);
await page.evaluate(()=>{const e=Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;push;/fieldwork/trades?trade=handyman#v-synthetic;303;';window.calls[0].reject(e);});
await waitText('Redirect received');assert.equal(await page.evaluate(()=>window.redirects.length),1);await clean();assert.doesNotMatch(await body(),/Could not confirm the vendor save/);
pass('vendor success redirects remain Next framework redirects instead of being swallowed as save failures');

const chooseFile=()=>page.$eval('#docs input[type="file"]',e=>{const dt=new DataTransfer();dt.items.add(new File(['synthetic-document'],'synthetic.txt',{type:'text/plain'}));e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));});
await reset('docs');await edit('#docs [name="label"]','Keep document label');await edit('#docs [name="category"]','inspection');await chooseFile();await submit('docs',true);await waitCalls(1);assert.equal(await frozen('docs'),true);
const uploadedData=Object.fromEntries((await calls())[0].args.data);assert.equal(uploadedData.file.name,'synthetic.txt');assert.equal(uploadedData.category,'inspection');
await finish(0,{error:'Document upload failed'});await ready('#docs input');assert.equal(await value('#docs [name="label"]'),'Keep document label');assert.equal(await page.$eval('#docs input[type="file"]',e=>e.files[0].name),'synthetic.txt');assert.equal(await guard(),true);
await submit('docs');await waitCalls(2);await finish(1,null,true);await ready('#docs input');await waitText('View saved documents');assert.equal((await calls()).length,2);assert.equal(await page.$eval('#docs input[type="file"]',e=>e.files.length),1);
pass('document upload retains its selected file, category and label through failures and blocks duplicate requests');
await edit('#docs [name="label"]','Revised label');await submit('docs');await waitCalls(3);assert.equal(Object.fromEntries((await calls())[2].args.data).label,'Revised label');await finish(2,{error:null});await clean();await waitText('Document uploaded.');
assert.equal(await value('#docs [name="label"]'),'');assert.equal(await value('#docs [name="category"]'),'insurance');assert.equal(await page.$eval('#docs input[type="file"]',e=>e.files.length),0);
pass('only a confirmed document upload clears the form and exposes success');
await chooseFile();assert.equal(await guard(),true);await click('docs','Discard upload');await clean();assert.equal(await page.$eval('#docs input[type="file"]',e=>e.files.length),0);
pass('discarding a selected document releases its guard without uploading');
// Locate by exact title in DOM, avoiding CSS quoting of document names.
const removeDoc=(id,twice=false)=>page.$$eval('#docs button',(bs,id,twice)=>{const b=bs.find(b=>b.title==='Delete "Document '+id+'"');b.click();if(twice)b.click();},id,twice);
await reset('docs');await removeDoc('a');assert.equal((await calls()).length,0);await removeDoc('a',true);await waitCalls(1);assert.equal((await calls())[0].args.documentId,'a');assert.equal(await guard(),true);
await finish(0,null,true);await waitText('Could not confirm removal');await ready('#docs button[title]');assert.equal(await guard(),false);await removeDoc('a');assert.equal((await calls()).length,1);await removeDoc('a',true);await waitCalls(2);await finish(1);await clean();await waitText('Removed');
pass('document deletion keeps confirmation, blocks duplicate writes, shows failed removal and supports an explicit retry');
await edit('#docs [name="label"]','Unfinished upload');await removeDoc('b');await removeDoc('b');await waitCalls(3);await finish(2);await waitText('Removed');assert.equal(await guard(),true);assert.equal(await value('#docs [name="label"]'),'Unfinished upload');await click('docs','Discard upload');await clean();
pass('document deletion cannot erase or release an independent unfinished upload');

await reset('all');await edit('#facts textarea','Unsaved facts');await editLabel('owners','Notes','Unsaved owner note');await click('owners','Save owners');await waitCalls(1);await finish(0,{ok:true,owners:(await calls())[0].args.owners});
await ready('#owners input');assert.equal(await guard(),true);await edit('#docs [name="label"]','Unfinished document');await click('facts','Discard changes');assert.equal(await guard(),true);await click('docs','Discard upload');await clean();
pass('confirming or discarding one form cannot release another form’s refresh guard');
await edit('#facts textarea','Pending facts');await click('facts','Save facts');await editLabel('owners','Notes','Pending owner note');await click('owners','Save owners');await waitCalls(3);
await page.evaluate(()=>window.unmount());await clean();await finish(1,{ok:true});await finish(2,{ok:false,error:'Late failure'});
pass('unmount releases all guards and late responses do not resurrect forms');

assert.deepEqual(errors,[]);console.log('All '+checks+' form and contact browser checks passed.');
}catch(error){if(page)console.error('Synthetic form state:',await page.evaluate(()=>({body:document.body.innerText,calls:window.calls?.map(({kind,args})=>({kind,args})),guarded:window.guarded?.(),closed:window.closed})));throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
