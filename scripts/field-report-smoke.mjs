/** Real report form in React/Chromium with synthetic action/upload promises.
 * --serve exposes the fixture for manual checks. No report is sent to the office. */
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
const scratch = await mkdtemp(join(tmpdir(), 'helm-field-report-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['component', 'src/app/field/report/ReportIssueForm.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  export const reportFieldWorkSlip = (previous, data) => new Promise((resolve, reject) => {
    window.calls.push({data:Object.fromEntries(data), resolve, reject});
  });
`);
await writeFile(join(scratch, 'link.js'), compile(`
  import React from 'react';
  export default function Link(props) {return <a {...props}/>;}
`));
await writeFile(join(scratch, 'upload.js'), compile(`
  import React from 'react';
  export function PhotoUploader({value,onChange,onUploadingChange,disabled}) {
    return <div>
      <p>Attached photos: {value.length}</p>
      <button type="button" disabled={disabled} onClick={()=>onChange(['https://example.test/issue.jpg'])}>Attach synthetic photo</button>
      <button type="button" disabled={disabled} onClick={()=>onChange([])}>Remove photos</button>
      <button type="button" disabled={disabled} onClick={()=>{
        onUploadingChange?.(true);
        window.finishUpload=()=>{onChange([...value,'https://example.test/uploaded.jpg']);onUploadingChange?.(false);};
      }}>Start synthetic upload</button>
    </div>;
  }
`));
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useEffect, useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {ReportIssueForm} from './component.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  window.calls=[];window.guarded=hasUnsavedWork;
  const params=new URLSearchParams(location.search);
  const visits=['North','South'].slice(0,params.has('single')?1:2).map(name=>({
    propertyId:name,propertyName:'Synthetic '+name,city:'Gloucester',agoLabel:'today',leftLabel:'Within reporting window',
  }));
  function Fixture() {
    const [mounted,setMounted]=useState(true);
    const [,setTick]=useState(0);
    window.unmount=()=>setMounted(false);
    useEffect(()=>{const id=setInterval(()=>setTick(n=>n+1),50);return()=>clearInterval(id);},[]);
    return <>
      <aside><h1>Synthetic field report check</h1>
        <p>Guard: {hasUnsavedWork()?'active':'clear'} · Calls: {window.calls.length}</p>
        {params.has('manual') && <>
          <button onClick={()=>window.calls.at(-1)?.resolve({ok:false,error:'Synthetic returned failure'})}>Return failure</button>
          <button onClick={()=>window.calls.at(-1)?.reject(new Error('Synthetic lost response'))}>Reject action</button>
          <button onClick={()=>window.calls.at(-1)?.resolve({ok:true,home:'Synthetic North'})}>Succeed action</button>
          <button onClick={()=>window.finishUpload?.()}>Finish upload</button>
          <button onClick={()=>setMounted(v=>!v)}>Toggle form</button>
        </>}
      </aside>
      {mounted && <ReportIssueForm visits={visits} windowHours={72}/>}
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      '../actions':join(scratch,'actions.js'),
      'next/link':join(scratch,'link.js'),
      '@/components/PhotoUploader':join(scratch,'upload.js'),
      '@/lib/unsaved-work':join(scratch,'unsaved-work.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()
    ?reject(error||Error(stats.toString({all:false,errors:true}))):done()));
});
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/bundle.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(join(scratch,'bundle.js')));
  }else{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Field report safeguard fixture</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--positive:#175d29;--signal:#a22}*{box-sizing:border-box}button{margin-right:8px}aside{background:#eee;padding:12px;margin-bottom:16px}</style><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser,page,checks=0;
try{
  if(process.argv.includes('--serve')){
    console.log(`Fixture: ${origin}/?manual=1`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }else{
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
    const click=async text=>{
      const button=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),text);
      assert.ok(button.asElement(),`Missing button: ${text}`);
      await button.asElement().click();await button.dispose();
    };
    const reset=async(query='')=>{await page.goto(origin+'/'+query);await page.waitForSelector('form');};
    const edit=(name,value)=>page.$eval(`[name="${name}"]`,(input,value)=>{
      const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const waitText=text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
    const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
    const guard=()=>page.evaluate(()=>window.guarded());
    const data=()=>page.$eval('form',form=>Object.fromEntries(new FormData(form)));
    const finish=(result,reject=false)=>page.evaluate((result,reject)=>{
      const call=window.calls.at(-1);reject?call.reject(new Error('Synthetic lost response')):call.resolve(result);
    },result,reject);
    const pass=name=>{checks++;console.log(`PASS ${name}`);};
    const fill=async()=>{
      await page.select('[name=property_id]','North');await edit('title','Leaking faucet');
      await edit('location','Upstairs bathroom');await edit('description','Drips even when closed.\nPhoto attached.');
      await edit('expense_dollars','27.60');await click('Soonneeds attention');await click('Attach synthetic photo');
    };

    await reset('?single=1');assert.equal(await guard(),false);
    await click('Send to the office');assert.equal(await page.evaluate(()=>window.calls.length),0);
    assert.equal(await guard(),false);
    pass('preselected home is clean and native required-field validation prevents an empty report');

    await reset();await fill();const original=await data();
    assert.equal(await guard(),true);
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
    await click('Send to the office');await waitCalls(1);
    assert.deepEqual(await page.evaluate(()=>window.calls[0].data),original);
    assert.equal(await page.$$eval('form input:not([type=hidden]),form select,form textarea,form button',elements=>elements.every(e=>e.matches(':disabled'))),true);
    await finish({ok:false,error:'Synthetic returned failure'});await waitText('Synthetic returned failure');
    await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);
    assert.deepEqual(await data(),original);assert.equal(await guard(),true);
    pass('returned failures retain every text field, receipt, home, priority and photo for retry');

    await click('Send to the office');await waitCalls(2);await finish(null,true);
    await waitText('Could not confirm whether the report was filed.');
    await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);
    assert.deepEqual(await data(),original);assert.equal(await guard(),true);
    assert.equal(await page.evaluate(()=>window.calls.length),2);
    pass('lost responses preserve the draft, explain uncertainty and do not auto-resubmit');

    await page.evaluate(()=>{const form=document.querySelector('form');form.requestSubmit();form.requestSubmit();});
    await waitCalls(3);
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1).data),original);
    assert.equal(await page.$$eval('form input:not([type=hidden]),form select,form textarea,form button',elements=>elements.every(e=>e.matches(':disabled'))),true);
    await finish({ok:true,home:'Synthetic North'});await waitText('Flagged. The office has it.');
    await page.waitForFunction(()=>!window.guarded());
    assert.equal(await page.evaluate(()=>window.calls.length),3);
    pass('duplicate submit events issue one request; success confirms filing and releases the guard');

    await reset('?single=1');await click('Start synthetic upload');
    await waitText('Wait for photos…');assert.equal(await guard(),true);
    await edit('title','Report during upload');
    await page.evaluate(()=>document.querySelector('form').requestSubmit());
    assert.equal(await page.evaluate(()=>window.calls.length),0);
    await edit('title','');
    await page.evaluate(()=>window.finishUpload());await waitText('Attached photos: 1');
    assert.equal(await guard(),true);await click('Remove photos');
    await page.waitForFunction(()=>!window.guarded());
    pass('uploads arm the guard, completed photos remain unsent, and removing them restores clean state');

    await reset('?single=1');await edit('title','Draft to clear');assert.equal(await guard(),true);
    await edit('title','');await page.waitForFunction(()=>!window.guarded());
    await click('Soonneeds attention');assert.equal(await guard(),true);
    await click('Normalbefore the next guest');await page.waitForFunction(()=>!window.guarded());
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
    pass('clearing edits and reverting priority remove the refresh warning');

    await reset();await page.select('[name=property_id]','South');assert.equal(await guard(),true);
    await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>!window.guarded());
    pass('changing homes marks the report unsent and unmount releases its guard');

    await reset('?single=1');await edit('title','Pending report');await click('Send to the office');await waitCalls(1);
    await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>!window.guarded());
    await finish({ok:false,error:'Synthetic late failure'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await guard(),false);assert.deepEqual(errors,[]);
    pass('a response after unmount cannot leave a guard behind or produce browser errors');
    console.log(`All ${checks} field report browser checks passed.`);
  }
}catch(error){
  if(page&&!page.isClosed()) console.error('Synthetic report state:',await page.evaluate(()=>({text:document.body.innerText,calls:window.calls?.length})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
