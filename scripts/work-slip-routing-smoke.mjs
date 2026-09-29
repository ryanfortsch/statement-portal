/** Actual assignment, routing, snooze, and TeamPicker components in React
 * and Chromium. Server actions and the roster use synthetic data only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), 'helm-work-slip-routing-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['assignment', 'src/app/work/[id]/SlipAssignEditor.tsx'],
  ['scope', 'src/app/work/[id]/SlipScopeEditor.tsx'],
  ['snooze', 'src/app/work/[id]/SnoozeButton.tsx'],
  ['picker', 'src/components/TeamPicker.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const save = (kind,args) => new Promise((resolve,reject) => window.calls.push({kind,args,resolve,reject}));
  export const updateWorkSlipAssignment = args => save('assignment',args);
  export const updateWorkSlipScope = args => save('scope',args);
  export const snoozeWorkSlip = args => save('snooze',args);
`);
await writeFile(join(scratch, 'refresh.js'), 'export const useSoftRefresh = () => () => {window.refreshes++;};');
await writeFile(join(scratch, 'team.js'), `
  export const TEAM_MEMBERS = [{email:'teammate@example.test',name:'Synthetic teammate',short:'Teammate',initials:'ST',role:'inspector',active:true}];
  export const getTeamMember = email => TEAM_MEMBERS.find(m=>m.email===email)||null;
  export const displayNameForEmail = email => email;
  export const initialsForEmail = email => email?.slice(0,2)||'+';
`);
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SlipAssignEditor} from './assignment.js';
  import {SlipScopeEditor} from './scope.js';
  import {SnoozeButton} from './snooze.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  window.calls=[];window.refreshes=0;window.guarded=hasUnsavedWork;
  const params=new URLSearchParams(location.search);
  function Fixture(){
    const [mounted,setMounted]=useState(true);
    const [disabled,setDisabled]=useState(false);
    window.unmount=()=>setMounted(false);window.disableSnooze=()=>setDisabled(true);
    return mounted&&<>
      <section id="assignment"><SlipAssignEditor slipId="synthetic-slip" initialAssignedToEmail="original@example.test" myEmail="me@example.test"/></section>
      <section id="scope"><SlipScopeEditor slipId="synthetic-slip" initialScope={params.has('emptyScope')?null:'inspector'} initialNote="Original routing note"/></section>
      <section id="snooze"><fieldset disabled={disabled}><SnoozeButton slipId="synthetic-slip" initialSnoozedUntil={params.has('active')?null:'2026-10-01'}/></fieldset></section>
      <button id="outside">Outside</button>
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      '../actions':join(scratch,'actions.js'),
      '@/components/TeamPicker':join(scratch,'picker.js'),
      '@/lib/use-soft-refresh':join(scratch,'refresh.js'),
      '@/lib/unsaved-work':join(scratch,'unsaved-work.js'),
      '@/lib/team':join(scratch,'team.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()
    ?reject(error||Error(stats.toString({all:false,errors:true}))):done()));
});
if(process.argv.includes('--compile-only')){
  console.log('Work slip routing fixture compiled.');
  await rm(scratch,{recursive:true,force:true});process.exit(0);
}
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/bundle.js'){
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(join(scratch,'bundle.js')));
  }else{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Work slip routing checks</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--negative:#a22}section{padding:12px;margin-bottom:16px;border:1px solid #ddd}#snooze{display:flex;justify-content:flex-end}button{margin-right:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
let browser,page,checks=0;
try{
  browser=await puppeteer.launch({
    executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'
      ?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),
    headless:true,args:process.platform==='darwin'?['--no-sandbox']:chromium.args,
  });
  page=await browser.newPage();page.setDefaultTimeout(10000);
  await page.setViewport({width:1100,height:1000});
  await page.emulateTimezone('America/New_York');
  // Evening Eastern, when local and UTC dates disagree. Preserve the
  // existing UTC-tomorrow floor rather than changing snooze semantics.
  await page.evaluateOnNewDocument(()=>{
    const NativeDate=Date;
    window.Date=class extends NativeDate{
      constructor(...args){super(...(args.length?args:['2026-09-29T00:30:00.000Z']));}
      static now(){return new NativeDate('2026-09-29T00:30:00.000Z').getTime();}
    };
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().startsWith(origin+'/')?request.continue():request.abort());
  const click=async(section,text,{includes=false,twice=false}={})=>{
    // DOM clicks allow duplicate events in the same React render, exercising
    // the synchronous lock independently of disabled-button re-rendering.
    await page.$$eval('#'+section+' button',(buttons,text,includes,twice)=>{
      const b=buttons.find(b=>includes?b.textContent.includes(text):b.textContent.trim()===text);
      if(!b)throw new Error('Missing button: '+text);
      b.click();if(twice)b.click();
    },text,includes,twice);
  };
  const reset=async(query='')=>{await page.goto(origin+'/'+query);await page.waitForSelector('#assignment');};
  const edit=(selector,value)=>page.$eval(selector,(input,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  const waitText=text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
  const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
  const guard=()=>page.evaluate(()=>window.guarded());
  const waitClean=()=>page.waitForFunction(()=>!window.guarded());
  const finish=(index,result={ok:true},reject=false)=>page.evaluate((index,result,reject)=>{
    const call=window.calls[index];reject?call.reject(new Error('Synthetic lost response')):call.resolve(result);
  },index,result,reject);
  const ready=section=>page.waitForFunction(section=>!document.querySelector('#'+section+' button').matches(':disabled'),{},section);
  const beforeUnload=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
  const assignee=()=>page.$eval('#assignment button',b=>b.textContent);
  const scopes=()=>page.$$eval('#scope button[aria-pressed="true"]',bs=>bs.map(b=>b.textContent));
  const date=()=>page.$eval('#snooze input',input=>input.value);
  const trigger=()=>page.$eval('#snooze button',b=>b.textContent);
  const custom=async(value)=>{
    await page.click('#assignment button');await click('assignment','Custom email…',{includes:true});
    await edit('#assignment input',value);
    await page.$eval('#assignment form',form=>{form.requestSubmit();form.requestSubmit();});
  };
  const snoozeCustom=async(value)=>{
    await page.click('#snooze button');await edit('#snooze input',value);
    await page.$eval('#snooze form',form=>{form.requestSubmit();form.requestSubmit();});
  };
  const pass=name=>{checks++;console.log(`PASS ${name}`);};

  await reset();assert.equal(await guard(),false);
  await custom('vendor@example.test');await waitCalls(1);
  assert.ok((await assignee()).includes('original@example.test'));
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  assert.equal(await page.$eval('#assignment button',b=>b.disabled),true);
  assert.deepEqual(await page.evaluate(()=>window.calls[0].args),{id:'synthetic-slip',assigned_to_email:'vendor@example.test'});
  await finish(0,{ok:false,error:'Synthetic assignment failure'});await waitText('Synthetic assignment failure');await ready('assignment');
  assert.ok((await assignee()).includes('original@example.test'));assert.equal(await guard(),true);
  pass('custom assignment retains the confirmed person on failure and blocks duplicate submits');

  await click('assignment','Retry assignment',{twice:true});await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the assignment.');await ready('assignment');
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await click('assignment','Retry assignment');await waitCalls(3);await finish(2);await waitClean();
  assert.ok((await assignee()).includes('vendor@example.test'));
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.assigned_to_email)),Array(3).fill('vendor@example.test'));
  pass('lost assignment response preserves the exact target and only explicit retry applies it');

  await reset();await page.click('#assignment button');await click('assignment','Unassign',{includes:true,twice:true});await waitCalls(1);
  await finish(0,{ok:false,error:'Cannot unassign yet'});await waitText('Cannot unassign yet');await ready('assignment');
  assert.ok((await assignee()).includes('original@example.test'));
  await click('assignment','Retry assignment');await waitCalls(2);await finish(1);await waitClean();
  assert.ok((await assignee()).includes('Unassigned'));
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.assigned_to_email)),[null,null]);
  pass('unassign retries null correctly and clears the person only after confirmation');

  await reset();await page.click('#assignment button');await click('assignment','Synthetic teammate',{includes:true});await waitCalls(1);
  await finish(0,{ok:false,error:'Team assignment failed'});await waitText('Team assignment failed');await ready('assignment');
  await click('assignment','Dismiss');await waitClean();assert.ok((await assignee()).includes('original@example.test'));
  await page.click('#assignment button');await click('assignment','Assign to me',{includes:true});await waitCalls(2);await finish(1);await waitClean();
  assert.ok((await assignee()).includes('me@example.test'));
  pass('roster and assign-to-me flows work; dismissing a failed choice releases its guard');

  await reset();await custom('first@example.test');await waitCalls(1);await finish(0,null,true);await ready('assignment');
  await custom('replacement@example.test');await waitCalls(2);await finish(1);await waitClean();
  assert.ok((await assignee()).includes('replacement@example.test'));
  assert.equal(await page.$('#assignment [role="alert"]'),null);
  pass('a new assignment replaces a failed target without a stale error or retry');

  for(const [label,value] of [['Inspector','inspector'],['Handyman','handyman'],['Pro / vendor','pro']]){
    await reset('?emptyScope=1');await click('scope',label,{twice:true});await waitCalls(1);
    assert.deepEqual(await scopes(),[]);assert.equal(await guard(),true);
    assert.equal(await page.$$eval('#scope button',bs=>bs.every(b=>b.disabled)),true);
    await finish(0,{ok:false,error:'Synthetic routing failure'});await waitText('Synthetic routing failure');await ready('scope');
    assert.deepEqual(await scopes(),[]);await waitText('Original routing note');
    await click('scope','Retry routing');await waitCalls(2);await finish(1,null,true);
    await waitText('Could not confirm the routing change.');await ready('scope');
    assert.equal(await page.evaluate(()=>window.calls.length),2);
    await click('scope','Retry routing',{twice:true});await waitCalls(3);await finish(2);await waitClean();
    assert.deepEqual(await scopes(),[label]);
    assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.run_scope)),Array(3).fill(value));
    assert.equal(await page.$eval('#scope',s=>s.textContent.includes('Original routing note')),false);
    pass(label+' handles returned and thrown failures, duplicate taps, and explicit retry');
  }

  await reset();await click('scope','Inspector');await waitCalls(1);await finish(0,null,true);
  await waitText('Could not confirm the routing change.');await ready('scope');assert.deepEqual(await scopes(),['Inspector']);
  await waitText('Original routing note');await click('scope','Retry routing');await waitCalls(2);await finish(1);await waitClean();
  assert.deepEqual(await scopes(),[]);await waitText('Not triaged yet.');
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.run_scope)),[null,null]);
  assert.equal(await page.$eval('#scope',s=>s.textContent.includes('Original routing note')),false);
  pass('clearing routing retries null without toggling back and clears its stale note only on success');

  await reset();await click('scope','Handyman');await waitCalls(1);await finish(0,{ok:false,error:'Scope failed'});await ready('scope');
  await click('scope','Dismiss');await waitClean();assert.deepEqual(await scopes(),['Inspector']);
  await click('scope','Pro / vendor');await waitCalls(2);await finish(1);await waitClean();assert.deepEqual(await scopes(),['Pro / vendor']);
  pass('routing can dismiss a failed choice or save a different destination');

  await reset();await snoozeCustom('2026-10-10');await waitCalls(1);
  assert.equal(await date(),'2026-10-10');assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  assert.equal(await page.$$eval('#snooze input,#snooze button',els=>els.every(el=>el.matches(':disabled'))),true);
  await finish(0,{ok:false,error:'Synthetic snooze failure'});await waitText('Synthetic snooze failure');await ready('snooze');
  assert.equal(await date(),'2026-10-10');assert.equal(await trigger(),'Snoozed until 2026-10-01');
  assert.equal(await page.evaluate(()=>window.refreshes),0);
  pass('custom snooze retains its date and confirmed status on failure while blocking competing saves');

  await click('snooze','Retry snooze change',{twice:true});await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the snooze change.');await ready('snooze');assert.equal(await date(),'2026-10-10');
  await page.click('#outside');await waitText('Snooze needs attention');assert.equal(await guard(),true);
  assert.equal(await page.$('#snooze input'),null);
  await click('snooze','Snooze needs attention');assert.equal(await date(),'2026-10-10');
  await click('snooze','Retry snooze change');await waitCalls(3);await finish(2);await waitClean();
  assert.equal(await trigger(),'Snoozed until 2026-10-10');assert.equal(await page.evaluate(()=>window.refreshes),1);
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.until)),Array(3).fill('2026-10-10'));
  await page.click('#snooze button');assert.equal(await date(),'');
  pass('lost snooze response survives closing and reopening; confirmed retry clears the draft and refreshes once');

  for(const [label,expected] of [['Tomorrow','2026-09-30'],['3 days','2026-10-01'],['Next week','2026-10-05'],['Two weeks','2026-10-12'],['Next month','2026-10-28']]){
    await reset('?active=1');await page.click('#snooze button');await click('snooze',label+'(',{includes:true,twice:true});await waitCalls(1);
    await finish(0,null,true);await waitText('Could not confirm the snooze change.');await ready('snooze');assert.equal(await trigger(),'+ Snooze');
    await click('snooze','Retry snooze change');await waitCalls(2);await finish(1);await waitClean();
    assert.equal(await trigger(),'Snoozed until '+expected);
    assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.until)),[expected,expected]);
    pass(label+' keeps the existing local-date / UTC-floor behavior and retries the same date');
  }

  await reset();await page.click('#snooze button');await click('snooze','Un-snooze (return to queue now)',{twice:true});await waitCalls(1);
  await finish(0,{ok:false,error:'Cannot un-snooze yet'});await waitText('Cannot un-snooze yet');await ready('snooze');
  assert.equal(await trigger(),'Snoozed until 2026-10-01');
  await click('snooze','Retry snooze change');await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the snooze change.');await ready('snooze');
  await click('snooze','Retry snooze change');await waitCalls(3);await finish(2);await waitClean();
  assert.equal(await trigger(),'+ Snooze');assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args.until)),[null,null,null]);
  pass('un-snooze retains the confirmed date through failures and retries null correctly');

  await reset();await page.click('#snooze button');await edit('#snooze input','2026-10-20');
  assert.equal(await guard(),true);await page.click('#outside');await waitText('Unsaved snooze selection');
  await click('snooze','Unsaved snooze selection');assert.equal(await date(),'2026-10-20');
  await click('snooze','Dismiss');await waitClean();assert.equal(await beforeUnload(),false);
  await page.click('#snooze button');assert.equal(await date(),'');assert.equal(await page.evaluate(()=>window.calls.length),0);
  pass('an unsubmitted custom date survives outside click and can be explicitly discarded');

  await edit('#snooze input','2026-09-29');
  assert.equal(await page.$eval('#snooze input',i=>i.min),'2026-09-30');
  await page.$eval('#snooze form',form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await waitCalls(1);assert.equal(await page.evaluate(()=>window.calls[0].args.until),'2026-09-30');
  await finish(0);await waitClean();
  pass('hand-typed dates still clamp to UTC tomorrow when input validation is bypassed');

  await reset();await snoozeCustom('2026-10-10');await waitCalls(1);await finish(0,{ok:false,error:'Try another date'});await ready('snooze');
  await edit('#snooze input','2026-10-15');await click('snooze','Snooze');await waitCalls(2);await finish(1);await waitClean();
  assert.equal(await trigger(),'Snoozed until 2026-10-15');
  pass('a replacement custom date supersedes a failed snooze target');

  await reset();await page.click('#snooze button');await page.evaluate(()=>window.disableSnooze());
  await page.waitForFunction(()=>document.querySelector('#snooze fieldset').disabled);
  assert.equal(await page.$$eval('#snooze input,#snooze button',els=>els.every(el=>el.matches(':disabled'))),true);
  await click('snooze','Tomorrow(',{includes:true});assert.equal(await page.evaluate(()=>window.calls.length),0);
  pass('the surrounding completion panel can still disable every snooze control');

  await reset();await custom('pending@example.test');await waitCalls(1);
  await click('scope','Handyman');await waitCalls(2);await snoozeCustom('2026-10-10');await waitCalls(3);
  await finish(0);await ready('assignment');assert.equal(await guard(),true);
  await finish(1);await ready('scope');assert.equal(await guard(),true);
  await finish(2,{ok:false,error:'Snooze still needs retry'});await ready('snooze');assert.equal(await guard(),true);
  await click('snooze','Dismiss');await waitClean();
  pass('one successful editor cannot release another editor’s pending or failed selection guard');

  await reset();await custom('pending@example.test');await click('scope','Handyman');await snoozeCustom('2026-10-10');await waitCalls(3);
  await page.evaluate(()=>window.unmount());await waitClean();
  await finish(0);await finish(1,null,true);await finish(2,{ok:false,error:'Late snooze error'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await guard(),false);assert.deepEqual(errors,[]);
  pass('unmount releases all guards and late responses do not cause browser errors');
  console.log(`All ${checks} work slip routing browser checks passed.`);
}catch(error){
  if(page&&!page.isClosed())console.error('Synthetic routing state:',await page.evaluate(()=>({text:document.body.textContent,calls:window.calls?.map(c=>({kind:c.kind,args:c.args}))})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
