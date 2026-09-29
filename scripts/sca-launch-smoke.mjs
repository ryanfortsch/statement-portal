/** Real launch form in React/Chromium; all actions and uploads use synthetic data.
 * --serve exposes the fixture for manual browser checks without external writes. */
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
const scratch = await mkdtemp(join(tmpdir(), 'helm-sca-launch-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['component', 'src/app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
  ['sca-launch', 'src/lib/sca-launch.ts'],
  ['sca-config', 'src/lib/sca-config.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const call = (kind, args) => new Promise((resolve, reject) => {
    window.calls.push({kind, args, resolve, reject});
  });
  export const saveScaDraft = (...args) => call('save', args);
  export const openScaPr = (...args) => call('preview', args);
  export const openScaUpdatePr = (...args) => call('preview', args);
  export const publishScaUpdate = (...args) => call('publish', args);
  export const goLiveSca = (...args) => call('launch', args);
  export const refreshPreviewStatus = () => window.refreshPreview();
  export const setPaymentStep = (...args) => call('payment', args);
  export const verifyPaymentWiring = (...args) => call('verify', args);
  export const unlistSca = (...args) => call('unlist', args);
  export const refreshScaSiteData = (...args) => call('refresh', args);
  export const pullFromGuesty = (...args) => call('guesty', args);
`);
await writeFile(join(scratch, 'upload.js'), compile(`
  import React from 'react';
  export function PhotoUploader({value,onChange,onUploadingChange,disabled}) {
    return <button disabled={disabled} onClick={()=>{
      onUploadingChange(true);
      window.finishUpload=()=>{onChange([...value,'https://example.test/new-photo.jpg']);onUploadingChange(false);};
    }}>Start synthetic upload</button>;
  }
`));
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useEffect, useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {ScaLaunchClient} from './component.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  import {scaDraftPreviewSignature} from './sca-launch.js';
  const params=new URLSearchParams(location.search);
  const manual=params.has('manual');
  const draft={guestyListingId:'synthetic',internalName:'Synthetic House',publicName:'Stay by the Harbor',
    icalUrl:'https://example.test/calendar',stripeAccountKey:'SYNTHETIC',rank:10,
    pitch:'Harbor views',tagline:'Saved tagline',description:'Saved About',
    highlights:['Waterfront','Patio','Parking'],
    stayFavorite:{name:'Example Cafe',town:'Gloucester',blurb:'Breakfast nearby',lat:42.6,lng:-70.6},
    extraFavorites:[],reviews:[],sleepingArrangements:[{name:'Primary',beds:'King',photo:[]}]};
  window.calls=[];window.polls=0;window.held=[];window.guarded=hasUnsavedWork;
  window.previewDraft=structuredClone(draft);
  window.previewMode=params.has('hold')?'hold':params.has('error')?'throw':'success';
  window.refreshPreview=()=>{
    window.polls++;
    const result={ok:true,state:'success',url:'https://example.test/preview',signature:scaDraftPreviewSignature(window.previewDraft)};
    if(window.previewMode==='throw') return Promise.reject(new Error('Synthetic preview transport failure'));
    if(window.previewMode==='error') return Promise.resolve({ok:false,error:'Synthetic returned preview failure'});
    if(window.previewMode==='no-url') result.url=null;
    if(window.previewMode==='hold') return new Promise(resolve=>window.held.push(()=>resolve(result)));
    return Promise.resolve(result);
  };
  if(params.has('stale')) draft.tagline='Newer saved tagline';
  window.row={property_id:'synthetic',guesty_listing_id:'synthetic',status:params.has('launch')?'pr_open':'live',
    branch_name:params.has('launch')?'sca-launch/synthetic':'sca-update/synthetic',
    registry_entry:structuredClone(draft),pr_number:123,pr_url:'https://example.test/pr',
    preview_url:'https://example.test/old-preview',live_url:'https://example.test/live',
    payment_publishable_set:!params.has('unpaid'),payment_secret_set:true,payment_webhook_set:true};
  window.succeed=()=>{
    const call=window.calls.at(-1);
    if(call.kind==='save'||call.kind==='preview') {
      window.row={...window.row,registry_entry:structuredClone(call.args[1])};
      if(call.kind==='preview') window.previewDraft=structuredClone(call.args[1]);
    }
    call.resolve({ok:true,row:window.row});
  };
  if(manual) window.confirm=()=>true;
  function Fixture() {
    const [mounted,setMounted]=useState(true);
    const [,setTick]=useState(0);
    window.unmount=()=>setMounted(false);
    useEffect(()=>{const id=setInterval(()=>setTick(n=>n+1),50);return()=>clearInterval(id);},[]);
    return <>
      <aside><h1>Synthetic launch safeguard check</h1>
        <p>Guard: {hasUnsavedWork()?'active':'clear'} · Calls: {window.calls.length} · Preview checks: {window.polls}</p>
        {manual && <>
          <button onClick={()=>window.calls.at(-1)?.reject(new Error('Synthetic transport failure'))}>Reject action</button>
          <button onClick={()=>window.calls.at(-1)?.resolve({ok:false,error:'Synthetic returned failure'})}>Return failure</button>
          <button onClick={()=>window.succeed()}>Succeed action</button>
          <button onClick={()=>{window.previewMode='success';}}>Recover preview</button>
          <button onClick={()=>window.held.shift()?.()}>Release old preview</button>
          <button onClick={()=>window.finishUpload?.()}>Finish upload</button>
          <button onClick={()=>setMounted(v=>!v)}>Toggle form</button>
        </>}
      </aside>
      {mounted && <ScaLaunchClient propertyId="synthetic" propertyName="Synthetic House"
        defaults={draft} initialRow={window.row} signedIn githubConfigured/>}
    </>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      './actions':join(scratch,'actions.js'),
      '@/components/PhotoUploader':join(scratch,'upload.js'),
      ...Object.fromEntries(['unsaved-work','sca-launch','sca-config'].map(name=>['@/lib/'+name,join(scratch,name+'.js')])),
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
    res.end('<!doctype html><title>Launch safeguard fixture</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--positive:#175d29;--negative:#a22}*{box-sizing:border-box}button{margin-right:8px}aside{background:#eee;padding:12px}</style><div id="root"></div><script src="/bundle.js"></script>');
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
      // Resolve and activate in one DOM turn: a status render can replace
      // the previous element between handle lookup and pointer dispatch.
      await page.evaluate(text=>{
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
        if(!button||button.matches(':disabled'))throw Error(`Button not ready: ${text}`);
        button.click();
      },text);
    };
    const reset=async(query='')=>{await page.goto(origin+'/'+query);await page.waitForSelector('fieldset');};
    const field='input[placeholder="Stay at Granite Point"]';
    const edit=value=>page.$eval(field,(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const waitText=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{},text);
    const enabled=text=>page.evaluate(text=>!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.matches(':disabled')),text);
    const waitEnabled=text=>page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text&&!b.matches(':disabled')),{},text);
    const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
    const guard=()=>page.evaluate(()=>window.guarded());
    const finish=()=>page.evaluate(()=>window.succeed());
    const pass=name=>{checks++;console.log(`PASS ${name}`);};

    await reset();await waitEnabled('Publish update');
    assert.equal(await page.evaluate(()=>window.polls),1);assert.equal(await guard(),false);
    await edit('New unsaved name');await waitText('Unsaved changes.');
    assert.equal(await guard(),true);assert.equal(await enabled('Publish update'),false);
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
    await edit('Stay by the Harbor');await waitEnabled('Publish update');
    assert.equal(await guard(),false);
    pass('live-update previews load automatically; editing guards exits and reverting clears the guard');

    await edit('New unsaved name');await click('Save draft');await waitCalls(1);
    assert.equal(await page.$eval(field,input=>input.matches(':disabled')),true);
    await page.evaluate(()=>window.calls.at(-1).reject(new Error('Synthetic transport failure')));
    await waitText('Synthetic transport failure');await waitEnabled('Save draft');
    assert.equal(await guard(),true);
    assert.equal(await page.$eval(field,input=>input.value),'New unsaved name');
    await click('Save draft');await waitCalls(2);
    await page.evaluate(()=>window.calls.at(-1).resolve({ok:false,error:'Synthetic returned failure'}));
    await waitText('Synthetic returned failure');assert.equal(await guard(),true);
    await click('Save draft');await waitCalls(3);await finish();await waitText('Draft saved.');
    await page.waitForFunction(()=>!window.guarded());
    assert.equal(await enabled('Publish update'),false);
    pass('failed saves preserve edits; successful Save draft clears unsaved state but cannot authorize the old preview');

    await reset('?stale=1');await waitText('This form differs from the preview.');
    assert.equal(await guard(),false);assert.equal(await enabled('Publish update'),false);
    await click('Refresh update PR');await waitCalls(1);
    assert.equal(await guard(),true);assert.equal(await page.$eval(field,input=>input.matches(':disabled')),true);
    await finish();await waitEnabled('Publish update');
    assert.equal(await guard(),false);
    await click('Publish update');await waitCalls(2);
    assert.equal(await page.evaluate(()=>window.calls.at(-1).args[1].tagline),'Newer saved tagline');
    await page.evaluate(()=>window.calls.at(-1).resolve({ok:false,error:'Synthetic publish failure'}));
    await waitText('Synthetic publish failure');await waitEnabled('Publish update');
    pass('reopening a saved-but-unpreviewed draft stays blocked until a successful PR refresh');

    await reset('?launch=1');await waitEnabled('Approve & go live →');
    await edit('New launch name');assert.equal(await enabled('Approve & go live →'),false);
    assert.equal(await enabled('Force go-live…'),false);
    await click('Update preview PR');await waitCalls(1);await finish();await waitEnabled('Approve & go live →');
    await click('Approve & go live →');await waitCalls(2);
    assert.deepEqual(await page.evaluate(()=>window.calls.at(-1).args.slice(0,2)),['synthetic',false]);
    assert.equal(await page.evaluate(()=>window.calls.at(-1).args[2].publicName),'New launch name');
    pass('initial launch and force launch both require current content; launch passes the exact form');

    await reset('?launch=1&unpaid=1');await waitEnabled('Force go-live…');
    assert.equal(await enabled('Approve & go live →'),false);
    await click('Force go-live…');await waitCalls(1);
    assert.equal(await page.evaluate(()=>window.calls.at(-1).args[1]),true);
    pass('the existing payment checklist and explicit override retain their behavior');

    await reset('?error=1');await waitText('Could not check the preview.');
    assert.equal(await enabled('Publish update'),false);
    await waitEnabled('Check now');await page.evaluate(()=>{window.previewMode='error';});await click('Check now');
    await waitText('Synthetic returned preview failure');assert.equal(await enabled('Publish update'),false);
    // Error text can commit before useTransition releases its busy button.
    await waitEnabled('Check now');await page.evaluate(()=>{window.previewMode='success';});await click('Check now');await waitEnabled('Publish update');
    pass('thrown and returned preview failures block publishing and manual retry recovers');

    await reset('?hold=1');await page.waitForFunction(()=>window.held.length===1);
    await edit('Refreshed preview name');await click('Refresh update PR');await waitCalls(1);
    await page.evaluate(()=>{window.previewMode='no-url';});await finish();await waitEnabled('Publish update');
    await page.evaluate(()=>window.held.shift()());
    // Let the old promise and React updates settle without waiting on the 12s poll.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await enabled('Publish update'),true);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('a')].some(a=>a.textContent==='Open preview ↗')),false);
    pass('late checks from an older preview cannot replace the refreshed content or restore a stale preview URL');

    await reset();await waitEnabled('Publish update');await click('Start synthetic upload');
    await waitText('Wait for the photo upload');assert.equal(await guard(),true);
    assert.equal(await enabled('Save draft'),false);assert.equal(await enabled('Publish update'),false);
    await page.evaluate(()=>window.finishUpload());await waitText('Unsaved changes.');await waitEnabled('Save draft');
    assert.equal(await guard(),true);assert.equal(await enabled('Publish update'),false);
    await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>!window.guarded());
    assert.deepEqual(errors,[]);
    pass('uploads block saves and exits; completed photos are unsaved and unmount releases the guard');
    console.log(`All ${checks} launch safeguard browser checks passed.`);
  }
}catch(error){
  if(page&&!page.isClosed()) console.error('Synthetic launch state:',await page.evaluate(()=>({text:document.body.innerText,calls:window.calls?.map(c=>c.kind),polls:window.polls})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
