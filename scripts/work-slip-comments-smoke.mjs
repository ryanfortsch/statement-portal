/** Real comment/close-out components in React and Chromium with synthetic
 * server actions. No work slips, comments, or production data are changed. */
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
const scratch = await mkdtemp(join(tmpdir(), 'helm-work-slip-comments-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['comments', 'src/app/work/[id]/SlipComments.tsx'],
  ['close', 'src/app/work/[id]/SlipClosePanel.tsx'],
  ['SnoozeButton', 'src/app/work/[id]/SnoozeButton.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const save = (kind,args) => new Promise((resolve,reject) => window.calls.push({kind,args,resolve,reject}));
  export const addWorkSlipComment = args => save('post',args);
  export const deleteWorkSlipComment = args => save('delete',args);
  export const updateWorkSlipResolution = args => save('resolution',args);
  export const updateWorkSlipStatus = args => save('status',args);
  export const snoozeWorkSlip = args => save('snooze',args);
`);
await writeFile(join(scratch, 'refresh.js'), 'export const useSoftRefresh = () => () => {window.refreshes++;};');
await writeFile(join(scratch, 'team.js'), 'export const displayNameForEmail = email => email;');
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SlipComments} from './comments.js';
  import {SlipClosePanel} from './close.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  window.calls=[];window.refreshes=0;window.guarded=hasUnsavedWork;
  const params=new URLSearchParams(location.search);
  const initialComments=params.has('empty')?[]:['a','b','other'].slice(0,params.has('single')?1:3).map(id=>({
    id,work_slip_id:'synthetic-slip',author_email:id==='other'?'other@example.test':'me@example.test',
    body:'Comment '+id,created_at:'2026-09-01T12:00:00.000Z',
  }));
  function Fixture(){
    const [mounted,setMounted]=useState(true);
    window.unmount=()=>setMounted(false);
    return mounted&&<>
      <section id="comments"><SlipComments slipId="synthetic-slip" initialComments={initialComments} myEmail="me@example.test"/></section>
      <section id="close"><SlipClosePanel workSlipId="synthetic-slip" propertyId="synthetic-home"
        initialStatus={params.get('status')||'open'} initialResolutionNotes="Existing notes" initialSnoozedUntil={null}/></section>
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      '../actions':join(scratch,'actions.js'),
      '@/lib/use-soft-refresh':join(scratch,'refresh.js'),
      '@/lib/unsaved-work':join(scratch,'unsaved-work.js'),
      '@/lib/team':join(scratch,'team.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()
    ?reject(error||Error(stats.toString({all:false,errors:true}))):done()));
});
if(process.argv.includes('--compile-only')){
  console.log('Work slip comments fixture compiled.');
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
    res.end('<!doctype html><title>Work slip comments checks</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--negative:#a22}section{padding:12px;margin-bottom:16px;border:1px solid #ddd}button{margin-right:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
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
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().startsWith(origin+'/')?request.continue():request.abort());
  const click=async(section,text)=>{
    const button=await page.evaluateHandle((section,text)=>[...document.querySelectorAll('#'+section+' button')].find(b=>b.textContent.trim()===text),section,text);
    assert.ok(button.asElement(),`Missing button: ${section} ${text}`);
    await button.asElement().click();await button.dispose();
  };
  const reset=async(query='')=>{await page.goto(origin+'/'+query);await page.waitForSelector('#close');};
  const edit=(section,value)=>page.$eval('#'+section+' textarea',(input,value)=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  const field=section=>page.$eval('#'+section+' textarea',input=>input.value);
  const waitText=text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
  const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
  const guard=()=>page.evaluate(()=>window.guarded());
  const waitClean=()=>page.waitForFunction(()=>!window.guarded());
  const finish=(index,result={ok:true},reject=false)=>page.evaluate((index,result,reject)=>{
    const call=window.calls[index];reject?call.reject(new Error('Synthetic lost response')):call.resolve(result);
  },index,result,reject);
  const ready=section=>page.waitForFunction(section=>!document.querySelector('#'+section+' textarea').disabled,{},section);
  const beforeUnload=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
  const bodies=()=>page.$$eval('#comments li',rows=>rows.map(row=>row.querySelector('p').textContent));
  const remove=async(body,twice=false)=>page.$$eval('#comments li',(rows,body,twice)=>{
    const row=rows.find(row=>row.querySelector('p').textContent===body);
    assertButton(row?.querySelector('button'));
    function assertButton(button){if(!button)throw new Error('Missing delete button: '+body);button.click();if(twice)button.click();}
  },body,twice);
  const pass=name=>{checks++;console.log(`PASS ${name}`);};

  await reset('?empty=1');assert.equal(await guard(),false);
  await page.click('#comments button');await click('comments','Post');
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await edit('comments','Draft to discard');assert.equal(await guard(),true);
  await click('comments','Cancel');await waitClean();
  assert.equal(await beforeUnload(),false);
  pass('empty comments cannot post and explicit cancel releases the draft guard');

  await page.click('#comments button');await edit('comments','  Called the plumber.\nThursday works.  ');
  assert.equal(await beforeUnload(),true);
  await page.$eval('#comments form',form=>{form.requestSubmit();form.requestSubmit();});await waitCalls(1);
  assert.equal(await page.$$eval('#comments textarea,#comments form button',elements=>elements.every(e=>e.disabled)),true);
  assert.deepEqual(await bodies(),[]);
  assert.deepEqual(await page.evaluate(()=>window.calls[0].args),{work_slip_id:'synthetic-slip',body:'Called the plumber.\nThursday works.'});
  await finish(0,{ok:false,error:'Synthetic post failure'});await waitText('Synthetic post failure');await ready('comments');
  assert.equal(await field('comments'),'  Called the plumber.\nThursday works.  ');assert.equal(await guard(),true);
  assert.equal(await page.evaluate(()=>window.calls.length),1);
  pass('returned post failure retains exact text; pending post freezes input and rejects duplicate submits');

  await click('comments','Post');await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm whether this comment posted.');await ready('comments');
  assert.equal(await field('comments'),'  Called the plumber.\nThursday works.  ');
  assert.deepEqual(await page.$eval('#comments a',a=>({href:a.getAttribute('href'),target:a.target})),{href:'/work/synthetic-slip',target:'_blank'});
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await click('comments','Post');await waitCalls(3);await finish(2,{ok:true,id:'new-comment'});await waitClean();
  assert.equal(await field('comments'),'');assert.deepEqual(await bodies(),['Called the plumber.\nThursday works.']);
  pass('lost post response explains uncertainty without auto-reposting; confirmed retry clears only its draft');

  await reset();assert.equal(await page.$eval('#comments li:last-child',li=>li.querySelector('button')),null);
  await remove('Comment a');await waitCalls(1);assert.equal(await guard(),true);
  assert.deepEqual(await bodies(),['Comment a','Comment b','Comment other']);
  await edit('comments','New while delete waits');await click('comments','Post');await waitCalls(2);
  await finish(1,{ok:true,id:'newer'});await waitText('New while delete waits');await ready('comments');
  assert.equal(await guard(),true);
  await finish(0,{ok:false,error:'Synthetic delete failure'});await waitText('Synthetic delete failure');await waitClean();
  assert.deepEqual(await bodies(),['Comment a','Comment b','Comment other','New while delete waits']);
  pass('a failed deletion preserves a newer confirmed comment; another author has no delete control');

  await reset();await remove('Comment a');await remove('Comment b');await waitCalls(2);
  await finish(1);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('#comments li p')).some(p=>p.textContent==='Comment b'));
  assert.equal(await guard(),true);await finish(0,{ok:false,error:'First delete failed'});await waitText('First delete failed');await waitClean();
  assert.deepEqual(await bodies(),['Comment a','Comment other']);
  pass('out-of-order delete results never resurrect a different successfully deleted comment');

  await remove('Comment a',true);await waitCalls(3);await finish(2,null,true);
  await waitText('Could not confirm deletion.');await waitClean();
  assert.equal(await page.evaluate(()=>window.calls.length),3);assert.deepEqual(await bodies(),['Comment a','Comment other']);
  await remove('Comment a');await waitCalls(4);await finish(3);await waitClean();
  assert.deepEqual(await bodies(),['Comment other']);
  pass('duplicate delete clicks issue one request; a lost response leaves the row available for retry');

  await reset('?single=1');await edit('comments','Draft after the last comment');
  await remove('Comment a');await waitCalls(1);await finish(0);await ready('comments');
  assert.equal(await field('comments'),'Draft after the last comment');assert.equal(await guard(),true);
  assert.deepEqual(await bodies(),[]);await click('comments','Cancel');await waitClean();
  pass('deleting the final comment does not collapse the composer or hide an unfinished draft');

  for(const [mode,initialStatus,label] of [['done','open','Mark Done'],['dismissed','scheduled','Dismiss'],['notes','done','Save Notes']]){
    await reset('?status='+initialStatus);await edit('close','  Replaced washer.\nTested faucet.  ');
    assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
    await page.$$eval('#close button',(buttons,label)=>{
      const button=buttons.find(b=>b.textContent===label);button.click();button.click();
    },label);await waitCalls(1);
    assert.equal(await page.$$eval('#close textarea,#close button',elements=>elements.every(e=>e.matches(':disabled'))),true);
    const expected={id:'synthetic-slip',resolution_notes:'  Replaced washer.\nTested faucet.  ',...(mode==='notes'?{}:{status:mode,propertyId:'synthetic-home'})};
    assert.deepEqual(await page.evaluate(()=>window.calls[0].args),expected);
    await finish(0,{ok:false,error:'Synthetic close failure'});await waitText('Synthetic close failure');await ready('close');
    assert.equal(await field('close'),'  Replaced washer.\nTested faucet.  ');assert.equal(await guard(),true);
    assert.equal(await page.evaluate(()=>window.refreshes),0);
    pass(label+' retains notes after returned failure and blocks duplicate or competing controls');

    await click('close',label);await waitCalls(2);await finish(1,null,true);
    await waitText('Could not confirm the change.');await ready('close');
    assert.equal(await field('close'),'  Replaced washer.\nTested faucet.  ');
    assert.deepEqual(await page.$eval('#close a',a=>({href:a.getAttribute('href'),target:a.target})),{href:'/work/synthetic-slip',target:'_blank'});
    assert.equal(await page.evaluate(()=>window.calls.length),2);
    await click('close',label);await waitCalls(3);await finish(2);await waitClean();
    assert.equal(await page.evaluate(()=>window.refreshes),1);
    await waitText('Reopen');
    if(mode==='dismissed')await waitText('Dismissed: closed without work.');
    assert.equal(await page.$$eval('#close button',buttons=>buttons.some(b=>b.textContent==='Save Notes')),false);
    pass(label+' recovers from a lost response and marks notes saved only after confirmed retry');
  }

  await reset('?status=done');await edit('close','Unsaved notes before reopen');await click('close','Reopen');await waitCalls(1);
  assert.deepEqual(await page.evaluate(()=>({kind:window.calls[0].kind,args:window.calls[0].args})),{
    kind:'status',args:{id:'synthetic-slip',status:'open',propertyId:'synthetic-home'},
  });
  await finish(0,{ok:false,error:'Synthetic reopen failure'});await waitText('Synthetic reopen failure');await ready('close');
  assert.equal(await field('close'),'Unsaved notes before reopen');assert.equal(await guard(),true);
  await click('close','Reopen');await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the change.');await ready('close');
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await click('close','Reopen');await waitCalls(3);await finish(2);await waitText('Mark Done');
  assert.equal(await field('close'),'Unsaved notes before reopen');assert.equal(await guard(),true);
  await edit('close','Existing notes');await waitClean();
  pass('reopen recovers from returned and thrown failures without claiming unsaved notes were saved');

  await reset('?status=dismissed');assert.equal(await guard(),false);
  await click('close','Reopen');await waitCalls(1);assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  await finish(0);await waitText('Mark Done');await waitClean();
  pass('even a status-only reopen defers refresh until its request completes');

  await reset();await edit('comments','Keep this comment draft');await edit('close','Notes ready to save');
  await click('close','Mark Done');await waitCalls(1);await finish(0);await waitText('Reopen');
  assert.equal(await guard(),true);assert.equal(await field('comments'),'Keep this comment draft');
  await edit('comments','');await waitClean();
  pass('saving completion notes cannot release another editor’s unfinished comment guard');

  await reset('?single=1');await edit('comments','Keep this pending post');await click('comments','Post');
  await remove('Comment a');await waitCalls(2);await finish(1);
  await page.waitForFunction(()=>document.querySelectorAll('#comments li').length===0);
  assert.equal(await field('comments'),'Keep this pending post');
  await finish(0,{ok:false,error:'Post failed after deletion'});await waitText('Post failed after deletion');await ready('comments');
  assert.equal(await field('comments'),'Keep this pending post');assert.equal(await guard(),true);
  pass('a pending or failed post remains visible when the last existing comment is deleted');

  await reset();await edit('comments','Pending comment');await click('comments','Post');
  await remove('Comment a');await edit('close','Pending resolution');await click('close','Mark Done');await waitCalls(3);
  await page.evaluate(()=>window.unmount());await waitClean();
  await finish(0,{ok:true,id:'late'});await finish(1,null,true);await finish(2,{ok:false,error:'Late close failure'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await guard(),false);assert.deepEqual(errors,[]);
  pass('unmount releases all guards and late responses cause no browser errors');
  console.log(`All ${checks} work slip comment and completion browser checks passed.`);
}catch(error){
  if(page&&!page.isClosed())console.error('Synthetic work slip state:',await page.evaluate(()=>({text:document.body.textContent,calls:window.calls?.map(c=>({kind:c.kind,args:c.args}))})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
