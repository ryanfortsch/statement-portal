/** Real work-slip editors and uploader in React/Chromium. Server actions and
 * upload responses are synthetic; no live work slips or storage are touched. */
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
const scratch = await mkdtemp(join(tmpdir(), 'helm-work-slip-editors-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rNsAAAAASUVORK5CYII=', 'base64');
await writeFile(join(scratch, 'photo.png'), png);
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['title', 'src/app/work/[id]/SlipTitleEditor.tsx'],
  ['bring', 'src/app/work/[id]/SlipBringListEditor.tsx'],
  ['photos', 'src/app/work/[id]/SlipPhotoEditor.tsx'],
  ['upload', 'src/components/PhotoUploader.tsx'],
  ['unsaved-work', 'src/lib/unsaved-work.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const save = (kind, args) => new Promise((resolve, reject) => {
    window.calls.push({kind, args, resolve, reject});
  });
  export const updateWorkSlipTitle = args => save('title', args);
  export const updateWorkSlipBringList = args => save('bring', args);
  export const updateWorkSlipPhotos = args => save('photos', args);
`);
await writeFile(join(scratch, 'refresh.js'), 'export const useSoftRefresh = () => () => {window.refreshes++;};');
await writeFile(join(scratch, 'compress.js'), 'export const compressImage = async file => file;');
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SlipTitleEditor} from './title.js';
  import {SlipBringListEditor} from './bring.js';
  import {SlipPhotoEditor} from './photos.js';
  import {hasUnsavedWork} from './unsaved-work.js';
  window.calls=[];window.uploads=[];window.refreshes=0;window.guarded=hasUnsavedWork;
  window.fetch=(url,options)=>new Promise((resolve,reject)=>{
    if(url!=='/api/upload') {reject(new Error('Unexpected synthetic request'));return;}
    window.uploads.push({folder:options.body.get('folder'),resolve,reject});
  });
  const params=new URLSearchParams(location.search);
  function Fixture() {
    const [mounted,setMounted]=useState(true);
    window.unmount=()=>setMounted(false);
    return mounted && <>
      <section id="title"><SlipTitleEditor slipId="synthetic-slip" initialTitle="Fix faucet"/></section>
      <section id="bring"><SlipBringListEditor slipId="synthetic-slip" initialBringList={params.has('empty')?null:'Two washers'}/></section>
      <section id="photos"><SlipPhotoEditor slipId="synthetic-slip" propertyId="synthetic-home"
        initialUrls={params.has('empty')?[]:['/photo-existing.png']} collapsed={params.has('empty')}/></section>
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
      '@/components/PhotoUploader':join(scratch,'upload.js'),
      '@/lib/image-compress':join(scratch,'compress.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()
    ?reject(error||Error(stats.toString({all:false,errors:true}))):done()));
});
if(process.argv.includes('--compile-only')){
  console.log('Work slip browser fixture compiled.');
  await rm(scratch,{recursive:true,force:true});
  process.exit(0);
}
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if(req.url==='/bundle.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(join(scratch,'bundle.js')));
  }else if(req.url?.startsWith('/photo-')){
    res.setHeader('Content-Type','image/png');res.end(png);
  }else{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Work slip editor checks</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--negative:#a22}section{padding:12px;margin-bottom:16px;border:1px solid #ddd}button{margin-right:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
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
  const reset=async(query='')=>{await page.goto(origin+'/'+query);await page.waitForSelector('#title');};
  const edit=(section,value)=>page.$eval('#'+section+' input:not([type=file]), #'+section+' textarea',(input,value)=>{
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  const field=section=>page.$eval('#'+section+' input:not([type=file]), #'+section+' textarea',input=>input.value);
  const waitText=text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
  const waitCalls=n=>page.waitForFunction(n=>window.calls.length===n,{},n);
  const guard=()=>page.evaluate(()=>window.guarded());
  const waitClean=()=>page.waitForFunction(()=>!window.guarded());
  const finish=(index,result={ok:true},reject=false)=>page.evaluate((index,result,reject)=>{
    const call=window.calls[index];reject?call.reject(new Error('Synthetic lost response')):call.resolve(result);
  },index,result,reject);
  const beforeUnload=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
  const pass=name=>{checks++;console.log(`PASS ${name}`);};
  const waitReady=section=>page.waitForFunction(section=>{
    const input=document.querySelector('#'+section+' input:not([type=file]), #'+section+' textarea');
    return input&&!input.disabled;
  },{},section);
  const upload=async()=>{
    const count=await page.evaluate(()=>window.uploads.length);
    await (await page.$('#photos input[type=file]')).uploadFile(join(scratch,'photo.png'));
    await page.waitForFunction(count=>window.uploads.length===count+1,{},count);
  };
  const finishUpload=()=>page.evaluate(()=>window.uploads.at(-1).resolve(new Response(JSON.stringify({url:'/photo-new.png'}),{status:200})));
  const photoCount=()=>page.$$eval('#photos img',images=>images.length);

  await reset('?empty=1');assert.equal(await guard(),false);
  await click('title','Edit Title');await edit('title','');
  assert.equal(await page.$eval('#title button',b=>b.disabled),true);
  await page.$eval('#title input',input=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await click('title','Cancel');await waitClean();
  await page.click('#photos button');await waitClean();assert.equal(await photoCount(),0);
  pass('empty title cannot save; cancel and opening empty photos leave no unsaved work');

  await reset();await click('title','Edit Title');await edit('title','  Repair kitchen faucet  ');
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  await page.$eval('#title input',input=>{
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  });
  await waitCalls(1);
  assert.equal(await page.$$eval('#title input,#title button',elements=>elements.every(e=>e.disabled)),true);
  assert.deepEqual(await page.evaluate(()=>window.calls[0].args),{id:'synthetic-slip',title:'Repair kitchen faucet'});
  await finish(0,{ok:false,error:'Synthetic title failure'});await waitText('Synthetic title failure');await waitReady('title');
  assert.equal(await field('title'),'  Repair kitchen faucet  ');assert.equal(await guard(),true);
  assert.equal(await page.evaluate(()=>window.calls.length),1);
  pass('title failure keeps exact draft open; duplicate saves and Escape cannot interrupt a pending write');

  await click('title','Save');await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the save. Your title');await waitReady('title');
  assert.equal(await field('title'),'  Repair kitchen faucet  ');assert.equal(await guard(),true);
  await click('title','Save');await waitCalls(3);await finish(2);await waitClean();
  assert.equal(await page.$eval('#title h1',h=>h.textContent),'Repair kitchen faucet');
  assert.equal(await page.evaluate(()=>window.refreshes),1);
  pass('lost title responses preserve the draft; confirmed retry closes it and updates the title');

  await click('title','Edit Title');await click('title','Save');await waitClean();
  assert.equal(await page.evaluate(()=>window.calls.length),3);
  await click('title','Edit Title');await edit('title','Discarded edit');await click('title','Cancel');await waitClean();
  await click('title','Edit Title');assert.equal(await field('title'),'Repair kitchen faucet');
  await click('title','Cancel');assert.equal(await beforeUnload(),false);
  pass('unchanged titles do not write and explicit cancel discards only the unsaved draft');

  await reset('?empty=1');await page.click('#bring button');await edit('bring','Washers\nTwo light bulbs');
  await click('bring','Save');await waitCalls(1);
  assert.equal(await page.$$eval('#bring textarea,#bring button',elements=>elements.every(e=>e.disabled)),true);
  await finish(0,{ok:false,error:'Synthetic supply failure'});await waitText('Synthetic supply failure');await waitReady('bring');
  assert.equal(await field('bring'),'Washers\nTwo light bulbs');assert.equal(await guard(),true);
  await click('bring','Save');await waitCalls(2);await finish(1);await waitClean();
  assert.equal(await page.$eval('#bring p',p=>p.textContent),'Washers\nTwo light bulbs');
  pass('first supply-list edit stays open after failure and retries without retyping');

  await reset();await click('bring','Edit');await edit('bring','');await click('bring','Save');await waitCalls(1);
  await finish(0,null,true);await waitText('Could not confirm the save. Your supply list');await waitReady('bring');
  assert.equal(await field('bring'),'');assert.equal(await guard(),true);
  await edit('bring','Two washers');await click('bring','Save');await waitCalls(2);
  assert.deepEqual(await page.evaluate(()=>window.calls[1].args),{id:'synthetic-slip',bringList:'Two washers'});
  await finish(1);await waitClean();
  pass('uncertain clearing retains the empty draft and resaving the original list still confirms a write');

  await click('bring','Edit');await edit('bring','');await click('bring','Save');await waitCalls(3);
  assert.equal(await page.evaluate(()=>window.calls[2].args.bringList),'');await finish(2);await waitClean();
  await waitText('+ Supply run');
  pass('confirmed empty supply list intentionally clears it and restores the collapsed affordance');

  await reset();await click('title','Edit Title');await edit('title','New title');
  await click('bring','Edit');await edit('bring','Extra washers');
  await click('title','Save');await waitCalls(1);await finish(0);await waitText('Edit Title');
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  await click('bring','Cancel');await waitClean();
  pass('saving one editor does not release another editor’s refresh protection');

  await reset('?empty=1');await page.click('#photos button');await upload();
  assert.equal(await guard(),true);assert.equal(await beforeUnload(),true);
  assert.equal(await page.evaluate(()=>window.uploads[0].folder),'work-slips/synthetic-home/synthetic-slip');
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await finishUpload();await waitCalls(1);
  assert.equal(await photoCount(),1);
  assert.equal(await page.$$eval('#photos input,#photos button',elements=>elements.every(e=>e.disabled)),true);
  await finish(0,{ok:false,error:'Synthetic attachment failure'});await waitText('Retry saving photos');
  assert.equal(await photoCount(),1);assert.equal(await guard(),true);
  pass('active upload and attachment save are guarded; failed attachment keeps the uploaded thumbnail');

  await click('photos','Retry saving photos');await waitCalls(2);await finish(1,null,true);
  await waitText('Could not confirm the photo save.');assert.equal(await guard(),true);
  await page.$$eval('#photos button',buttons=>{
    const button=buttons.find(b=>b.textContent==='Retry saving photos');button.click();button.click();
  });
  await waitCalls(3);await finish(2);await waitText('Saved · 1 photo');await waitClean();
  assert.equal(await page.evaluate(()=>window.calls.length),3);
  assert.equal(await page.evaluate(()=>window.uploads.length),1);
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.args)),Array(3).fill({id:'synthetic-slip',photo_urls:['/photo-new.png']}));
  pass('returned and thrown photo-save failures retry the same URLs once without uploading again');

  await page.click('#photos [aria-label="Remove photo"]');await waitCalls(4);
  await finish(3,{ok:false,error:'Synthetic removal failure'});await waitText('Retry saving photos');
  assert.equal(await photoCount(),0);assert.equal(await guard(),true);
  assert.equal(await page.$eval('#photos',el=>el.textContent.includes('Saved ·')),false);
  await click('photos','Retry saving photos');await waitCalls(5);await finish(4);await waitText('Saved · 0 photos');await waitClean();
  assert.deepEqual(await page.evaluate(()=>window.calls[4].args.photo_urls),[]);
  pass('failed removal is visibly unsaved and retries an empty photo list');

  await reset();await page.click('#photos [aria-label="Remove photo"]');await waitCalls(1);
  await finish(0,{ok:false,error:'Synthetic photo failure'});await waitText('Retry saving photos');
  await upload();assert.equal(await guard(),true);
  assert.equal(await page.$$eval('#photos button',buttons=>buttons.find(b=>b.textContent==='Retry saving photos').disabled),true);
  await finishUpload();await waitCalls(2);await finish(1);await waitClean();
  assert.deepEqual(await page.evaluate(()=>window.calls[1].args.photo_urls),['/photo-new.png']);
  pass('a new upload holds retry until the current batch can save its complete desired photo list');

  await reset();await click('title','Edit Title');await edit('title','Pending title');await click('title','Save');
  await click('bring','Edit');await edit('bring','Pending supplies');await click('bring','Save');
  await page.click('#photos [aria-label="Remove photo"]');await waitCalls(3);
  await page.evaluate(()=>window.unmount());await waitClean();
  await finish(0);await finish(1,null,true);await finish(2,{ok:false,error:'Late photo failure'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await guard(),false);assert.deepEqual(errors,[]);
  pass('unmount releases every editor guard even when pending responses arrive afterward');
  console.log(`All ${checks} work slip editor browser checks passed.`);
}catch(error){
  if(page&&!page.isClosed()) console.error('Synthetic editor state:',await page.evaluate(()=>({text:document.body.textContent,calls:window.calls?.map(c=>({kind:c.kind,args:c.args})),uploads:window.uploads?.length})).catch(()=>null));
  throw error;
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
