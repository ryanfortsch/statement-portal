/** Real React editors with synthetic actions, contacts, tasks, and rooms.
 * Every external request is blocked; owner-email drafting is mocked. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require=createRequire(import.meta.url);
const {webpack}=require('next/dist/compiled/webpack/webpack');
const root=process.cwd();
const scratch=await mkdtemp(join(tmpdir(),'helm-editor-recovery-'));
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,path] of [
  ['owner','src/app/work/[id]/SlipOwnerActionEditor.tsx'],
  ['crm','src/app/crm/[id]/ContactDetail.tsx'],
  ['task','src/app/work/tasks/[id]/TaskDetail.tsx'],
  ['playbook','src/app/playbook/PlaybookEditor.tsx'],
  ['rooms','src/app/properties/[id]/RoomsEditor.tsx'],
  ['room-types','src/lib/property-rooms-shared.ts'],
  ['picker','src/components/TeamPicker.tsx'],
  ['unsaved-work','src/lib/unsaved-work.ts'],
])await writeFile(join(scratch,name+'.js'),compile(await readFile(join(root,path),'utf8')));
await writeFile(join(scratch,'actions.js'),`
  export const save=(kind,args)=>new Promise((resolve,reject)=>window.calls.push({kind,args,resolve,reject}));
  export const updateWorkSlipOwnerAction=args=>save('owner',args);
  export const updateWorkSlipOwnerStatus=args=>save('answer',args);
  export const updateContact=args=>save('contact',args);
  export const deleteContact=args=>save('deleteContact',args);
  export const addContactTouch=args=>save('touch',args);
  export const deleteContactTouch=args=>save('deleteTouch',args);
  export const updateTask=args=>save('task',args);
  export const deleteTask=args=>save('deleteTask',args);
  export const addTaskComment=args=>save('comment',args);
  export const deleteTaskComment=args=>save('deleteComment',args);
  export const createEntry=args=>save('createEntry',args);
  export const updateEntry=args=>save('updateEntry',args);
  export const saveRoomAction=args=>save('room',args);
  export const deleteRoomAction=args=>save('deleteRoom',args);
`);
await writeFile(join(scratch,'refresh.js'),'export const useSoftRefresh=()=>()=>{window.refreshes++;};');
await writeFile(join(scratch,'router.js'),'export const useRouter=()=>({push:url=>window.navigations.push(url),refresh:()=>window.refreshes++});');
await writeFile(join(scratch,'link.js'),compile(`import React from 'react'; export default function Link({href,onClick,children,...props}){return <a {...props} href={href} onClick={e=>{onClick?.(e);if(!e.defaultPrevented)window.navigations.push(href);e.preventDefault();}}>{children}</a>}`));
await writeFile(join(scratch,'markdown.js'),compile(`import React from 'react';export const Markdown=({source})=><pre>{source}</pre>;`));
await writeFile(join(scratch,'email-button.js'),'export const ContactDraftEmailButton=()=>null;');
await writeFile(join(scratch,'team.js'),`
  export const TEAM_MEMBERS=[];
  export const getTeamMember=()=>null;
  export const displayNameForEmail=email=>email;
  export const initialsForEmail=email=>email?.slice(0,2)||'+';
`);
await writeFile(join(scratch,'crm-types.js'),`
  export const CONTACT_TYPE_LABELS={owner:'Owner',vendor:'Vendor',other:'Other'};
  export const TOUCH_CHANNEL_LABELS={email:'Email',call:'Call',text:'Text',meeting:'Meeting',note:'Note'};
  export const TOUCH_SOURCE_LABELS={manual:'Manual',gmail:'Gmail',quo:'Quo'};
  export const touchSource=t=>t.gmail_message_id?'gmail':t.quo_call_id||t.quo_message_id?'quo':'manual';
`);
await writeFile(join(scratch,'playbook-types.js'),`
  export const PLAYBOOK_CATEGORIES=[{key:'general',label:'General'},{key:'operations',label:'Operations'}];
  export const categoryLabel=key=>key;
`);
await writeFile(join(scratch,'entry.js'),compile(`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {SlipOwnerActionEditor} from './owner.js';import {ContactDetail} from './crm.js';
  import {TaskDetail} from './task.js';import {PlaybookEditor} from './playbook.js';
  import {RoomsEditor} from './rooms.js';import {hasUnsavedWork} from './unsaved-work.js';import {save} from './actions.js';
  const p=new URLSearchParams(location.search),mode=p.get('mode');
  const now='2026-09-01T12:00:00Z',me='me@example.test';
  window.calls=[];window.refreshes=0;window.navigations=[];window.opened=[];window.confirmations=[];window.confirmResult=false;window.guarded=hasUnsavedWork;
  window.confirm=message=>{window.confirmations.push(message);return window.confirmResult;};
  window.open=(...args)=>{window.opened.push(args);return null;};
  window.fetch=(url,options)=>{
    if(url!=='/api/work/draft-owner-email')throw Error('Unexpected request '+url);
    return save('email',JSON.parse(options.body)).then(r=>({ok:r.ok,status:r.status||200,json:async()=>r.data||{draft_url:'https://mail.google.com/mail/u/0/#drafts/synthetic'}}));
  };
  const contact={id:'synthetic-contact',type:'other',name:'Synthetic contact',emails:[],phone:null,organization:null,notes:'Contact note',tags:[],linked_property_ids:[],created_by_email:me,created_at:now,updated_at:now};
  const touches=['a','b','other','inbound'].map(id=>({id,contact_id:contact.id,touched_at:now,channel:'call',summary:'Activity '+id,notes:null,by_email:id==='other'?'other@example.test':me,direction:id==='inbound'?'inbound':'outbound',gmail_message_id:null,quo_message_id:null,quo_call_id:null,created_at:now}));
  const task={id:'synthetic-task',title:'Original task',description:'Original detail',scope:'property',priority:'medium',status:'open',assigned_to_email:me,due_date:'2026-10-05',property_ids:['synthetic-home'],tags:['repair'],created_by_email:me,created_at:now,updated_at:now};
  const comments=['a','b','other'].map(id=>({id,task_id:task.id,author_email:id==='other'?'other@example.test':me,body:'Comment '+id,created_at:now}));
  const entry={id:'synthetic-entry',slug:'synthetic-procedure',title:'Original procedure',category:'custom-category',summary:'Original summary',body_md:'Original instructions',tags:['operations'],property_id:null,status:'draft',pinned:false,created_by_email:me,created_at:now,updated_at:now};
  const rooms=['a','b'].map(id=>({id,property_id:'synthetic-home',room_type:'bedroom',name:'Room '+id,sort_order:0,details:{beds:[{size:'queen',count:1}],notes:'Original room notes'},guest_summary:null,created_by_email:me,created_at:now,updated_at:now}));
  const properties=[{id:'synthetic-home',name:'Synthetic home',title:null,city:'Gloucester',is_active:true}];
  function Fixture(){
    const [mounted,setMounted]=useState(true);window.unmount=()=>setMounted(false);
    if(!mounted)return null;
    return <>
      {(mode==='owner'||mode==='all')&&<section id="owner"><SlipOwnerActionEditor slipId="synthetic-slip" propertyId="synthetic-home" initialType="approve" initialNotes="Original owner notes" ownerStatus={p.get('answer')||'not_sent'} ownerLastContactedAt={p.has('contacted')?now:null} collapsed={p.has('collapsed')}/></section>}
      {(mode==='crm'||mode==='all')&&<section id="crm"><ContactDetail contact={contact} touches={touches} properties={properties} linkedSlips={[]} myEmail={me}/></section>}
      {(mode==='task'||mode==='all')&&<section id="task"><TaskDetail task={task} comments={comments} properties={properties} myEmail={me}/></section>}
      {(mode==='playbook'||mode==='all')&&<section id="playbook"><PlaybookEditor mode={p.has('new')?'new':'edit'} initial={p.has('new')?undefined:entry} properties={properties}/></section>}
      {(mode==='rooms'||mode==='all')&&<section id="rooms"><RoomsEditor propertyId="synthetic-home" rooms={rooms}/></section>}
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:scratch,entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:{
    '../actions':join(scratch,'actions.js'),'../../actions':join(scratch,'actions.js'),'./actions':join(scratch,'actions.js'),'./onboarding-actions':join(scratch,'actions.js'),
    '@/lib/use-soft-refresh':join(scratch,'refresh.js'),'@/lib/unsaved-work':join(scratch,'unsaved-work.js'),
    '@/lib/team':join(scratch,'team.js'),'@/components/TeamPicker':join(scratch,'picker.js'),
    '@/lib/crm':join(scratch,'crm-types.js'),'@/lib/playbook':join(scratch,'playbook-types.js'),
    '@/lib/property-rooms-shared':join(scratch,'room-types.js'),'@/components/Markdown':join(scratch,'markdown.js'),
    './ContactDraftEmailButton':join(scratch,'email-button.js'),'next/link':join(scratch,'link.js'),'next/navigation':join(scratch,'router.js'),
  }},performance:{hints:false}});
  compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):done()));
});
if(process.argv.includes('--compile-only')){console.log('Expanded editor recovery fixture compiled.');await rm(scratch,{recursive:true,force:true});process.exit(0);}
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await readFile(join(scratch,'bundle.js')));}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Editor recovery checks</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--negative:#a22;--ink-3:#444;--ink-4:#666}button{margin-right:8px}section{margin-bottom:20px}</style><div id="root"></div><script src="/bundle.js"></script>');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let browser,page,checks=0;
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
  page=await browser.newPage();page.setDefaultTimeout(10000);await page.setViewport({width:1200,height:1000});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin+'/')?r.continue():r.abort());
  const reset=async(mode,query='')=>{await page.goto(origin+'/?mode='+mode+query);await page.waitForSelector('#'+(mode==='all'?'owner':mode));};
  const click=(section,text,twice=false)=>page.$$eval('#'+section+' button',(buttons,text,twice)=>{
    const b=buttons.find(b=>b.textContent.trim()===text);if(!b)throw Error('Missing button '+text);b.click();if(twice)b.click();
  },text,twice);
  const clickContains=(section,text,twice=false)=>page.$$eval('#'+section+' button',(buttons,text,twice)=>{
    const b=buttons.find(b=>b.textContent.includes(text));if(!b)throw Error('Missing button containing '+text);b.click();if(twice)b.click();
  },text,twice);
  const disabled=(section,label)=>page.$$eval('#'+section+' button',(bs,label)=>bs.find(b=>b.textContent.trim()===label)?.matches(':disabled'),label);
  const edit=(selector,value)=>page.$eval(selector,(input,value)=>{
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));
  },value);
  const field=selector=>page.$eval(selector,e=>e.value);
  const text=selector=>page.$eval(selector,e=>e.textContent);
  const waitText=t=>page.waitForFunction(t=>document.body.textContent.includes(t),{},t);
  const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
  const args=i=>page.evaluate(i=>window.calls[i].args,i);
  const finish=(i,result={ok:true},reject=false)=>page.evaluate((i,result,reject)=>reject?window.calls[i].reject(Error('Synthetic lost response')):window.calls[i].resolve(result),i,result,reject);
  const guard=()=>page.evaluate(()=>window.guarded());
  const clean=()=>page.waitForFunction(()=>!window.guarded());
  const ready=selector=>page.waitForFunction(s=>document.querySelector(s)&&!document.querySelector(s).matches(':disabled'),{},selector);
  const beforeUnload=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
  const pressed=()=>page.$$eval('#owner [aria-pressed="true"]',bs=>bs.map(b=>b.textContent));
  const confirm=value=>page.evaluate(value=>{window.confirmResult=value;},value);
  const pass=name=>{checks++;console.log('PASS '+name);};

  // Scenarios are below. Only their synthetic promises can settle writes.
  await reset('owner');assert.equal(await guard(),false);await click('owner','Edit');
  await edit('#owner textarea','  Owner draft\nKeep this detail.  ');assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  assert.equal(await disabled('owner','Draft owner email'),true);
  await click('owner','Save',true);await waitCalls(1);
  assert.equal(await page.$$eval('#owner button,#owner textarea',es=>es.every(e=>e.matches(':disabled'))),true);
  assert.deepEqual(await args(0),{id:'synthetic-slip',propertyId:'synthetic-home',owner_action_required:true,owner_action_notes:'Owner draft\nKeep this detail.'});
  await finish(0,{ok:false,error:'Owner notes failed'});await waitText('Owner notes failed');await ready('#owner textarea');
  assert.equal(await field('#owner textarea'),'  Owner draft\nKeep this detail.  ');
  await click('owner','Retry save');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the owner-input change.');await ready('#owner textarea');
  assert.equal(await field('#owner textarea'),'  Owner draft\nKeep this detail.  ');assert.equal(await page.evaluate(()=>window.calls.length),2);
  await edit('#owner textarea','Revised after failure');await click('owner','Retry save',true);await waitCalls(3);await finish(2);await clean();
  assert.equal(await page.$('#owner textarea'),null);await waitText('Revised after failure');
  assert.equal((await args(2)).owner_action_notes,'Revised after failure');assert.equal(await disabled('owner','Draft owner email'),false);
  pass('owner notes survive returned/thrown failures, retries capture newer edits, and email drafting waits for confirmation');

  await reset('owner');await click('owner','Edit');await edit('#owner textarea','Unsaved owner notes');
  await click('owner','Purchase');await waitCalls(1);await finish(0);await ready('#owner textarea');
  assert.equal(await guard(),true);assert.equal(await field('#owner textarea'),'Unsaved owner notes');
  assert.equal(await disabled('owner','Draft owner email'),true);await click('owner','Cancel');await clean();
  await click('owner','Edit');assert.equal(await field('#owner textarea'),'Original owner notes');
  pass('saving an owner ask cannot clear the unsaved notes guard; cancel explicitly restores confirmed notes');

  for(const [label,target] of [['Approval',null],['Purchase','purchase'],['Scheduling','schedule'],['Decision','decide'],['Reimbursement','reimburse']]){
    await reset('owner');await click('owner',label,true);await waitCalls(1);assert.deepEqual(await pressed(),['Approval']);
    await finish(0,{ok:false,error:'Ask failed'});await waitText('Ask failed');await ready('#owner button');
    await click('owner','Retry save');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the owner-input change.');await ready('#owner button');
    assert.deepEqual(await pressed(),['Approval']);await click('owner','Retry save');await waitCalls(3);await finish(2);await clean();
    assert.deepEqual(await pressed(),target?[label]:[]);
    assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.owner_action_type)),[target,target,target]);
    pass('owner ask '+label+' keeps confirmed state and retries its exact target, including null');
  }

  for(const [label,target] of [['Approved','approved'],['Declined','declined'],['Has questions','questions']]){
    await reset('owner');await click('owner',label,true);await waitCalls(1);assert.deepEqual(await pressed(),['Approval']);
    await finish(0,null,true);await waitText('Could not confirm the owner-input change.');await ready('#owner button');
    assert.deepEqual(await pressed(),['Approval']);await click('owner','Retry save');await waitCalls(2);await finish(1);await clean();
    assert.deepEqual(await pressed(),['Approval',label]);assert.equal((await args(1)).owner_status,target);
    await click('owner',label);await waitCalls(3);assert.equal((await args(2)).owner_status,'not_sent');await finish(2);await clean();
    assert.deepEqual(await pressed(),['Approval']);
    pass('owner answer '+label+' remains honest after a lost response and toggles back to not_sent');
  }
  await reset('owner','&answer=approved&contacted=1');await click('owner','Approved');await waitCalls(1);
  await finish(0,{ok:false,error:'Clear answer failed'});await ready('#owner button');await click('owner','Retry save');await waitCalls(2);await finish(1);await clean();
  assert.equal((await args(1)).owner_status,'sent');pass('clearing a previously contacted owner answer preserves the existing sent fallback');

  await reset('owner','&collapsed=1');await clickContains('owner','+ Owner input',true);await waitCalls(1);
  await finish(0,null,true);await waitText('Could not confirm the owner-input change.');await ready('#owner button');
  await click('owner','Retry save');await waitCalls(2);await finish(1);await clean();
  assert.equal((await args(1)).owner_action_required,true);assert.equal(await page.evaluate(()=>window.refreshes),1);
  pass('flagging owner input recovers from a lost response without duplicate requests');

  await reset('owner');await clickContains('owner','Doesn’t need owner input');await waitCalls(1);await finish(0,{ok:false,error:'Unflag failed'});await ready('#owner button');
  await click('owner','Edit');await edit('#owner textarea','New notes after unflag failure');await click('owner','Retry save');
  await waitText('Save or discard your notes before removing owner input.');assert.equal(await page.evaluate(()=>window.calls.length),1);
  assert.equal(await field('#owner textarea'),'New notes after unflag failure');await click('owner','Cancel');await click('owner','Retry save');await waitCalls(2);await finish(1);await clean();
  assert.equal((await args(1)).owner_action_required,false);assert.deepEqual(await pressed(),[]);await waitText('+ Context');
  pass('retrying an unflag cannot discard newly typed notes; confirmed unflag clears the local ask');

  await reset('owner');await click('owner','Draft owner email',true);await waitCalls(1);
  assert.deepEqual(await args(0),{property_id:'synthetic-home'});assert.equal(await guard(),true);
  assert.equal(await page.$$eval('#owner button',bs=>bs.every(b=>b.matches(':disabled'))),true);
  await finish(0,null,true);await waitText('Check Gmail Drafts before trying again.');await ready('#owner button');
  assert.equal(await page.evaluate(()=>window.calls.length),1);await click('owner','Draft owner email');await waitCalls(2);await finish(1);await clean();
  assert.equal(await page.evaluate(()=>window.opened.length),1);
  pass('owner email drafting blocks duplicate clicks and exposes lost responses without automatically creating another draft');

  const touchSummary='#crm input[placeholder^="e.g. Discussed"]';
  const touchNotes='#crm textarea[placeholder^="Notes (optional)"]';
  const touchRows=()=>page.$$eval('#crm li',lis=>lis.map(li=>li.textContent));
  const deleteTouch=(summary,twice=false)=>page.$$eval('#crm li',(lis,summary,twice)=>{
    const b=lis.find(li=>li.textContent.includes(summary))?.querySelector('button[aria-label="Delete touch"]');
    if(!b)throw Error('Missing activity delete '+summary);b.click();if(twice)b.click();
  },summary,twice);
  await reset('crm');await edit(touchSummary,'  Discussed repairs  ');await edit(touchNotes,'  Keep this call detail.\nFollow up Friday.  ');
  assert.equal(await guard(),true);await click('crm','Log Touch',true);await waitCalls(1);
  assert.equal(await page.$eval(touchSummary,e=>e.disabled),true);assert.equal(await page.$eval(touchNotes,e=>e.disabled),true);
  assert.equal((await touchRows()).length,4);assert.equal(await field(touchSummary),'  Discussed repairs  ');
  await finish(0,{ok:false,error:'Activity failed'});await waitText('Activity failed');await ready(touchSummary);
  assert.equal(await field(touchNotes),'  Keep this call detail.\nFollow up Friday.  ');
  await click('crm','Log Touch');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm whether this activity was logged.');await ready(touchSummary);
  assert.equal(await page.evaluate(()=>window.calls.length),2);assert.equal((await touchRows()).length,4);
  await click('crm','Log Touch');await waitCalls(3);await finish(2,{ok:true,id:'touch-new'});await clean();
  assert.equal(await field(touchSummary),'');assert.equal(await field(touchNotes),'');assert.equal((await touchRows()).length,5);
  assert.deepEqual(await args(2),{contact_id:'synthetic-contact',channel:'email',summary:'Discussed repairs',notes:'Keep this call detail.\nFollow up Friday.'});
  pass('CRM activity retains exact drafts after returned/thrown errors and only inserts a confirmed row');

  await reset('crm');await deleteTouch('Activity a',true);await waitCalls(1);assert.equal((await touchRows()).length,4);
  await edit(touchSummary,'New activity during deletion');await click('crm','Log Touch');await waitCalls(2);await finish(1,{ok:true,id:'touch-new'});await ready(touchSummary);
  assert.equal(await guard(),true);await finish(0,{ok:false,error:'Delete failed after new activity'});await waitText('Delete failed after new activity');await clean();
  assert.equal((await touchRows()).length,5);assert.ok((await touchRows()).some(t=>t.includes('New activity during deletion')));
  await deleteTouch('Activity a');await waitCalls(3);await finish(2,null,true);await waitText('Could not confirm deletion.');await clean();
  assert.equal((await touchRows()).length,5);await deleteTouch('Activity a');await waitCalls(4);await finish(3);await clean();
  assert.equal((await touchRows()).length,4);assert.ok((await touchRows()).some(t=>t.includes('New activity during deletion')));
  pass('a failed CRM deletion never rolls back newer activity and remains available for explicit retry');

  await reset('crm');await deleteTouch('Activity a');await deleteTouch('Activity b');await waitCalls(2);
  await finish(1);await page.waitForFunction(()=>![...document.querySelectorAll('#crm li')].some(li=>li.textContent.includes('Activity b')));
  await finish(0,{ok:false,error:'First deletion failed'});await waitText('First deletion failed');await clean();
  assert.equal((await touchRows()).length,3);assert.ok((await touchRows()).some(t=>t.includes('Activity a')));
  assert.equal(await page.$$eval('#crm li',lis=>lis.filter(li=>li.textContent.includes('Activity other')||li.textContent.includes('Activity inbound')).every(li=>!li.querySelector('button'))),true);
  pass('out-of-order CRM deletes cannot resurrect removed rows; inbound and other authors remain protected');

  await reset('crm');await edit(touchNotes,'Only notes so far');assert.equal(await guard(),true);
  assert.equal(await disabled('crm','Log Touch'),true);await click('crm','Discard activity draft');await clean();
  assert.equal(await field(touchNotes),'');assert.equal(await beforeUnload(),false);
  pass('partial CRM activity drafts can be explicitly discarded without sending a request');

  const taskTitle='#task fieldset input[type="text"]';
  const taskComment=`#task textarea[placeholder="What's the latest?"]`;
  const taskRows=()=>page.$$eval('#task p',ps=>ps.filter(p=>p.style.whiteSpace==='pre-wrap').map(p=>p.textContent));
  const deleteComment=(body,twice=false)=>page.$$eval('#task p',(ps,body,twice)=>{
    const row=ps.find(p=>p.textContent===body)?.parentElement;
    const b=row?.querySelector('button[title="Delete"]');if(!b)throw Error('Missing comment delete '+body);b.click();if(twice)b.click();
  },body,twice);
  await reset('task');await edit(taskTitle,'Updated task');await edit('#task fieldset textarea','Updated description');
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);await click('task','Save changes',true);await waitCalls(1);
  assert.equal(await page.$$eval('#task fieldset input,#task fieldset textarea,#task fieldset select,#task fieldset button',es=>es.every(e=>e.matches(':disabled'))),true);
  assert.equal(await disabled('task','Delete task'),true);
  assert.deepEqual(await args(0),{id:'synthetic-task',title:'Updated task',description:'Updated description',scope:'property',property_ids:['synthetic-home'],assigned_to_email:'me@example.test',priority:'medium',status:'open',due_date:'2026-10-05',tags:['repair']});
  await finish(0,{ok:false,error:'Task save failed'});await waitText('Task save failed');await ready(taskTitle);
  assert.equal(await field(taskTitle),'Updated task');assert.equal(await guard(),true);
  await click('task','Save changes');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the task save.');await ready(taskTitle);
  assert.equal(await disabled('task','Save changes'),false);assert.equal(await field('#task fieldset textarea'),'Updated description');
  await click('task','Save changes');await waitCalls(3);await finish(2);await clean();await waitText('Saved ');
  pass('task saves retain their payload through failures, release stuck controls, and reject duplicate submissions');

  await edit(taskTitle,'Newer unsaved task');assert.equal(await guard(),true);
  assert.equal((await text('#task')).includes('Saved '),false);await waitText('Unsaved changes');
  await edit(taskTitle,'Updated task');await clean();
  pass('task Saved indicator disappears when edits differ from the confirmed save');

  await reset('task');await edit(taskComment,'  Keep this comment.\nA second line.  ');await click('task','Post comment',true);await waitCalls(1);
  assert.equal(await page.$eval(taskComment,e=>e.disabled),true);assert.deepEqual(await taskRows(),['Comment a','Comment b','Comment other']);
  await finish(0,{ok:false,error:'Task comment failed'});await waitText('Task comment failed');await ready(taskComment);
  assert.equal(await field(taskComment),'  Keep this comment.\nA second line.  ');
  await click('task','Post comment');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm whether the comment posted.');await ready(taskComment);
  assert.equal(await page.evaluate(()=>window.calls.length),2);await click('task','Post comment');await waitCalls(3);await finish(2,{ok:true,id:'comment-new'});await clean();
  assert.equal(await field(taskComment),'');assert.deepEqual(await taskRows(),['Comment a','Comment b','Comment other','Keep this comment.\nA second line.']);
  await edit(taskComment,'Next comment after confirmation');assert.equal(await guard(),true);await click('task','Discard comment draft');await clean();
  pass('task comments preserve drafts after failures and freeze input so a confirmed post cannot erase newer typing');

  await reset('task');await confirm(true);await deleteComment('Comment a',true);await waitCalls(1);
  await edit(taskComment,'Comment added during deletion');await click('task','Post comment');await waitCalls(2);await finish(1,{ok:true,id:'comment-new'});await ready(taskComment);
  await finish(0,{ok:false,error:'Comment deletion failed'});await waitText('Comment deletion failed');await clean();
  assert.deepEqual(await taskRows(),['Comment a','Comment b','Comment other','Comment added during deletion']);
  await deleteComment('Comment a');await waitCalls(3);await finish(2,null,true);await waitText('Could not confirm deletion.');await clean();
  await deleteComment('Comment a');await waitCalls(4);await finish(3);await clean();
  assert.deepEqual(await taskRows(),['Comment b','Comment other','Comment added during deletion']);
  assert.equal(await page.$$eval('#task p',ps=>!!ps.find(p=>p.textContent==='Comment other')?.parentElement.querySelector('button')),false);
  pass('task comment deletion retains its row until confirmation and only exposes delete for the current author');

  await reset('task');await edit(taskTitle,'Task and comment together');await edit(taskComment,'Unfinished comment');
  await click('task','Save changes');await waitCalls(1);await click('task','Post comment');await waitCalls(2);
  await finish(0);await ready(taskTitle);assert.equal(await guard(),true);
  await finish(1,{ok:false,error:'Comment still needs retry'});await waitText('Comment still needs retry');await ready(taskComment);
  assert.equal(await field(taskComment),'Unfinished comment');assert.equal(await guard(),true);
  await click('task','Discard comment draft');await clean();
  pass('saving task fields cannot release a pending or failed comment draft guard');

  await reset('task');await confirm(false);await click('task','Delete task');assert.equal(await page.evaluate(()=>window.calls.length),0);
  await confirm(true);await click('task','Delete task',true);await waitCalls(1);
  assert.equal(await disabled('task','Save changes'),true);assert.equal(await disabled('task','Post comment'),true);
  await finish(0,null,true);await waitText('Synthetic lost response');await ready(taskTitle);await clean();
  pass('task deletion keeps its existing confirmation, blocks competing writes, and unlocks after failure');

  const bookTitle='#playbook input[placeholder^="e.g. Onboard"]';
  const bookBody='#playbook textarea';
  const cancelBook=()=>page.$eval('#playbook a',a=>a.click());
  await reset('playbook');await edit(bookTitle,'Revised procedure');await edit(bookBody,'## New steps\n\nKeep this procedure.');
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  await click('playbook','Preview');await waitText('Keep this procedure.');await click('playbook','Write');
  assert.equal(await field(bookBody),'## New steps\n\nKeep this procedure.');
  await click('playbook','Save changes',true);await waitCalls(1);
  assert.equal(await page.$$eval('#playbook input,#playbook textarea,#playbook select,#playbook button',es=>es.every(e=>e.matches(':disabled'))),true);
  await confirm(true);await cancelBook();assert.deepEqual(await page.evaluate(()=>window.navigations),[]);
  await finish(0,{ok:false,error:'Procedure save failed'});await waitText('Procedure save failed');await ready(bookTitle);
  assert.equal(await field(bookBody),'## New steps\n\nKeep this procedure.');
  await click('playbook','Save changes');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the save.');await ready(bookTitle);
  assert.equal(await page.evaluate(()=>window.calls.length),2);assert.equal(await guard(),true);
  await click('playbook','Save changes');await waitCalls(3);await finish(2,{ok:true,slug:'synthetic-procedure'});await clean();
  assert.deepEqual(await page.evaluate(()=>window.navigations),['/playbook/synthetic-procedure']);assert.equal(await page.evaluate(()=>window.refreshes),1);
  assert.equal((await args(2)).category,'custom-category');assert.equal((await args(2)).body_md,'## New steps\n\nKeep this procedure.');
  pass('Playbook edit preserves content, custom category and preview state, freezes during save, and navigates only after confirmation');

  await reset('playbook','&new=1');await click('playbook','Create entry');await waitText('Title is required');assert.equal(await page.evaluate(()=>window.calls.length),0);
  await edit(bookTitle,'New synthetic procedure');await edit(bookBody,'A new procedure to keep');
  await click('playbook','Create entry',true);await waitCalls(1);await finish(0,null,true);await waitText('Could not confirm the save.');await ready(bookTitle);
  assert.equal(await field(bookBody),'A new procedure to keep');assert.equal(await page.evaluate(()=>window.calls.length),1);
  assert.deepEqual(await page.$eval('#playbook [role="alert"] a',a=>({href:a.getAttribute('href'),target:a.target})),{href:'/playbook',target:'_blank'});
  await click('playbook','Create entry');await waitCalls(2);await finish(1,{ok:true,slug:'new-synthetic-procedure'});await clean();
  assert.deepEqual(await page.evaluate(()=>window.navigations),['/playbook/new-synthetic-procedure']);
  pass('new Playbook entries validate before saving and explain uncertain creation without automatic duplicate retries');

  await reset('playbook');await edit(bookBody,'Unfinished procedure');await confirm(false);await cancelBook();
  assert.deepEqual(await page.evaluate(()=>window.navigations),[]);assert.equal(await field(bookBody),'Unfinished procedure');assert.equal(await guard(),true);
  await confirm(true);await cancelBook();assert.deepEqual(await page.evaluate(()=>window.navigations),['/playbook/synthetic-procedure']);
  await page.evaluate(()=>window.unmount());await clean();
  pass('Playbook cancel respects the decision to keep or discard an unfinished draft');

  const roomName='#rooms fieldset input[placeholder^="Name,"]';
  const roomNotes='#rooms fieldset textarea[placeholder="Internal notes"]';
  const editRoom=name=>page.$$eval('#rooms h4',(hs,name)=>{
    const b=hs.find(h=>h.textContent===name)?.parentElement.querySelector('button');if(!b)throw Error('Missing room '+name);b.click();
  },name);
  await reset('rooms');await editRoom('Room a');assert.equal(await guard(),false);await edit(roomNotes,'Keep room A notes');
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  await editRoom('Room b');assert.equal(await field(roomName),'Room a');assert.equal(await field(roomNotes),'Keep room A notes');
  await click('rooms','+ Add room');assert.equal(await field(roomNotes),'Keep room A notes');
  await confirm(true);await editRoom('Room b');await page.waitForFunction(()=>document.querySelector('#rooms fieldset input[placeholder^="Name,"]').value==='Room b');await clean();
  assert.equal(await field(roomNotes),'Original room notes');
  pass('switching rooms or opening Add room asks before discarding an unfinished room draft');

  await reset('rooms');await editRoom('Room a');await edit(roomName,'Edited room A');await edit(roomNotes,'Updated room notes');
  await page.evaluate(()=>{
    const save=[...document.querySelectorAll('#rooms button')].find(b=>b.textContent.trim()==='Save room');
    const other=[...document.querySelectorAll('#rooms h4')].find(h=>h.textContent==='Room b').parentElement.querySelector('button');
    save.click();save.click();other.click();
  });await waitCalls(1);
  assert.equal(await field(roomName),'Edited room A');assert.equal(await page.$$eval('#rooms button,#rooms input,#rooms textarea,#rooms select',es=>es.every(e=>e.matches(':disabled'))),true);
  await finish(0,{ok:false,error:'Room save failed'});await waitText('Room save failed');await ready(roomName);
  assert.equal(await field(roomNotes),'Updated room notes');await click('rooms','Save room');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm the room save.');await ready(roomName);
  assert.equal(await field(roomName),'Edited room A');assert.equal(await guard(),true);assert.equal(await page.evaluate(()=>window.calls.length),2);
  await click('rooms','Save room');await waitCalls(3);await finish(2);await clean();assert.equal(await page.$('#rooms fieldset'),null);
  await editRoom('Room b');assert.equal(await field(roomName),'Room b');
  pass('room saves lock switching immediately, retain failed edits, and cannot close a different room editor');

  await reset('rooms');await click('rooms','+ Add room');assert.equal(await guard(),false);assert.equal(await disabled('rooms','Save room'),true);
  await edit(roomName,'New guest room');await edit('#rooms input[placeholder^="Beds,"]','2x Twin, King');
  await edit('#rooms input[placeholder^="TV,"]',' Roku ');await edit('#rooms input[placeholder^="Amenities,"]',' fan, desk ');
  await edit('#rooms textarea[placeholder^="Quirks,"]','Low beam\nStep down');await edit(roomNotes,'Keep new room detail');
  await edit('#rooms input[placeholder^="One line"]',' Quiet upstairs room ');
  await click('rooms','Save room',true);await waitCalls(1);await finish(0,null,true);await waitText('Could not confirm the room save.');await ready(roomName);
  assert.equal(await field(roomName),'New guest room');assert.equal(await field(roomNotes),'Keep new room detail');assert.equal(await page.evaluate(()=>window.calls.length),1);
  assert.deepEqual(await args(0),{propertyId:'synthetic-home',roomType:'bedroom',name:'New guest room',details:{beds:[{size:'twin',count:2},{size:'king',count:1}],tv:'Roku',amenities:['fan','desk'],quirks:['Low beam','Step down'],notes:'Keep new room detail'},guestSummary:'Quiet upstairs room'});
  await click('rooms','Save room');await waitCalls(2);await finish(1);await clean();
  pass('new room recovery preserves every field and the existing bed/amenity parsing without automatic duplicate creates');

  await reset('rooms');await editRoom('Room a');await edit(roomNotes,'Notes before cancel');await click('rooms','Cancel');
  assert.equal(await field(roomNotes),'Notes before cancel');assert.equal(await guard(),true);
  await confirm(true);await click('rooms','Cancel');await clean();assert.equal(await page.$('#rooms fieldset'),null);
  pass('room Cancel keeps the form when discard is declined and releases its guard when accepted');

  await reset('rooms');await editRoom('Room a');await click('rooms','Delete');assert.equal(await page.evaluate(()=>window.calls.length),0);
  await confirm(true);await click('rooms','Delete',true);await waitCalls(1);assert.equal(await disabled('rooms','Save room'),true);
  assert.equal(await page.$$eval('#rooms button',bs=>bs.every(b=>b.matches(':disabled'))),true);
  await finish(0,{ok:false,error:'Room deletion failed'});await waitText('Room deletion failed');await ready(roomName);
  await click('rooms','Delete');await waitCalls(2);await finish(1,null,true);await waitText('Could not confirm deletion.');await ready(roomName);
  assert.equal(await field(roomName),'Room a');await click('rooms','Delete');await waitCalls(3);await finish(2);await clean();
  assert.equal(await page.$('#rooms fieldset'),null);assert.deepEqual(await args(2),{propertyId:'synthetic-home',id:'a'});
  pass('room deletion confirms its target, recovers both failure kinds, and blocks competing edits');

  await reset('all');await click('owner','Edit');await edit('#owner textarea','Owner notes to keep');
  await edit(touchSummary,'CRM draft to keep');await edit(taskTitle,'Task draft to keep');await edit(bookBody,'Playbook draft to keep');await editRoom('Room a');await edit(roomNotes,'Room draft to keep');
  await click('owner','Save');await waitCalls(1);await finish(0);await ready('#owner button');assert.equal(await guard(),true);
  await click('crm','Discard activity draft');assert.equal(await guard(),true);
  await click('task','Save changes');await waitCalls(2);await finish(1);await ready(taskTitle);assert.equal(await guard(),true);
  await click('playbook','Save changes');await waitCalls(3);await finish(2,{ok:true,slug:'synthetic-procedure'});await ready(bookTitle);assert.equal(await guard(),true);
  await confirm(true);await click('rooms','Cancel');await clean();
  pass('saving or discarding one domain cannot release another editor’s unsaved-work guard');

  await reset('all');await click('owner','Edit');await edit('#owner textarea','Pending owner note');await click('owner','Save');
  await edit(touchSummary,'Pending CRM activity');await click('crm','Log Touch');
  await edit(taskTitle,'Pending task');await click('task','Save changes');await edit(taskComment,'Pending comment');await click('task','Post comment');
  await edit(bookBody,'Pending procedure');await click('playbook','Save changes');await editRoom('Room a');await edit(roomNotes,'Pending room');await click('rooms','Save room');await waitCalls(6);
  await page.evaluate(()=>window.unmount());await clean();
  await finish(0,null,true);await finish(1,{ok:true,id:'late-touch'});await finish(2,{ok:false,error:'Late task failure'});
  await finish(3,null,true);await finish(4,{ok:false,error:'Late Playbook failure'});await finish(5,null,true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await guard(),false);
  pass('unmount releases every domain guard and late action results cause no browser errors');

  assert.deepEqual(errors,[]);
  console.log(`All ${checks} expanded editor recovery browser checks passed.`);
}catch(error){
  if(page&&!page.isClosed())console.error('Synthetic editor state:',await page.evaluate(()=>({text:document.body.textContent,calls:window.calls?.map(c=>({kind:c.kind,args:c.args}))})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});
}
